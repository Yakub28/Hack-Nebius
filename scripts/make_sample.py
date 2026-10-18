"""Build web/sample.json: a preview of the UI that needs no Nebius key.

Papers, links, citations and seed links are real (PubMed similar articles + iCite). Grades, reasons and
similarities are placeholders, and the UI labels the page as sample data.

Run: .venv/bin/python scripts/make_sample.py
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import _discovery_json  # noqa: E402
from engine import http, icite, pubmed  # noqa: E402
from engine.discover import Candidate, Discovery, Hit  # noqa: E402

QUESTION = "Which incretin-based drugs reduce body weight in adults with obesity?"
SEEDS = ["33567185", "35658024"]   # STEP 1 (semaglutide), SURMOUNT-1 (tirzepatide)
PER_SEED = 12


async def main() -> None:
    seeds = await pubmed.fetch(SEEDS)
    similar = await pubmed.similar(SEEDS, limit=PER_SEED)
    graph = await icite.fetch(SEEDS, with_cited_by=True)

    hits: dict[str, list[Hit]] = {}
    for s, (seed, pmids) in enumerate(similar.items(), 1):
        for rank, pmid in enumerate(pmids, 1):
            hits.setdefault(pmid, []).append(Hit("similar", rank, f"PubMed: similar to S{s} (#{rank})"))
    papers = {p.pmid: p for p in await pubmed.fetch(list(hits))}
    metrics = await icite.fetch(list(papers))

    candidates = []
    for order, (pmid, paper) in enumerate(papers.items()):
        c = Candidate(paper.id, hits=hits[pmid], paper=paper)
        if record := metrics.get(pmid):
            paper.citations, paper.rcr = record.citations, record.rcr
        c.cites_seeds = [i for i, s in enumerate(SEEDS) if pmid in graph[s].cited_by]
        c.cited_by_seeds = [i for i, s in enumerate(SEEDS) if pmid in graph[s].references]
        for i in c.cites_seeds:
            c.hits.append(Hit("cites", 1, f"Cites S{i + 1}"))
        rank = min(h.rank for h in c.hits if h.channel == "similar")
        c.seed_sims = [round(0.9 - 0.02 * rank, 4)] * len(SEEDS)
        c.question_sim = round(0.7 - 0.015 * rank, 4)
        c.fused = round(1 / (60 + rank) * (1 + len(c.cites_seeds)), 5)
        c.grade = 4 if rank <= 3 else 3 if rank <= 6 else 2 if rank <= 9 else 1
        c.reason = "Placeholder reason: sample data, not graded by the LLM."
        c.quote = next((s for s in re.split(r"(?<=[.!?])\s+", paper.abstract)
                        if "weight" in s.lower() and len(s) > 40), None)
        candidates.append(c)
    candidates.sort(key=lambda c: (c.grade, c.fused), reverse=True)

    found = Discovery(
        question=QUESTION, seeds=seeds,
        criteria=["Adults with obesity or overweight", "GLP-1 or dual incretin receptor agonist",
                  "Body-weight change as an outcome", "Randomised trial or meta-analysis of trials"],
        queries={"pubmed_queries": ['("semaglutide"[tiab] OR "tirzepatide"[tiab]) AND obesity[MeSH] AND "weight loss"[tiab]'],
                 "preprint_queries": ['"incretin" AND "obesity" AND "weight"'],
                 "web_queries": ["randomised trials of GLP-1 agonists for weight loss in adults with obesity"]},
        results=candidates, seed_grades=[4, 4],
        warnings=["Sample data: grades, reasons and similarity scores are placeholders, not engine output"],
        stats={"similar": sum(len(v) for v in similar.values()), "pool": len(candidates), "judged": len(candidates)},
        timings={"resolve": 1.2, "plan": 5.8, "graph": 4.1, "candidates": 7.5, "hydrate": 3.9,
                 "first_stage": 4.4, "judge": 27.3},
    )
    out = ROOT / "web" / "sample.json"
    out.write_text(json.dumps(_discovery_json(found), indent=1, ensure_ascii=False))
    print(f"wrote {out} ({len(candidates)} results)")
    await http.close()


asyncio.run(main())
