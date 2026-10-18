"""Seeds + question → ranked, traceable new papers. The whole pipeline, top to bottom.

1. resolve      seeds to PubMed records
2. plan         LLM: inclusion criteria + search queries, from the question and seeds
3. graph        the seeds' citation neighbourhood (iCite + Europe PMC)
4. candidates   eight channels; every hit records where it came from
5. hydrate      PubMed records + iCite metrics for every candidate
6. first stage  Qwen3 embeddings + citation signals, fused with RRF
7. judge        LLM grades the strongest candidates, and the seeds to calibrate the scale

Why each step looks like this: ARCHITECTURE.md.
"""
from __future__ import annotations

import asyncio
import time
from collections import Counter
from collections.abc import Awaitable
from dataclasses import dataclass, field

from engine import europepmc, icite, nebius, pubmed, s2, web
from engine.paper import Paper, paper_id

SIMILAR_PER_SEED = 50
CITERS_KEPT = 300
CITERS_SCANNED = 3000      # the seeds' citers whose reference lists feed co-citation
COCITED_KEPT = 200
QUERY_HITS = 40
PREPRINT_HITS = 25
WEB_HITS = 10
RECENT_HITS = 100
RRF_K = 60
# Judge the top of the fused list, plus the semantically strongest candidates: brand-new
# papers have no citations yet, so the fusion alone would rarely let them through.
JUDGE_FUSED = 120
JUDGE_SEMANTIC = 30
JUDGE_BATCH = 8
JUDGE_CONCURRENCY = 6
MAX_ABSTRACT_CHARS = 2500
# Not research findings, or not safe to recommend.
DROPPED_TYPES = {"Comment", "Erratum", "Published Erratum", "Retracted Publication",
                 "Retraction of Publication", "Expression of Concern", "News", "Newspaper Article"}


@dataclass
class Hit:
    channel: str    # similar | cites | refs | cocited | query | preprint | web | recent
    rank: int       # 1 = the channel's best
    note: str       # provenance, as shown to the user


@dataclass(eq=False)   # identity hashing: candidates are dict keys during fusion
class Candidate:
    id: str
    hits: list[Hit] = field(default_factory=list)
    paper: Paper | None = None
    seed_sims: list[float] = field(default_factory=list)   # cosine to each seed
    question_sim: float = 0.0
    cites_seeds: list[int] = field(default_factory=list)   # seed indexes
    cited_by_seeds: list[int] = field(default_factory=list)
    references: set[str] = field(default_factory=set)       # PMIDs, from iCite
    cocited: int = 0         # seed citers that also cite this paper
    coupled: int = 0         # references shared with the seeds
    fused: float = 0.0
    grade: int | None = None
    reason: str = ""
    quote: str | None = None  # verbatim from the abstract, or None

    @property
    def seed_sim(self) -> float:
        return max(self.seed_sims)

    def best_rank(self, channel: str) -> int | None:
        ranks = [h.rank for h in self.hits if h.channel == channel]
        return min(ranks) if ranks else None


@dataclass
class SeedGraph:
    refs: dict[str, set[str]]       # seed PMID → PMIDs it cites
    citers: dict[str, set[str]]     # seed PMID → PMIDs citing it
    cocited: Counter[str]           # PMID → how many seed citers also cite it


@dataclass
class Discovery:
    question: str
    seeds: list[Paper]
    criteria: list[str]
    queries: dict[str, list[str]]
    results: list[Candidate]
    seed_grades: list[int | None]
    warnings: list[str]
    stats: dict[str, int]
    timings: dict[str, float]

    @property
    def cutoff(self) -> int | None:
        """The lowest grade any seed earned: results at or above it look like the seeds."""
        grades = [g for g in self.seed_grades if g is not None]
        return min(grades) if grades else None


Found = tuple[str, Hit, Paper | None]


async def discover(question: str, seed_refs: list[str], *, limit: int = 50) -> Discovery:
    """Rank new papers for `question`, starting from seeds given as PMIDs, DOIs, PubMed URLs or titles."""
    warnings: list[str] = []
    timings: dict[str, float] = {}
    clock = time.monotonic()

    def lap(stage: str) -> None:
        nonlocal clock
        timings[stage] = round(time.monotonic() - clock, 2)
        clock = time.monotonic()

    seeds = await resolve_seeds(seed_refs, warnings)
    lap("resolve")
    plan = await make_plan(question, seeds)
    lap("plan")
    graph = await seed_graph(seeds, warnings)
    lap("graph")
    pool = await gather_candidates(seeds, plan, graph, warnings)
    lap("candidates")
    candidates = await hydrate(pool, seeds, warnings)
    lap("hydrate")
    await first_stage(question, seeds, graph, candidates)
    lap("first_stage")
    seed_grades = await judge(question, plan["criteria"], seeds, candidates, warnings)
    lap("judge")

    candidates.sort(key=lambda c: (c.grade if c.grade is not None else -1, c.fused), reverse=True)
    stats = Counter(h.channel for c in candidates for h in c.hits)
    stats["pool"] = len(candidates)
    stats["judged"] = sum(c.grade is not None for c in candidates)
    return Discovery(question=question, seeds=seeds, criteria=plan["criteria"],
                     queries={k: plan[k] for k in ("pubmed_queries", "preprint_queries", "web_queries")},
                     results=candidates[:limit], seed_grades=seed_grades, warnings=warnings,
                     stats=dict(stats), timings=timings)


# --- 1. resolve ---------------------------------------------------------------

async def resolve_seeds(refs: list[str], warnings: list[str]) -> list[Paper]:
    pmids = await asyncio.gather(*(pubmed.resolve(r) for r in refs))
    for ref, pmid in zip(refs, pmids, strict=True):
        if pmid is None:
            warnings.append(f"Seed not found in PubMed: {ref}")
    unique = list(dict.fromkeys(p for p in pmids if p))
    if not unique:
        raise ValueError("none of the seeds could be found in PubMed")
    by_pmid = {p.pmid: p for p in await pubmed.fetch(unique)}
    return [by_pmid[p] for p in unique if p in by_pmid]


# --- 2. plan ------------------------------------------------------------------

PLAN_PROMPT = """You are a biomedical information specialist. A researcher gives a research question and \
seed papers they already know are relevant. Plan a search for more papers like them.

Return JSON only:
{
  "criteria": ["3-6 short, concrete criteria a relevant paper meets: condition or population, intervention \
or exposure, comparator, outcomes, study type. Only what the question and seeds imply."],
  "pubmed_queries": ["At most 12 PubMed queries: one per seed capturing what makes that seed relevant to the \
question (merge near-identical seeds), plus 2-3 covering distinct facets of the question. PubMed syntax: \
synonyms joined with OR inside parentheses, concepts joined with AND, [tiab] and [MeSH] tags. Each should \
match roughly 20-2000 records."],
  "preprint_queries": ["2-3 short boolean queries (quoted phrases, AND, OR; no field tags) for a preprint \
server search"],
  "web_queries": ["2-3 natural-language descriptions of the papers sought, for a web search engine"]
}"""


async def make_plan(question: str, seeds: list[Paper]) -> dict:
    seed_text = "\n\n".join(f"S{i}: {s.title}\n{s.abstract[:1500]}" for i, s in enumerate(seeds, 1))
    plan = await nebius.chat_json(PLAN_PROMPT, f"Research question: {question}\n\nSeed papers:\n\n{seed_text}")
    for key in ("criteria", "pubmed_queries", "preprint_queries", "web_queries"):
        if not isinstance(plan.get(key), list) or not all(isinstance(x, str) for x in plan[key]):
            raise ValueError(f"plan is missing a list of strings for {key!r}: {plan}")
    return plan


# --- 3. graph -----------------------------------------------------------------

async def seed_graph(seeds: list[Paper], warnings: list[str]) -> SeedGraph:
    pmids = [s.pmid for s in seeds]
    records = await icite.fetch(pmids, with_cited_by=True)
    epmc_refs = await asyncio.gather(*(europepmc.references(p) for p in pmids), return_exceptions=True)
    refs: dict[str, set[str]] = {}
    for pmid, extra in zip(pmids, epmc_refs, strict=True):
        refs[pmid] = records[pmid].references if pmid in records else set()
        if isinstance(extra, Exception):
            warnings.append(f"Europe PMC references for {pmid} failed ({extra}); using iCite's partial list")
        else:
            refs[pmid] |= extra
    citers = {p: records[p].cited_by if p in records else set() for p in pmids}

    scanned = _by_seed_count(citers)[:CITERS_SCANNED]
    cocited: Counter[str] = Counter()
    for record in (await icite.fetch(scanned)).values():
        cocited.update(record.references - set(pmids))
    return SeedGraph(refs=refs, citers=citers, cocited=cocited)


def _by_seed_count(links: dict[str, set[str]]) -> list[str]:
    """PMIDs linked to the most seeds first; ties go to the higher (more recent) PMID."""
    counts = Counter(p for linked in links.values() for p in linked)
    return sorted(counts, key=lambda p: (-counts[p], -int(p)))


# --- 4. candidates ------------------------------------------------------------

async def gather_candidates(seeds: list[Paper], plan: dict, graph: SeedGraph,
                            warnings: list[str]) -> dict[str, Candidate]:
    labels = {s.pmid: f"S{i}" for i, s in enumerate(seeds, 1)}
    pmids = [s.pmid for s in seeds]
    pool: dict[str, Candidate] = {}
    from_graph = (_from_graph("cites", graph.citers, labels, "Cites", CITERS_KEPT)
                  + _from_graph("refs", graph.refs, labels, "Cited by", None)
                  + _cocited(graph, set(pmids)))
    for cid, hit, paper in from_graph:
        _add(pool, cid, [hit], paper)

    channels: dict[str, Awaitable[list[Found]]] = {"PubMed similar articles": _similar(pmids, labels)}
    for q in plan["pubmed_queries"]:
        channels[f"PubMed query {q!r}"] = _query(q)
    for q in plan["preprint_queries"]:
        channels[f"preprint query {q!r}"] = _preprints(q)
    if web.enabled():
        for q in plan["web_queries"]:
            channels[f"web query {q!r}"] = _web(q)
    if s2.enabled():
        channels["Semantic Scholar recommendations"] = _recent(pmids)

    results = await asyncio.gather(*channels.values(), return_exceptions=True)
    for name, found in zip(channels, results, strict=True):
        # One source being down must not sink the search, but the user is told which.
        if isinstance(found, Exception):
            warnings.append(f"{name} failed: {found}")
            continue
        for cid, hit, paper in found:
            _add(pool, cid, [hit], paper)
    return pool


async def _similar(pmids: list[str], labels: dict[str, str]) -> list[Found]:
    per_seed = await pubmed.similar(pmids, limit=SIMILAR_PER_SEED)
    return [(paper_id(pmid=p), Hit("similar", rank, f"PubMed: similar to {labels[seed]} (#{rank})"), None)
            for seed, similar in per_seed.items() for rank, p in enumerate(similar, 1)]


def _from_graph(channel: str, links: dict[str, set[str]], labels: dict[str, str],
                verb: str, keep: int | None) -> list[Found]:
    found = []
    for rank, pmid in enumerate(_by_seed_count(links)[:keep], 1):
        which = ", ".join(labels[s] for s, linked in links.items() if pmid in linked)
        found.append((paper_id(pmid=pmid), Hit(channel, rank, f"{verb} {which}"), None))
    return found


def _cocited(graph: SeedGraph, seed_pmids: set[str]) -> list[Found]:
    top = [(p, n) for p, n in graph.cocited.most_common() if p not in seed_pmids and n > 1]
    return [(paper_id(pmid=p), Hit("cocited", rank, f"Co-cited with the seeds by {n} papers"), None)
            for rank, (p, n) in enumerate(top[:COCITED_KEPT], 1)]


async def _query(q: str) -> list[Found]:
    return [(paper_id(pmid=p), Hit("query", rank, f"PubMed search: {q} (#{rank})"), None)
            for rank, p in enumerate(await pubmed.search(q, limit=QUERY_HITS), 1)]


async def _preprints(q: str) -> list[Found]:
    return [(p.id, Hit("preprint", rank, f"Europe PMC preprints: {q} (#{rank})"), p)
            for rank, p in enumerate(await europepmc.preprints(q, limit=PREPRINT_HITS), 1)]


async def _web(q: str) -> list[Found]:
    return [(paper_id(**{kind: value}), Hit("web", rank, f"Web search (Tavily): {q} (#{rank})"), None)
            for rank, (kind, value) in enumerate(await web.search(q, limit=WEB_HITS), 1)]


async def _recent(pmids: list[str]) -> list[Found]:
    papers = await s2.recommend(pmids, exclude=[], limit=RECENT_HITS)
    return [(p.id, Hit("recent", rank, f"Semantic Scholar: recommended for the seeds (#{rank})"), p)
            for rank, p in enumerate(papers, 1)]


def _add(pool: dict[str, Candidate], cid: str, hits: list[Hit], paper: Paper | None) -> None:
    cand = pool.setdefault(cid, Candidate(cid))
    cand.hits.extend(hits)
    if paper is not None and cand.paper is None:
        cand.paper = paper


# --- 5. hydrate ---------------------------------------------------------------

async def hydrate(pool: dict[str, Candidate], seeds: list[Paper], warnings: list[str]) -> list[Candidate]:
    missing = [c.id.removeprefix("pmid:") for c in pool.values() if c.paper is None and c.id.startswith("pmid:")]
    for paper in await pubmed.fetch(missing):
        pool[paper.id].paper = paper

    dois = [c.id.removeprefix("doi:") for c in pool.values() if c.paper is None and c.id.startswith("doi:")]
    looked_up = await asyncio.gather(*(europepmc.by_doi(d) for d in dois), return_exceptions=True)
    for doi, paper in zip(dois, looked_up, strict=True):
        if isinstance(paper, Exception):
            warnings.append(f"Europe PMC lookup of {doi} failed: {paper}")
        elif paper is not None:
            # Europe PMC may know the DOI's PMID: then the paper lives under that id.
            _add(pool, paper.id, pool.pop(f"doi:{doi}").hits, paper)

    unresolved = sum(c.paper is None for c in pool.values())
    if unresolved:
        warnings.append(f"{unresolved} candidates had no retrievable record and were dropped")
    seed_ids = {s.id for s in seeds}
    seed_dois = {s.doi for s in seeds if s.doi}
    kept = [c for c in pool.values()
            if c.paper is not None and c.id not in seed_ids and c.paper.doi not in seed_dois
            and c.paper.title and not DROPPED_TYPES & set(c.paper.types)]

    metrics = await icite.fetch([c.paper.pmid for c in kept if c.paper.pmid])
    for c in kept:
        record = metrics.get(c.paper.pmid or "")
        if record is not None:
            c.paper.citations = record.citations
            c.paper.rcr = record.rcr
            c.paper.year = c.paper.year or record.year
            c.references = record.references
    return kept


# --- 6. first stage -----------------------------------------------------------

async def first_stage(question: str, seeds: list[Paper], graph: SeedGraph, candidates: list[Candidate]) -> None:
    """Score every candidate on text and citation signals and fuse the rankings with RRF."""
    vectors = await nebius.embed([nebius.QUERY_INSTRUCTION + question]
                                 + [s.text for s in seeds] + [c.paper.text for c in candidates])
    q_vec, seed_vecs, cand_vecs = vectors[0], vectors[1:len(seeds) + 1], vectors[len(seeds) + 1:]
    # Per-seed similarities, never a seed centroid: a mixed seed set averages into nothing.
    seed_sims = cand_vecs @ seed_vecs.T
    question_sims = cand_vecs @ q_vec

    seed_refs = set().union(*graph.refs.values())
    for c, sims, q_sim in zip(candidates, seed_sims, question_sims, strict=True):
        c.seed_sims = [round(float(x), 4) for x in sims]
        c.question_sim = round(float(q_sim), 4)
        pmid = c.paper.pmid
        c.cites_seeds = [i for i, s in enumerate(seeds) if pmid in graph.citers[s.pmid]]
        c.cited_by_seeds = [i for i, s in enumerate(seeds) if pmid in graph.refs[s.pmid]]
        c.cocited = graph.cocited.get(pmid, 0) if pmid else 0
        c.coupled = len(c.references & seed_refs)

    def ranked(score, keep=lambda c: True) -> list[Candidate]:
        return sorted((c for c in candidates if keep(c)), key=score, reverse=True)

    rankings = [
        ranked(lambda c: c.seed_sim),
        ranked(lambda c: c.question_sim),
        ranked(lambda c: (len(c.cites_seeds) + len(c.cited_by_seeds), c.cocited),
               keep=lambda c: c.cites_seeds or c.cited_by_seeds),
        ranked(lambda c: c.cocited, keep=lambda c: c.cocited > 1),
        ranked(lambda c: c.coupled, keep=lambda c: c.coupled > 0),
        ranked(lambda c: -c.best_rank("similar"), keep=lambda c: c.best_rank("similar")),
        ranked(lambda c: -c.best_rank("query"), keep=lambda c: c.best_rank("query")),
    ]
    for c, score in rrf(rankings).items():
        c.fused = round(score, 5)


def rrf(rankings: list[list]) -> dict:
    """Reciprocal rank fusion: robust without labelled data, and needs no score calibration."""
    fused: dict = {}
    for ranking in rankings:
        for position, item in enumerate(ranking, 1):
            fused[item] = fused.get(item, 0.0) + 1.0 / (RRF_K + position)
    return fused


# --- 7. judge -----------------------------------------------------------------

JUDGE_PROMPT = """You are a meticulous biomedical reviewer screening papers for a researcher. Grade each \
paper's relevance to the research question against the criteria, from its title and abstract only.

4 = directly addresses the question and meets all criteria
3 = highly relevant: meets most criteria, one minor mismatch
2 = partially relevant: same topic, but misses a key criterion (e.g. different intervention or population)
1 = tangential: shares a concept only
0 = not relevant

Be strict. Reviews and meta-analyses on the exact question can earn 4.

Return JSON only: {"grades": [{"paper": <number>, "grade": <0-4>, "reason": "<one sentence naming the \
criteria met or missed>", "quote": "<the single most relevant sentence, copied verbatim from the title or \
abstract>"}]}, one entry per paper."""


async def judge(question: str, criteria: list[str], seeds: list[Paper],
                candidates: list[Candidate], warnings: list[str]) -> list[int | None]:
    """Grade the strongest candidates 0-4 in place. Returns the seeds' grades under the same prompt,
    which calibrate what "relevant" means for this question."""
    by_fused = sorted(candidates, key=lambda c: c.fused, reverse=True)
    chosen = by_fused[:JUDGE_FUSED]
    for score in (lambda c: c.seed_sim, lambda c: c.question_sim):
        chosen += sorted(candidates, key=score, reverse=True)[:JUDGE_SEMANTIC]
    to_judge = list(dict.fromkeys(chosen))
    seed_entries = [Candidate(s.id, paper=s) for s in seeds]

    entries = to_judge + seed_entries
    batches = [entries[i:i + JUDGE_BATCH] for i in range(0, len(entries), JUDGE_BATCH)]
    header = f"Research question: {question}\n\nCriteria:\n" + "\n".join(f"- {c}" for c in criteria)
    gate = asyncio.Semaphore(JUDGE_CONCURRENCY)

    async def grade(batch: list[Candidate]) -> int:
        """Grades the batch in place; returns how many papers the model skipped."""
        papers = "\n\n".join(
            f"[{i}] {c.paper.title}\nAbstract: {c.paper.abstract[:MAX_ABSTRACT_CHARS] or '(none)'}"
            for i, c in enumerate(batch, 1))
        async with gate:
            reply = await nebius.chat_json(JUDGE_PROMPT, f"{header}\n\nPapers:\n\n{papers}")
        for entry in reply.get("grades", []):
            index, value = entry.get("paper"), entry.get("grade")
            if not (isinstance(index, int) and 1 <= index <= len(batch) and value in (0, 1, 2, 3, 4)):
                continue
            c = batch[index - 1]
            c.grade = value
            c.reason = str(entry.get("reason", ""))
            c.quote = verified_quote(str(entry.get("quote", "")), c.paper.text)
        return sum(c.grade is None for c in batch)

    results = await asyncio.gather(*(grade(b) for b in batches), return_exceptions=True)
    failed = [r for r in results if isinstance(r, Exception)]
    if failed:
        warnings.append(f"{len(failed)} of {len(batches)} judge batches failed ({failed[0]}); "
                        "those papers are ranked by the first stage only")
    ungraded = sum(r for r in results if isinstance(r, int))
    if ungraded:
        warnings.append(f"The judge skipped {ungraded} papers; they are ranked by the first stage only")
    return [c.grade for c in seed_entries]


def verified_quote(quote: str, source: str) -> str | None:
    """The quote, if it really is in the source text. An unverifiable quote is dropped, not shown."""
    cleaned = quote.strip().strip('"\'').strip()
    if len(cleaned) < 20:
        return None
    return cleaned if _squash(cleaned) in _squash(source) else None


def _squash(text: str) -> str:
    return " ".join(text.lower().split())
