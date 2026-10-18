"""Async HTTP for the scholarly APIs: per-host pacing and bounded retries."""
from __future__ import annotations

import asyncio
import os
import time

import httpx

# Seconds between requests per host. NCBI enforces 3 req/s keyless, 10 with a key;
# Semantic Scholar's introductory key allows 1 req/s.
PACE = {
    "eutils.ncbi.nlm.nih.gov": 0.11 if os.getenv("NCBI_API_KEY") else 0.34,
    "api.semanticscholar.org": 1.0,
    "www.ebi.ac.uk": 0.05,
}
MAX_ATTEMPTS = 3
# Some APIs answer an exhausted budget with Retry-After of hours (OpenAlex: 13 h).
# Waiting that out is a hang, not a retry, so anything longer fails immediately.
MAX_RETRY_AFTER = 10.0

_client: httpx.AsyncClient | None = None
_next_slot: dict[str, float] = {}


async def get_json(url: str, **kwargs) -> dict:
    return (await request("GET", url, **kwargs)).json()


async def post_json(url: str, **kwargs) -> dict:
    return (await request("POST", url, **kwargs)).json()


async def request(method: str, url: str, **kwargs) -> httpx.Response:
    host = httpx.URL(url).host
    for attempt in range(1, MAX_ATTEMPTS + 1):
        await _pace(host)
        try:
            resp = await _get_client().request(method, url, **kwargs)
        except httpx.TransportError:
            if attempt == MAX_ATTEMPTS:
                raise
            await asyncio.sleep(attempt)
            continue
        retryable = resp.status_code == 429 or resp.status_code >= 500
        if not retryable or attempt == MAX_ATTEMPTS:
            resp.raise_for_status()
            return resp
        delay = _retry_after(resp) or float(attempt)
        if delay > MAX_RETRY_AFTER:
            resp.raise_for_status()
        await asyncio.sleep(delay)
    raise AssertionError("unreachable")


async def close() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=30, follow_redirects=True,
                                    headers={"User-Agent": "tumor-discovery/0.1"})
    return _client


async def _pace(host: str) -> None:
    gap = PACE.get(host)
    if not gap:
        return
    # Reserve the next free slot before awaiting, so concurrent callers queue up.
    now = time.monotonic()
    slot = max(now, _next_slot.get(host, 0.0))
    _next_slot[host] = slot + gap
    await asyncio.sleep(slot - now)


def _retry_after(resp: httpx.Response) -> float | None:
    value = resp.headers.get("retry-after")
    try:
        return float(value) if value else None
    except ValueError:  # an HTTP-date; treat as unknown and use our own backoff
        return None
