"""HTTP API over the discovery engine. Run: uvicorn api:app"""
from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from engine import collection, http
from engine.discover import Candidate, Discovery, discover
from engine.paper import Paper


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await http.close()


app = FastAPI(title="Paper discovery", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])


MAX_SEEDS = 30


class DiscoverRequest(BaseModel):
    question: str = Field(min_length=3)
    seeds: list[str] = Field(min_length=1, max_length=MAX_SEEDS, description="PMIDs, DOIs, PubMed URLs or titles")
    limit: int = Field(50, ge=1, le=200)


class CollectionRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5_000_000, description="A RIS, MEDLINE, BibTeX or CSV export")


@app.get("/health")
async def health() -> dict:
    """Which keys are configured, so the UI can say why a search would fail before one is run."""
    return {"ok": True, "nebius": bool(os.getenv("NEBIUS_API_KEY")), "web": bool(os.getenv("TAVILY_API_KEY"))}


NO_KEY = "NEBIUS_API_KEY is not set on the server; it runs the embeddings and the LLM."
KEEP_ALIVE = 15     # seconds of silence before a comment line, so proxies keep a long search open


@app.post("/discover")
async def discover_route(req: DiscoverRequest) -> dict:
    if not os.getenv("NEBIUS_API_KEY"):
        raise HTTPException(503, NO_KEY)
    try:
        found = await discover(req.question, req.seeds, limit=req.limit)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _discovery_json(found)


@app.post("/discover/stream")
async def discover_stream(req: DiscoverRequest) -> StreamingResponse:
    """The same search as POST /discover, as server-sent events while it runs: stages, seeds, the plan, each
    channel's haul, the web agent's rounds, a provisional ranking, grades batch by batch, web context, the map,
    and finally `result` (the /discover payload) or `error`. Closing the connection cancels the search."""
    if not os.getenv("NEBIUS_API_KEY"):
        raise HTTPException(503, NO_KEY)
    queue: asyncio.Queue[tuple[str, dict] | None] = asyncio.Queue()

    def emit(event: str, **data) -> None:
        queue.put_nowait((event, _event_json(event, data)))

    async def work() -> None:
        try:
            emit("result", discovery=await discover(req.question, req.seeds, limit=req.limit, emit=emit))
        except ValueError as exc:
            emit("error", status=422, detail=str(exc))
        except Exception as exc:
            emit("error", status=500, detail=f"{type(exc).__name__}: {exc}")
        finally:
            queue.put_nowait(None)

    async def events():
        task = asyncio.create_task(work())
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=KEEP_ALIVE)
                except TimeoutError:
                    yield ": still working\n\n"
                    continue
                if item is None:
                    return
                event, data = item
                yield f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        finally:
            task.cancel()     # the browser went away: stop spending tokens on a search nobody will read

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/collection")
async def collection_route(req: CollectionRequest) -> dict:
    """A reference-manager export → seed references, so the UI can fill the seed box. Nothing is looked up
    here; the references are resolved when a search runs."""
    parsed = collection.parse(req.text)
    refs = list(dict.fromkeys(e.ref for e in parsed.entries if e.ref))
    if not refs:
        raise HTTPException(422, "No paper in this file has a PMID, DOI or title.")
    return {"format": parsed.format, "refs": refs, "entries": len(parsed.entries),
            "without_id": sum(e.ref is None for e in parsed.entries), "max_seeds": MAX_SEEDS}


def _event_json(event: str, data: dict) -> dict:
    """Engine objects in an event, as the same JSON shapes /discover returns."""
    if event == "result":
        return _discovery_json(data["discovery"])
    if event == "seeds":
        return {"seeds": [{"label": f"S{i}", **_paper_json(s), "grade": None} for i, s in enumerate(data["seeds"], 1)]}
    if event == "ranked":
        return {"results": [_result_json(c, None) for c in data["candidates"]]}
    if event == "graded":
        return {**{k: data[k] for k in ("done", "total", "papers")},
                "grades": [{"id": c.id, "grade": c.grade, "reason": c.reason, "quote": c.quote}
                           for c in data["candidates"]]}
    return data


def _discovery_json(d: Discovery) -> dict:
    return {
        "question": d.question,
        "seeds": [{"label": f"S{i}", **_paper_json(s), "grade": g}
                  for i, (s, g) in enumerate(zip(d.seeds, d.seed_grades, strict=True), 1)],
        "criteria": d.criteria,
        "queries": d.queries,
        "cutoff": d.cutoff,
        "results": [_result_json(c, d.cutoff) for c in d.results],
        "warnings": d.warnings,
        "stats": d.stats,
        "timings": d.timings,
        "web_trail": d.web_trail,
        "map": d.map,
    }


def _result_json(c: Candidate, cutoff: int | None) -> dict:
    nearest = max(range(len(c.seed_sims)), key=c.seed_sims.__getitem__)
    return {
        **_paper_json(c.paper),
        "grade": c.grade,
        "likely_relevant": c.grade is not None and cutoff is not None and c.grade >= cutoff,
        "reason": c.reason,
        "quote": c.quote,
        "sources": c.sources,
        "theme": c.theme,
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


# The UI is the built React app (make web-build), served here for one-container deploys or hosted on its own
# (VITE_API_BASE). Declared last so every API route above wins.
DIST = (Path(__file__).parent / "web" / "dist").resolve()


@app.get("/{path:path}", include_in_schema=False)
async def web_app(path: str) -> FileResponse:
    """Built files as they are; any other path is a client-side route, so it gets index.html."""
    if not (DIST / "index.html").is_file():
        raise HTTPException(404, "The web UI is not built. Run `make web-build`, or `make web` for the dev server.")
    file = (DIST / path).resolve()
    if path and file.is_file() and file.is_relative_to(DIST):
        return FileResponse(file)
    if Path(path).suffix:     # a missing file, e.g. a stale chunk after a redeploy: a real 404, not the app
        raise HTTPException(404, f"No file {path}")
    return FileResponse(DIST / "index.html")
