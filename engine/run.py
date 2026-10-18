"""One run: seeds + question → screened, explained, traceable results, streamed as events.

0 resolve · 1 rubric · 2 channels · 3 merge · 4 enrich and clean · 5 embed · 6 pre-rank · 7 screen
· 8 verify quotes · 9 score and show · 10 explain. Why each step looks like this: ARCHITECTURE.md.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from collections import defaultdict
from collections.abc import Awaitable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from engine import channels, europepmc, icite, language, nebius, pubmed, seeds as seed_lookup
from engine.channels import Found, Provenance, SeedGraph
from engine.paper import Paper

PRERANK_WEIGHTS = {"citations": 0.45, "similar": 0.30, "meaning": 0.25}
WEIGHTS = {"citations": 0.35, "similar": 0.20, "meaning": 0.15, "fit": 0.30}
POOL_CAP = 1000
SCREEN_TOP = 150
# Slots for Search and Web papers closest in meaning: new work has no citations to rank on yet.
SCREEN_RESERVED = 20
EXPLAIN_TOP = 25
FALLBACK_RESULTS = 50     # shown, ranked without grades, when screening is unavailable
CHANNEL_TIMEOUT = 25.0
CLOSE_IN_MEANING = 0.7
RRF_K = 60
NOT_ARTICLE = {"Comment", "Erratum", "Published Erratum", "Editorial", "Letter", "News", "Newspaper Article",
               "Retraction of Publication", "Expression of Concern"}
STAGES = ["resolve", "rubric", "citations", "cocited", "similar", "search", "web", "keyword_check",
          "merge", "enrich", "embed", "screen", "explain"]
RUNS_DIR = Path(os.getenv("RUNS_DIR", ".runs"))
RUNS: dict[str, Run] = {}
log = logging.getLogger("snowball")


class UserError(Exception):
    """A failure whose message is written for the researcher."""


@dataclass
class Options:
    year_from: int | None = None
    year_to: int | None = None
    include_preprints: bool = True
    before: str | None = None       # ISO date: only papers published up to then


@dataclass(eq=False)
class Candidate:
    id: str
    found_by: list[Provenance] = field(default_factory=list)
    paper: Paper | None = None
    seed_sims: dict[str, float] = field(default_factory=dict)    # seed label → cosine
    question_sim: float = 0.0
    shared_refs: int = 0
    signals: dict[str, float] = field(default_factory=dict)      # each normalised to 0-1
    prerank: float = 0.0
    score: float = 0.0
    screened: language.Screened | None = None
    explained: language.Explained | None = None
    quote: str | None = None
    in_keyword_search: bool = False

    @property
    def grade(self) -> int | None:
        if self.explained and not self.explained.abstain:
            return self.explained.grade
        return self.screened.grade if self.screened else None

    @property
    def nearest_seed(self) -> str | None:
        return max(self.seed_sims, key=self.seed_sims.get) if self.seed_sims else None

    def via(self, channel: str, relation: str | None = None) -> list[str]:
        """Seed labels this candidate links to through one channel (and relation), in order."""
        return list(dict.fromkeys(p.via for p in self.found_by
                                  if p.channel == channel and (relation is None or p.relation == relation)))


def start(lines: list[str], question: str | None, options: Options) -> Run:
    run = Run(question=question, options=options)
    RUNS[run.id] = run
    run.task = asyncio.create_task(run.execute(lines))
    return run


class Run:
    def __init__(self, *, question: str | None, options: Options):
        self.id = uuid.uuid4().hex[:12]
        self.created_at = datetime.now(UTC).isoformat(timespec="seconds")
        self.question = question
        self.options = options
        self.status = "running"
        self.seeds: dict[str, Paper] = {}
        self.rubric: language.Rubric | None = None
        self.stages = {name: {"name": name, "status": "waiting"} for name in STAGES}
        self.funnel = {"found": 0, "new": 0, "screened": 0, "relevant": 0, "related": 0}
        self.left_out: dict[str, list[Candidate]] = defaultdict(list)
        self.results: list[Candidate] = []
        self.grades_unavailable = False
        self.timings: dict[str, int] = {}
        self.events: list[tuple[str, dict]] = []
        self._listeners: list[asyncio.Queue] = []
        self.task: asyncio.Task | None = None

    # --- events -------------------------------------------------------------

    def emit(self, event: str, data: dict) -> None:
        self.events.append((event, data))
        for queue in self._listeners:
            queue.put_nowait((event, data))

    def listen(self) -> asyncio.Queue:
        """Every event so far, then each new one as it happens."""
        queue: asyncio.Queue = asyncio.Queue()
        for event in self.events:
            queue.put_nowait(event)
        self._listeners.append(queue)
        return queue

    def unlisten(self, queue: asyncio.Queue) -> None:
        self._listeners.remove(queue)

    def set_stage(self, name: str, status: str, **extra) -> None:
        stage = self.stages[name]
        stage.update(status=status, **{k: v for k, v in extra.items() if v is not None})
        if "ms" in extra:
            self.timings[name] = extra["ms"]
        self.emit("stage", dict(stage))

    # --- the run ------------------------------------------------------------

    async def execute(self, lines: list[str]) -> None:
        try:
            await self._discover(lines)
            self.status = "done"
            self.emit("done", {"timings": self.timings})
        except UserError as exc:
            self.status = "error"
            self.emit("error", {"message": str(exc)})
        except Exception:
            log.exception("run %s failed", self.id)
            self.status = "error"
            self.emit("error", {"message": "Something went wrong on our side. Try again in a minute."})
        finally:
            self._save()

    async def _discover(self, lines: list[str]) -> None:
        await self._resolve(lines)
        before = self.options.before
        rubric_task = asyncio.create_task(self._draft_rubric())
        graph_task = asyncio.create_task(channels.seed_graph(self.seeds, before))
        seed_pmids = {p.pmid for p in self.seeds.values() if p.pmid}

        # Shared tasks are shielded: a channel timing out must not cancel them for the others.
        async def citations() -> Found:
            return channels.citations(await asyncio.shield(graph_task))

        async def cocited() -> Found:
            return await channels.cocited(await asyncio.shield(graph_task), seed_pmids)

        async def search() -> Found:
            rubric = await asyncio.shield(rubric_task)
            if rubric is None and not self.question:
                raise UserError("needs the question or the rubric")
            queries = rubric.queries if rubric else [self.question]
            return await channels.search(queries, self._question(rubric), before=before,
                                         include_preprints=self.options.include_preprints)

        async def web() -> Found:
            if before:
                raise UserError("the web can't be limited to a past date")
            rubric = await asyncio.shield(rubric_task)
            if rubric is None and not self.question:
                raise UserError("needs the question or the rubric")
            return await channels.web_search(rubric.queries if rubric else [self.question])

        async def keyword_check() -> set[str]:
            return await channels.keyword_check(self._question(await asyncio.shield(rubric_task)), before)

        names = ["citations", "cocited", "similar", "search", "web"]
        *results, keyword_hits = await asyncio.gather(
            self._channel("citations", citations()), self._channel("cocited", cocited()),
            self._channel("similar", channels.similar(self.seeds)), self._channel("search", search()),
            self._channel("web", web()), self._channel("keyword_check", keyword_check()))
        found = {name: f for name, f in zip(names, results, strict=True) if f is not None}
        if not found:
            raise UserError("We couldn't reach the paper databases. Try again in a minute.")
        self.rubric = await rubric_task
        graph_ok = graph_task.done() and not graph_task.cancelled() and graph_task.exception() is None
        graph = graph_task.result() if graph_ok else None

        pool = self._merge(list(found.values()))
        pool = await self._enrich_and_clean(pool, graph)
        for c in pool:
            c.in_keyword_search = c.id in (keyword_hits or set())
        await self._embed(pool)
        self._signals(pool, found.get("cocited"))
        await self._screen(pool)
        self._score_and_show(pool)
        await self._explain()

    async def _resolve(self, lines: list[str]) -> None:
        self.set_stage("resolve", "running")
        start_time = time.monotonic()
        resolved = await seed_lookup.resolve(lines)
        found = [r.seed for r in resolved if r.status == "found" and not r.note]
        if not found:
            raise UserError("None of your papers could be found. Check the DOIs or PMIDs, or paste the titles.")
        self.seeds = {f"S{i}": paper for i, paper in enumerate(found, 1)}
        self.set_stage("resolve", "done", count=len(self.seeds), ms=_ms(start_time))
        self.emit("seeds", {"seeds": self._seeds_json()})

    async def _draft_rubric(self) -> language.Rubric | None:
        self.set_stage("rubric", "running")
        start_time = time.monotonic()
        try:
            rubric = await language.draft_rubric(self.question, list(self.seeds.values()))
        except Exception as exc:
            log.warning("run %s: rubric unavailable: %s", self.id, exc)
            self.set_stage("rubric", "unavailable", ms=_ms(start_time), note="Using your question as the only query")
            return None
        self.set_stage("rubric", "done", ms=_ms(start_time))
        self.emit("rubric", rubric.model_dump())
        return rubric

    async def _channel(self, name: str, work: Awaitable):
        """One channel or check. Failure or timeout marks it unavailable; the run goes on without it."""
        self.set_stage(name, "running")
        start_time = time.monotonic()
        try:
            result = await asyncio.wait_for(work, CHANNEL_TIMEOUT)
        except Exception as exc:
            log.warning("run %s: %s unavailable: %r", self.id, name, exc)
            note = str(exc) if isinstance(exc, UserError) else "Unavailable: results use the other channels"
            self.set_stage(name, "unavailable", ms=_ms(start_time), note=note)
            return None
        count = len(result.hits) if isinstance(result, Found) else len(result)
        self.set_stage(name, "done", count=count, ms=_ms(start_time))
        return result

    def _question(self, rubric: language.Rubric | None) -> str:
        return self.question or (rubric.question if rubric else " ".join(s.title for s in self.seeds.values()))

    # --- merge, enrich, clean -------------------------------------------------

    def _merge(self, found: list[Found]) -> list[Candidate]:
        self.set_stage("merge", "running")
        start_time = time.monotonic()
        pool: dict[str, Candidate] = {}
        for f in found:
            for cid, provs in f.hits.items():
                cand = pool.setdefault(cid, Candidate(cid))
                cand.found_by += provs
                cand.paper = cand.paper or f.papers.get(cid)
        self.funnel["found"] = len(pool)
        seed_ids = {s.id for s in self.seeds.values()} | {f"doi:{s.doi}" for s in self.seeds.values() if s.doi}
        for cid in seed_ids & pool.keys():
            self.left_out["seed"].append(pool.pop(cid))

        fused = _rrf([[cid for cid in f.ranking if cid in pool] for f in found])
        ordered = sorted(pool.values(), key=lambda c: fused.get(c.id, 0.0), reverse=True)
        self.left_out["below_cutoff"] += ordered[POOL_CAP:]
        self.set_stage("merge", "done", count=min(len(ordered), POOL_CAP), ms=_ms(start_time))
        return ordered[:POOL_CAP]

    async def _enrich_and_clean(self, pool: list[Candidate], graph: SeedGraph | None) -> list[Candidate]:
        self.set_stage("enrich", "running")
        start_time = time.monotonic()
        by_id = {c.id: c for c in pool}
        missing = [c.id.removeprefix("pmid:") for c in pool if c.paper is None and c.id.startswith("pmid:")]
        for paper in await pubmed.fetch(missing):
            by_id[paper.id].paper = paper

        dois = [c.id.removeprefix("doi:") for c in pool if c.paper is None and c.id.startswith("doi:")]
        looked_up = await asyncio.gather(*(europepmc.by_doi(d) for d in dois), return_exceptions=True)
        for doi, paper in zip(dois, looked_up, strict=True):
            if isinstance(paper, Paper):
                cand = by_id.pop(f"doi:{doi}")
                # Europe PMC may know the DOI's PMID: then the paper lives under that id.
                target = by_id.setdefault(paper.id, Candidate(paper.id, paper=paper))
                target.found_by += cand.found_by
                target.paper = target.paper or paper

        pmids = [c.paper.pmid for c in by_id.values() if c.paper and c.paper.pmid]
        metrics = await icite.fetch(pmids)
        seed_refs = set().union(*graph.refs.values()) if graph else set()
        for c in by_id.values():
            record = metrics.get(c.paper.pmid) if c.paper and c.paper.pmid else None
            if record:
                c.paper.cited_by, c.paper.rcr, c.paper.hac = record.citations, record.rcr, record.hac
                c.paper.is_clinical, c.paper.clinical_citations = record.is_clinical, record.clinical_citations
                c.shared_refs = len(record.references & seed_refs)

        kept = self._clean(list(by_id.values()))
        self.funnel["new"] = len(kept)
        self.set_stage("enrich", "done", count=len(kept), ms=_ms(start_time))
        return kept

    def _clean(self, pool: list[Candidate]) -> list[Candidate]:
        o = self.options
        kept, published = [], {}
        for c in pool:
            p = c.paper
            reason = (
                "no_record" if p is None or not p.title else
                "seed" if p.id in {s.id for s in self.seeds.values()} else
                "retracted" if p.is_retracted else
                "not_article" if NOT_ARTICLE & set(p.pub_types) else
                "excluded_preprint" if p.is_preprint and not o.include_preprints else
                "outside_dates" if _outside(p, o) else None
            )
            if reason:
                self.left_out[reason].append(c)
                continue
            kept.append(c)
            if not p.is_preprint:
                published[_version_key(p)] = c
        # A preprint and its published version are one paper: keep the published one.
        merged = []
        for c in kept:
            twin = published.get(_version_key(c.paper)) if c.paper.is_preprint else None
            if twin is None:
                merged.append(c)
                continue
            twin.found_by += c.found_by
            twin.paper.preprint_of = c.paper.doi
            self.left_out["duplicate"].append(c)
        return merged

    # --- rank -----------------------------------------------------------------

    async def _embed(self, pool: list[Candidate]) -> None:
        self.set_stage("embed", "running")
        start_time = time.monotonic()
        question = self._question(self.rubric)
        texts = {"question": nebius.QUERY_INSTRUCTION + question}
        texts |= {s.id: s.text for s in self.seeds.values()} | {c.id: c.paper.text for c in pool}
        vectors = await nebius.embed(texts)
        for c in pool:
            vec = vectors[c.id]
            c.seed_sims = {label: round(float(vec @ vectors[s.id]), 4) for label, s in self.seeds.items()}
            c.question_sim = round(float(vec @ vectors["question"]), 4)
        self.set_stage("embed", "done", count=len(pool), ms=_ms(start_time))

    def _signals(self, pool: list[Candidate], cocited: Found | None) -> None:
        cocited_rank = {cid: i for i, cid in enumerate(cocited.ranking, 1)} if cocited else {}
        linked = [c for c in pool if c.via("citations")]
        linked.sort(key=lambda c: (len(c.via("citations")), c.paper.cited_by or 0), reverse=True)
        citations_rank = {c.id: i for i, c in enumerate(linked, 1)}
        coupled = sorted((c for c in pool if c.shared_refs), key=lambda c: c.shared_refs, reverse=True)
        coupled_rank = {c.id: i for i, c in enumerate(coupled, 1)}

        raw: dict[str, list[float]] = defaultdict(list)
        for c in pool:
            raw["citations"].append(sum(1 / (RRF_K + r[c.id]) for r in (citations_rank, cocited_rank, coupled_rank)
                                        if c.id in r))
            raw["similar"].append(sum(1 / (RRF_K + p.rank) for p in c.found_by if p.channel == "similar"))
            raw["meaning"].append(0.7 * max(c.seed_sims.values()) + 0.3 * c.question_sim)
        for name, values in raw.items():
            for c, value in zip(pool, _min_max(values), strict=True):
                c.signals[name] = round(value, 4)
        for c in pool:
            c.prerank = sum(w * c.signals[k] for k, w in PRERANK_WEIGHTS.items())

    async def _screen(self, pool: list[Candidate]) -> None:
        if self.rubric is None:
            self.grades_unavailable = True
            self.set_stage("screen", "unavailable", note="Grades unavailable right now; ranked without Nemotron")
            return
        by_prerank = sorted(pool, key=lambda c: c.prerank, reverse=True)
        chosen = by_prerank[:SCREEN_TOP - SCREEN_RESERVED]
        fresh = [c for c in by_prerank[len(chosen):] if c.via("search") or any(p.channel == "web" for p in c.found_by)]
        chosen += sorted(fresh, key=lambda c: c.signals["meaning"], reverse=True)[:SCREEN_RESERVED]

        self.set_stage("screen", "running", count=0, note=f"of {len(chosen)}")
        start_time = time.monotonic()
        done = 0

        def progress(n: int) -> None:
            nonlocal done
            done += n
            self.set_stage("screen", "running", count=done)

        try:
            grades = await language.screen(self.rubric, list(self.seeds.values()), [c.paper for c in chosen], progress)
        except Exception as exc:
            log.warning("run %s: screening unavailable: %s", self.id, exc)
            self.grades_unavailable = True
            self.set_stage("screen", "unavailable", ms=_ms(start_time),
                           note="Grades unavailable right now; ranked without Nemotron")
            return
        for c in chosen:
            c.screened = grades.get(c.paper.id)
            if c.screened and c.screened.quote:
                c.quote = language.verify_quote(c.screened.quote, c.paper.abstract)
        missed = sum(c.screened is None for c in chosen)
        self.set_stage("screen", "done", count=len(chosen) - missed, ms=_ms(start_time),
                       note=f"{missed} could not be screened" if missed else None)

    def _score_and_show(self, pool: list[Candidate]) -> None:
        for c in pool:
            fit = (c.grade or 0) / 3
            c.score = round(sum(WEIGHTS[k] * c.signals[k] for k in PRERANK_WEIGHTS) + WEIGHTS["fit"] * fit, 4)
        pool.sort(key=lambda c: c.score, reverse=True)
        if self.grades_unavailable:
            self.results = pool[:FALLBACK_RESULTS]
            self.left_out["below_cutoff"] += pool[FALLBACK_RESULTS:]
        else:
            self.results = [c for c in pool if c.grade]
            self.left_out["graded_0"] += [c for c in pool if c.grade == 0]
            self.left_out["below_cutoff"] += [c for c in pool if c.grade is None]
        self.funnel["screened"] = sum(c.screened is not None for c in pool)
        self._count_relevant()
        self.emit("results", self._results_json())

    async def _explain(self) -> None:
        top = [c for c in self.results if (c.grade or 0) >= 2][:EXPLAIN_TOP]
        if not top or self.rubric is None:
            self.set_stage("explain", "done", count=0)
            return
        self.set_stage("explain", "running", count=0, note=f"of {len(top)}")
        start_time = time.monotonic()
        by_id = {c.paper.id: c for c in top}

        def landed(paper_id: str, item: language.Explained) -> None:
            c = by_id[paper_id]
            c.explained = item
            self.emit("explained", {"id": c.id, "grade": c.grade, "relation": item.relation,
                                    "reason": item.reason, "abstain": item.abstain})
            self.set_stage("explain", "running", count=sum(x.explained is not None for x in top))

        try:
            await language.explain(self.rubric, list(self.seeds.values()),
                                   [(c.paper, "; ".join(self._chips(c))) for c in top], landed)
        except Exception as exc:
            log.warning("run %s: explaining unavailable: %s", self.id, exc)
            self.set_stage("explain", "unavailable", ms=_ms(start_time), note="Cards keep the short reason")
            return
        self.set_stage("explain", "done", count=sum(c.explained is not None for c in top), ms=_ms(start_time))
        # Super's grade replaces Lightning's, which can move papers: re-score and re-send the list.
        self._score_and_show(self.results + self.left_out.pop("graded_0", []))

    def _count_relevant(self) -> None:
        self.funnel["relevant"] = sum((c.grade or 0) >= 2 for c in self.results)
        self.funnel["related"] = sum(c.grade == 1 for c in self.results)

    # --- output ---------------------------------------------------------------

    def _chips(self, c: Candidate) -> list[str]:
        """The seed connections, in the spec's order, as plain sentences."""
        chips = []
        if cites := c.via("citations", "cites"):
            chips.append(f"Cites {', '.join(cites)}")
        if cited := c.via("citations", "cited_by"):
            chips.append(f"Cited by {', '.join(cited)}")
        if cocited := sorted((p for p in c.found_by if p.channel == "cocited"), key=lambda p: -p.count):
            chips.append("Co-cited with " + ", ".join(f"{p.via} ({p.count}×)" for p in cocited))
        if similar := sorted((p for p in c.found_by if p.channel == "similar"), key=lambda p: p.rank):
            chips.append("PubMed similar to " + ", ".join(f"{p.via} (rank {p.rank})" for p in similar))
        if c.shared_refs:
            chips.append(f"Shares {c.shared_refs} references with your seeds")
        if c.signals.get("meaning", 0) >= CLOSE_IN_MEANING and c.nearest_seed:
            chips.append(f"Close in meaning to {c.nearest_seed}")
        if any(p.channel == "web" for p in c.found_by):
            chips.append("Found on the web")
        if c.paper and c.paper.pmid and not c.in_keyword_search:
            chips.append("Not in keyword search")
        return chips

    def _result_json(self, c: Candidate) -> dict:
        s, e = c.screened, c.explained
        nearest = c.nearest_seed
        return {
            **c.paper.to_json(),
            "round": 1,
            "foundBy": [p.to_json() for p in c.found_by],
            "signals": c.signals, "prerank": round(c.prerank, 4), "score": c.score,
            "grade": c.grade, "gradedBy": "super" if e and not e.abstain else ("lightning" if s else None),
            "gradeLightning": s.grade if s else None,
            "match": s.match.model_dump() if s else None,
            "quote": {"text": c.quote, "verified": True} if c.quote else None,
            "reasonShort": s.reason if s else None,
            "reason": e.reason if e else None, "relation": e.relation if e else None,
            "abstain": e.abstain if e else None,
            "inKeywordSearch": c.in_keyword_search,
            "nearestSeed": nearest, "nearestSimilarity": c.seed_sims.get(nearest) if nearest else None,
            "sharedReferences": c.shared_refs,
            "chips": self._chips(c),
            "scoreParts": self._score_parts(c),
        }

    def _score_parts(self, c: Candidate) -> list[dict]:
        """Each part of the score with one plain sentence, so every number on screen can be checked."""
        links = [x for x in self._chips(c) if x.startswith(("Cites", "Cited by", "Co-cited", "Shares"))]
        similar = [x for x in self._chips(c) if x.startswith("PubMed similar")]
        nearest = c.nearest_seed
        graded = (f"Graded {c.grade} of 3 by Nemotron 3 Super" if c.explained and not c.explained.abstain else
                  f"Graded {c.grade} of 3 by Nemotron 3.5 Lightning" if c.screened else "Not screened")
        return [
            {"name": "Citations", "value": round(WEIGHTS["citations"] * c.signals["citations"], 3),
             "sentence": "; ".join(links) or "No citation links to your seeds"},
            {"name": "Similar", "value": round(WEIGHTS["similar"] * c.signals["similar"], 3),
             "sentence": "; ".join(similar) or "Not in PubMed's similar lists for your seeds"},
            {"name": "Meaning", "value": round(WEIGHTS["meaning"] * c.signals["meaning"], 3),
             "sentence": f"Closest to {nearest} (similarity {c.seed_sims[nearest]:.2f})" if nearest else ""},
            {"name": "Fit", "value": round(WEIGHTS["fit"] * (c.grade or 0) / 3, 3), "sentence": graded},
        ]

    def _results_json(self) -> dict:
        return {"results": [self._result_json(c) for c in self.results], "funnel": self.funnel,
                "leftOut": self._left_out_json(), "gradesUnavailable": self.grades_unavailable}

    def _left_out_json(self) -> list[dict]:
        out = []
        for reason, cands in self.left_out.items():
            entry = {"reason": reason, "count": len(cands), "ids": [c.id for c in cands]}
            if reason == "retracted":
                entry["titles"] = [c.paper.title for c in cands if c.paper]
            out.append(entry)
        return out

    def _seeds_json(self) -> list[dict]:
        return [{"label": label, **p.to_json()} for label, p in self.seeds.items()]

    def snapshot(self) -> dict:
        return {
            "id": self.id, "createdAt": self.created_at, "status": self.status,
            "seeds": self._seeds_json(), "question": self._question(self.rubric) if self.seeds else self.question,
            "rubric": self.rubric.model_dump() if self.rubric else None,
            "options": self.options.__dict__, "stages": list(self.stages.values()),
            **self._results_json(),
            "models": {"rubric": nebius.MODEL_RUBRIC, "screen": nebius.MODEL_SCREEN,
                       "explain": nebius.MODEL_EXPLAIN, "embed": nebius.MODEL_EMBED},
            "weights": WEIGHTS, "timings": self.timings,
        }

    def _save(self) -> None:
        RUNS_DIR.mkdir(parents=True, exist_ok=True)
        (RUNS_DIR / f"{self.id}.json").write_text(json.dumps(self.snapshot(), ensure_ascii=False))


def _rrf(rankings: list[list[str]]) -> dict[str, float]:
    fused: dict[str, float] = defaultdict(float)
    for ranking in rankings:
        for position, cid in enumerate(ranking, 1):
            fused[cid] += 1 / (RRF_K + position)
    return fused


def _min_max(values: list[float]) -> list[float]:
    lo, hi = min(values, default=0.0), max(values, default=0.0)
    return [0.0 if hi == lo else (v - lo) / (hi - lo) for v in values]


def _outside(p: Paper, o: Options) -> bool:
    if o.year_from and p.year and p.year < o.year_from:
        return True
    if o.year_to and p.year and p.year > o.year_to:
        return True
    return bool(o.before and p.date and p.date[:len(o.before)] > o.before)


def _version_key(p: Paper) -> tuple[str, str]:
    surname = (p.authors[0].split()[0] if p.authors else "").lower()
    return re.sub(r"[^a-z0-9]", "", p.title.lower()), surname


def _ms(start: float) -> int:
    return int((time.monotonic() - start) * 1000)
