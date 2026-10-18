"""Nebius Token Factory: embeddings and validated JSON from the Nemotron models."""
from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Literal, TypeVar

import numpy as np
from openai import AsyncOpenAI
from pydantic import BaseModel, ValidationError

BASE_URL = os.getenv("TOKEN_FACTORY_BASE_URL", "https://api.tokenfactory.nebius.com/v1/")
MODEL_RUBRIC = os.getenv("MODEL_RUBRIC", "nvidia/nemotron-3-super-120b-a12b")
MODEL_SCREEN = os.getenv("MODEL_SCREEN", "nvidia/Nemotron-3_5-Lightning")
MODEL_EXPLAIN = os.getenv("MODEL_EXPLAIN", "nvidia/nemotron-3-super-120b-a12b")
MODEL_EMBED = os.getenv("MODEL_EMBED", "Qwen/Qwen3-Embedding-8B")
EMBED_BATCH = 64
EMBED_CONCURRENCY = 4
# Qwen3-Embedding is instruction-aware on the query side only; papers are embedded bare.
QUERY_INSTRUCTION = "Instruct: Given a biomedical research question, retrieve relevant paper abstracts\nQuery: "
THINKING = {
    "off": {"enable_thinking": False},
    "low": {"enable_thinking": True, "low_effort": True},
}
_THINK_RE = re.compile(r"<think>.*?</think>", re.S)

Model = TypeVar("Model", bound=BaseModel)
_client: AsyncOpenAI | None = None
_embedded: dict[str, np.ndarray] = {}


async def embed(keyed_texts: dict[str, str]) -> dict[str, np.ndarray]:
    """Unit-normalised embeddings by key, so a dot product is a cosine. Cached by key for the process."""
    missing = [k for k in keyed_texts if k not in _embedded]
    batches = [missing[i:i + EMBED_BATCH] for i in range(0, len(missing), EMBED_BATCH)]
    gate = asyncio.Semaphore(EMBED_CONCURRENCY)

    async def one(keys: list[str]) -> None:
        async with gate:
            resp = await _get_client().embeddings.create(model=MODEL_EMBED,
                                                         input=[keyed_texts[k] or " " for k in keys])
        for key, row in zip(keys, sorted(resp.data, key=lambda row: row.index), strict=True):
            vec = np.asarray(row.embedding, dtype=np.float32)
            _embedded[key] = vec / np.linalg.norm(vec)

    await asyncio.gather(*(one(b) for b in batches))
    return {k: _embedded[k] for k in keyed_texts}


async def chat_json(schema: type[Model], *, model: str, system: str, user: str,
                    thinking: Literal["off", "low"], temperature: float, max_tokens: int) -> Model:
    """The model's answer parsed into `schema`. One repair retry sends the validation error back."""
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    for attempt in (1, 2):
        resp = await _get_client().chat.completions.create(
            model=model, messages=messages, temperature=temperature, top_p=0.95, max_tokens=max_tokens,
            response_format={"type": "json_object"},
            extra_body={"chat_template_kwargs": THINKING[thinking]},
        )
        content = resp.choices[0].message.content or ""
        try:
            return schema.model_validate(json.loads(_json_part(content)))
        except (ValueError, ValidationError) as exc:
            if attempt == 2:
                raise ValueError(f"{model} returned unusable JSON: {exc}") from exc
            messages += [{"role": "assistant", "content": content},
                         {"role": "user", "content": f"That reply was invalid: {exc}. Reply again with JSON "
                                                     "that matches the requested schema exactly."}]
    raise AssertionError("unreachable")


def _json_part(content: str) -> str:
    # If the thinking flags are ignored, the reasoning arrives inline before the answer.
    text = _THINK_RE.sub("", content).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError(f"no JSON object in {text[:200]!r}")
    return text[start:end + 1]


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(base_url=BASE_URL, api_key=os.environ["NEBIUS_API_KEY"], max_retries=2, timeout=90)
    return _client
