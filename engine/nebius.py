"""Nebius Token Factory: embeddings and LLM calls (OpenAI-compatible API)."""
from __future__ import annotations

import asyncio
import json
import os

import numpy as np
from openai import AsyncOpenAI

BASE_URL = "https://api.tokenfactory.nebius.com/v1/"
# The catalog changes (Llama and every "-fast" model were retired in 2026), so both are overridable.
EMBED_MODEL = os.getenv("NEBIUS_EMBED_MODEL", "Qwen/Qwen3-Embedding-8B")
LLM_MODEL = os.getenv("NEBIUS_LLM_MODEL", "nvidia/Nemotron-3_5-Lightning")
EMBED_BATCH = 64
EMBED_CONCURRENCY = 4
MAX_EMBED_CHARS = 8000
# Qwen3-Embedding is instruction-aware on the query side only; documents are embedded bare.
QUERY_INSTRUCTION = ("Instruct: Given a biomedical research question, retrieve paper abstracts "
                     "that help answer it\nQuery: ")

_client: AsyncOpenAI | None = None


async def embed(texts: list[str]) -> np.ndarray:
    """Unit-normalised embeddings, one row per text, so a dot product is a cosine."""
    batches = [texts[i:i + EMBED_BATCH] for i in range(0, len(texts), EMBED_BATCH)]
    gate = asyncio.Semaphore(EMBED_CONCURRENCY)

    async def one(batch: list[str]) -> list[list[float]]:
        async with gate:
            resp = await _get_client().embeddings.create(
                model=EMBED_MODEL, input=[t[:MAX_EMBED_CHARS] or " " for t in batch])
        return [row.embedding for row in sorted(resp.data, key=lambda row: row.index)]

    rows = [vec for vecs in await asyncio.gather(*(one(b) for b in batches)) for vec in vecs]
    matrix = np.asarray(rows, dtype=np.float32)
    return matrix / np.linalg.norm(matrix, axis=1, keepdims=True)


async def chat_json(system: str, user: str, *, max_tokens: int = 2000) -> dict:
    resp = await _get_client().chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_format={"type": "json_object"},
        temperature=0,
        max_tokens=max_tokens,
        # Nemotron reasons before answering and that counts against max_tokens: the planner spent all 2,000
        # on it and returned nothing. These calls want short JSON, so thinking is off (2 s instead of 32 s).
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    )
    content = resp.choices[0].message.content or ""
    try:
        return json.loads(content, object_pairs_hook=merge_repeated_keys)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{LLM_MODEL} returned invalid JSON: {content[:200]!r}") from exc


def merge_repeated_keys(pairs: list[tuple[str, object]]) -> dict:
    """Nemotron can split one list over repeated keys ({"grades": [...], "grades": [...]}, one per grade) and
    plain json.loads keeps only the last: 47 of ~130 papers went ungraded in one search. Lists are joined."""
    out: dict = {}
    for key, value in pairs:
        out[key] = out[key] + value if isinstance(out.get(key), list) and isinstance(value, list) else value
    return out


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(base_url=BASE_URL, api_key=os.environ["NEBIUS_API_KEY"],
                              max_retries=3, timeout=120)
    return _client
