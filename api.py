"""HTTP API over the discovery engine. Run: uvicorn api:app"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from engine import http
from engine.discover import Candidate, Discovery, discover
from engine.paper import Paper


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await http.close()


app = FastAPI(title="Paper discovery", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])


class DiscoverRequest(BaseModel):
    question: str = Field(min_length=3)
    seeds: list[str] = Field(min_length=1, max_length=30, description="PMIDs, DOIs, PubMed URLs or titles")
    limit: int = Field(50, ge=1, le=200)


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


@app.post("/discover")
async def discover_route(req: DiscoverRequest) -> dict:
    try:
        found = await discover(req.question, req.seeds, limit=req.limit)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _discovery_json(found)


def _discovery_json(d: Discovery) -> dict:
    return {
        "question": d.question,
        "seeds": [{"label": f"S{i}", **_paper_json(s), "grade": g}
                  for i, (s, g) in enumerate(zip(d.seeds, d.seed_grades, strict=True), 1)],
        "criteria": d.criteria,
        "queries": d.queries,
        "cutoff": d.cutoff,
        "results": [_result_json(c, d) for c in d.results],
        "warnings": d.warnings,
        "stats": d.stats,
        "timings": d.timings,
    }


def _result_json(c: Candidate, d: Discovery) -> dict:
    nearest = max(range(len(c.seed_sims)), key=c.seed_sims.__getitem__)
    return {
        **_paper_json(c.paper),
        "grade": c.grade,
        "likely_relevant": c.grade is not None and d.cutoff is not None and c.grade >= d.cutoff,
        "reason": c.reason,
        "quote": c.quote,
        "found_via": list(dict.fromkeys(h.note for h in c.hits)),
        "channels": sorted({h.channel for h in c.hits}),
        "cites_seeds": [f"S{i + 1}" for i in c.cites_seeds],
        "cited_by_seeds": [f"S{i + 1}" for i in c.cited_by_seeds],
        "nearest_seed": {"label": f"S{nearest + 1}", "similarity": c.seed_sims[nearest]},
        "scores": {"fused": c.fused, "seed_similarity": c.seed_sim, "question_similarity": c.question_sim,
                   "cocited": c.cocited, "shared_references": c.coupled},
    }


def _paper_json(p: Paper) -> dict:
    return {"id": p.id, "title": p.title, "abstract": p.abstract, "year": p.year, "venue": p.venue,
            "authors": p.authors, "doi": p.doi, "pmid": p.pmid, "citations": p.citations,
            "rcr": p.rcr, "preprint": p.preprint, "types": p.types, "links": p.links}
