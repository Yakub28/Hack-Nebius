"""Async HTTP for the evidence services: per-host pacing and concurrency, bounded retries, disk cache."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from pathlib import Path

import httpx

# Seconds between request starts per host. NCBI enforces 3 req/s keyless, 10 with a key.
PACE = {
    "eutils.ncbi.nlm.nih.gov": 0.11 if os.getenv("NCBI_API_KEY") else 0.34,
}
CONCURRENCY = {
    "eutils.ncbi.nlm.nih.gov": 8,
    "icite.od.nih.gov": 4,
    "api.tavily.com": 4,
    "api.openalex.org": 8,
}
TIMEOUT = 15.0
MAX_ATTEMPTS = 3
# Some APIs answer an exhausted budget with Retry-After of hours (OpenAlex: 13 h).
# Waiting that out is a hang, not a retry, so anything longer fails immediately.
MAX_RETRY_AFTER = 10.0
DAY = 86_400
CACHE_DIR = Path(os.getenv("CACHE_DIR", ".cache/http"))

_client: httpx.AsyncClient | None = None
_next_slot: dict[str, float] = {}
_gates: dict[str, asyncio.Semaphore] = {}


async def get_json(url: str, *, ttl: int | None = None, **kwargs) -> dict:
    return json.loads(await fetch("GET", url, ttl=ttl, **kwargs))


async def post_json(url: str, *, ttl: int | None = None, **kwargs) -> dict:
    return json.loads(await fetch("POST", url, ttl=ttl, **kwargs))


async def fetch(method: str, url: str, *, ttl: int | None = None, **kwargs) -> str:
    """Response body as text. With `ttl` (seconds), a cached body younger than that is reused."""
    key = _cache_key(method, url, kwargs) if ttl else None
    if key and (cached := _cache_read(key, ttl)) is not None:
        return cached
    text = await _request(method, url, **kwargs)
    if key:
        _cache_write(key, text)
    return text


async def close() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def _request(method: str, url: str, **kwargs) -> str:
    host = httpx.URL(url).host
    gate = _gates.setdefault(host, asyncio.Semaphore(CONCURRENCY.get(host, 8)))
    for attempt in range(1, MAX_ATTEMPTS + 1):
        async with gate:
            await _pace(host)
            try:
                resp = await _get_client().request(method, url, **kwargs)
            except httpx.TransportError:
                if attempt == MAX_ATTEMPTS:
                    raise
                resp = None
        if resp is None:
            await asyncio.sleep(attempt)
            continue
        retryable = resp.status_code == 429 or resp.status_code >= 500
        if not retryable or attempt == MAX_ATTEMPTS:
            resp.raise_for_status()
            return resp.text
        delay = _retry_after(resp) or float(attempt)
        if delay > MAX_RETRY_AFTER:
            resp.raise_for_status()
        await asyncio.sleep(delay)
    raise AssertionError("unreachable")


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True,
                                    headers={"User-Agent": "snowball-discovery/0.2"})
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


def _cache_key(method: str, url: str, kwargs: dict) -> str:
    # Headers carry API keys and never change the answer, so they stay out of the key.
    parts = {k: v for k, v in kwargs.items() if k != "headers"}
    raw = json.dumps([method, url, parts], sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def _cache_read(key: str, ttl: int) -> str | None:
    path = CACHE_DIR / key[:2] / f"{key}.json"
    try:
        entry = json.loads(path.read_text())
    except FileNotFoundError:
        return None
    return entry["text"] if time.time() - entry["time"] < ttl else None


def _cache_write(key: str, text: str) -> None:
    path = CACHE_DIR / key[:2] / f"{key}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"time": time.time(), "text": text}))
