"""The five ways of finding candidates, plus the keyword check. Every hit records where it came from."""
from __future__ import annotations

import asyncio
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Literal

from engine import europepmc, icite, openalex, pubmed, web
from engine.paper import Paper, paper_id

CITERS_PER_SEED = 300
CITERS_SCANNED = 1000      # citing papers whose reference lists feed co-citation
COCITED_KEPT = 300
SIMILAR_PER_SEED = 100
SEARCH_HITS = 100
PREPRINT_HITS = 25
SEMANTIC_HITS = 50
WEB_QUERIES = 3
WEB_HITS = 10
KEYWORD_CHECK_HITS = 200
RRF_K = 60

ChannelName = Literal["citations", "cocited", "similar", "search", "web"]


@dataclass
class Provenance:
    channel: ChannelName
    via: str | None = None        # seed label, or the query that found it
    relation: Literal["cites", "cited_by", "co_cited"] | None = None
    count: int | None = None      # co-citation count
    rank: int | None = None
    url: str | None = None        # web page it was found on
    url_title: str | None = None
    round: int = 1

    def to_json(self) -> dict:
        return {"channel": self.channel, "round": self.round, "via": self.via, "relation": self.relation,
                "count": self.count, "rank": self.rank, "url": self.url, "urlTitle": self.url_title}


@dataclass
class Found:
    ranking: list[str]                          # candidate ids, the channel's best first
    hits: dict[str, list[Provenance]] = field(default_factory=dict)
    papers: dict[str, Paper] = field(default_factory=dict)   # records the channel already holds

    def add(self, cid: str, prov: Provenance) -> None:
        self.hits.setdefault(cid, []).append(prov)


@dataclass
class SeedGraph:
    refs: dict[str, set[str]]           # seed label → PMIDs it cites
    citers: dict[str, list[str]]        # seed label → citing PMIDs, newest first
    citer_records: dict[str, icite.Record]


async def seed_graph(seeds: dict[str, Paper], before: str | None) -> SeedGraph:
    """The citation neighbourhood of the seeds that have a PMID."""
    by_pmid = {p.pmid: label for label, p in seeds.items() if p.pmid}
    records = await icite.fetch(list(by_pmid), with_cited_by=True)
    epmc = await asyncio.gather(*(europepmc.references(pmid) for pmid in by_pmid))
    refs = {label: (records[pmid].references if pmid in records else set()) | extra
            for (pmid, label), extra in zip(by_pmid.items(), epmc, strict=True)}
    citers = {label: sorted(records[pmid].cited_by, key=int, reverse=True)[:CITERS_PER_SEED]
              for pmid, label in by_pmid.items() if pmid in records}

    counts = Counter(p for linked in citers.values() for p in linked)
    scanned = sorted(counts, key=lambda p: (-counts[p], -int(p)))[:CITERS_SCANNED]
    citer_records = await icite.fetch(scanned)
    if before:
        cutoff = int(before[:4])
        # A citing paper from after the cutoff could not have been seen then; drop it everywhere.
        citer_records = {p: r for p, r in citer_records.items() if r.year and r.year <= cutoff}
        citers = {label: [p for p in linked if p in citer_records] for label, linked in citers.items()}
    return SeedGraph(refs=refs, citers=citers, citer_records=citer_records)


def citations(graph: SeedGraph) -> Found:
    """References and citing papers of every seed. Ranked later, once citation counts are known."""
    found = Found(ranking=[])
    for label, refs in graph.refs.items():
        for pmid in refs:
            found.add(paper_id(pmid=pmid), Provenance("citations", via=label, relation="cited_by"))
    for label, linked in graph.citers.items():
        for rank, pmid in enumerate(linked, 1):
            found.add(paper_id(pmid=pmid), Provenance("citations", via=label, relation="cites", rank=rank))
    found.ranking = list(found.hits)
    return found


async def cocited(graph: SeedGraph, seed_pmids: set[str]) -> Found:
    """Papers cited alongside the seeds. co-cite(p) / √(citations(p) + 1), so famous papers don't win by fame."""
    seeds_cited_by = defaultdict(list)
    for label, linked in graph.citers.items():
        for pmid in linked:
            seeds_cited_by[pmid].append(label)
    total: Counter[str] = Counter()
    per_seed: dict[str, Counter[str]] = defaultdict(Counter)
    for citer, record in graph.citer_records.items():
        for pmid in record.references - seed_pmids:
            total[pmid] += 1
            per_seed[pmid].update(seeds_cited_by[citer])

    top = [p for p, n in total.most_common(CITERS_SCANNED) if n > 1]
    metrics = await icite.fetch(top)
    score = {p: total[p] / math.sqrt((metrics[p].citations if p in metrics else 0) + 1) for p in top}
    ranked = sorted(top, key=score.get, reverse=True)[:COCITED_KEPT]
    found = Found(ranking=[paper_id(pmid=p) for p in ranked])
    for rank, pmid in enumerate(ranked, 1):
        for label, n in per_seed[pmid].most_common():
            found.add(paper_id(pmid=pmid), Provenance("cocited", via=label, relation="co_cited", count=n, rank=rank))
    return found


async def similar(seeds: dict[str, Paper]) -> Found:
    by_pmid = {p.pmid: label for label, p in seeds.items() if p.pmid}
    per_seed = await pubmed.similar(list(by_pmid), limit=SIMILAR_PER_SEED)
    found, score = Found(ranking=[]), Counter()
    for seed_pmid, pmids in per_seed.items():
        for rank, pmid in enumerate(pmids, 1):
            cid = paper_id(pmid=pmid)
            found.add(cid, Provenance("similar", via=by_pmid[seed_pmid], rank=rank))
            score[cid] += 1 / (RRF_K + rank)
    found.ranking = [cid for cid, _ in score.most_common()]
    return found


async def search(queries: list[str], question: str, *, before: str | None, include_preprints: bool) -> Found:
    """The rubric's queries on PubMed (and preprints), plus the question on OpenAlex semantic search."""
    lists: list[tuple[str, list[str]]] = []
    found = Found(ranking=[])
    pubmed_lists = await asyncio.gather(*(pubmed.search(q, limit=SEARCH_HITS, before=before) for q in queries))
    lists += [(q, [paper_id(pmid=p) for p in pmids]) for q, pmids in zip(queries, pubmed_lists, strict=True)]
    if include_preprints:
        preprint_lists = await asyncio.gather(*(europepmc.preprints(q, limit=PREPRINT_HITS, before=before)
                                                for q in queries))
        for q, papers in zip(queries, preprint_lists, strict=True):
            found.papers.update({p.id: p for p in papers})
            lists.append((f"{q} (preprints)", [p.id for p in papers]))
    if openalex.enabled():
        papers = await openalex.semantic(question, limit=SEMANTIC_HITS, before=before)
        found.papers.update({p.id: p for p in papers})
        lists.append(("OpenAlex semantic search", [p.id for p in papers]))

    score = Counter()
    for query, ids in lists:
        for rank, cid in enumerate(ids, 1):
            found.add(cid, Provenance("search", via=query, rank=rank))
            score[cid] += 1 / (RRF_K + rank)
    found.ranking = [cid for cid, _ in score.most_common()]
    return found


async def web_search(queries: list[str]) -> Found:
    pages = [page for pages in await asyncio.gather(*(web.search(q, limit=WEB_HITS) for q in queries[:WEB_QUERIES]))
             for page in pages]
    trial_pmids = await asyncio.gather(*(_trial_papers(page.nct_ids) for page in pages))
    found = Found(ranking=[])
    for page, from_trials in zip(pages, trial_pmids, strict=True):
        ids = [paper_id(pmid=p) for p in page.pmids + from_trials] + [paper_id(doi=d) for d in page.dois]
        for cid in ids:
            found.add(cid, Provenance("web", rank=page.rank, url=page.url, url_title=page.title))
    found.ranking = sorted(found.hits, key=lambda cid: min(p.rank for p in found.hits[cid]))
    return found


async def keyword_check(question: str, before: str | None) -> set[str]:
    """What a plain PubMed search of the question returns. Not a channel: it only marks what keywords miss."""
    return {paper_id(pmid=p) for p in await pubmed.search(question, limit=KEYWORD_CHECK_HITS, before=before)}


async def _trial_papers(nct_ids: list[str]) -> list[str]:
    if not nct_ids:
        return []
    return await pubmed.search(" OR ".join(f"{n}[si]" for n in nct_ids), limit=5)
