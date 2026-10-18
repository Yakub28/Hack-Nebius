"""HTTP API and the built web app, in one process. Run: uvicorn api:app"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from engine import export, http, run, seeds

WEB_DIR = Path(__file__).parent / "web"
HEARTBEAT_SECONDS = 15
MAX_CONCURRENT_RUNS = int(os.getenv("MAX_CONCURRENT_RUNS", "5"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await http.close()


app = FastAPI(title="Snowball", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])


class ResolveRequest(BaseModel):
    lines: list[str] = Field(max_length=60)


class RunOptions(BaseModel):
    yearFrom: int | None = None
    yearTo: int | None = None
    includePreprints: bool = True
    before: str | None = Field(None, pattern=r"^\d{4}(-\d{2}(-\d{2})?)?$")


class RunRequest(BaseModel):
    seeds: list[str] = Field(min_length=1, max_length=30)
    question: str | None = None
    options: RunOptions = RunOptions()


class ExportRequest(BaseModel):
    runId: str
    ids: list[str] | None = None        # default: every relevant result
    format: Literal["ris", "csv"]


@app.get("/healthz", response_class=PlainTextResponse)
async def healthz() -> str:
    return "ok"


@app.get("/api/status")
async def status() -> dict:
    """Which services are configured, so the UI can say why a run would fail before one starts."""
    return {"nebius": bool(os.getenv("NEBIUS_API_KEY")), "tavily": bool(os.getenv("TAVILY_API_KEY")),
            "openalex": bool(os.getenv("OPENALEX_API_KEY")), "ncbi": bool(os.getenv("NCBI_API_KEY"))}


@app.post("/api/seeds/resolve")
async def resolve_seeds(req: ResolveRequest) -> list[dict]:
    return [{"line": r.line, "status": r.status, "note": r.note,
             "seed": r.seed.to_json() if r.seed else None,
             "options": [p.to_json() for p in r.options]}
            for r in await seeds.resolve(req.lines)]


@app.post("/api/runs")
async def create_run(req: RunRequest) -> dict:
    if not os.getenv("NEBIUS_API_KEY"):
        raise HTTPException(503, "NEBIUS_API_KEY is not set on the server; it runs the embeddings and Nemotron.")
    if sum(r.status == "running" for r in run.RUNS.values()) >= MAX_CONCURRENT_RUNS:
        raise HTTPException(429, "Snowball is busy right now. Try again in a minute.")
    o = req.options
    started = run.start(req.seeds, (req.question or "").strip() or None,
                        run.Options(year_from=o.yearFrom, year_to=o.yearTo,
                                    include_preprints=o.includePreprints, before=o.before))
    return {"runId": started.id}


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str) -> dict:
    return _run(run_id).snapshot()


@app.get("/api/runs/{run_id}/events")
async def run_events(run_id: str) -> StreamingResponse:
    current = _run(run_id)

    async def stream():
        queue = current.listen()
        try:
            while True:
                try:
                    event, data = await asyncio.wait_for(queue.get(), HEARTBEAT_SECONDS)
                except TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                yield f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
                if event in ("done", "error"):
                    return
        finally:
            current.unlisten(queue)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/export")
async def export_results(req: ExportRequest) -> PlainTextResponse:
    current = _run(req.runId)
    chosen = [c for c in current.results if (req.ids is None and (c.grade or 0) >= 2) or
              (req.ids is not None and c.id in req.ids)]
    if req.format == "ris":
        body, media, ext = export.ris(chosen), "application/x-research-info-systems", "ris"
    else:
        body, media, ext = export.csv_text(chosen), "text/csv", "csv"
    return PlainTextResponse(body, media_type=media,
                             headers={"Content-Disposition": f'attachment; filename="snowball-{current.id}.{ext}"'})


def _run(run_id: str) -> run.Run:
    if run_id not in run.RUNS:
        raise HTTPException(404, "This run is no longer on the server. Start a new one.")
    return run.RUNS[run_id]


# The UI is static files: served here for one-container deploys, or hosted on its own (web/config.js).
# Mounted last so the API routes above take precedence.
if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
