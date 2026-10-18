"""Semantic Scholar recommendations: papers from roughly the last 60 days similar to the seeds.

Keyless access is ~90% 429s in practice, so this channel only runs with S2_API_KEY.
"""
from __future__ import annotations

import os

from engine import http
from engine.paper import Paper, paper_id

API = "https://api.semanticscholar.org/recommendations/v1/papers"
FIELDS = "title,abstract,year,venue,authors,externalIds,citationCount,publicationTypes"


def enabled() -> bool:
    return bool(os.getenv("S2_API_KEY"))


async def recommend(pmids: list[str], *, exclude: list[str], limit: int) -> list[Paper]:
    data = await http.post_json(
        API, params={"fields": FIELDS, "limit": limit},
        headers={"x-api-key": os.environ["S2_API_KEY"]},
        json={"positivePaperIds": [f"PMID:{p}" for p in pmids],
              "negativePaperIds": [f"PMID:{p}" for p in exclude]})
    papers = []
    for rec in data.get("recommendedPapers", []):
        ext = rec.get("externalIds") or {}
        pmid, doi = ext.get("PubMed"), (ext.get("DOI") or "").lower() or None
        if not (pmid or doi) or not rec.get("title"):
            continue
        papers.append(Paper(
            id=paper_id(pmid=pmid, doi=doi), title=rec["title"], abstract=rec.get("abstract") or "",
            year=rec.get("year"), venue=rec.get("venue") or "", doi=doi, pmid=pmid,
            authors=[a["name"] for a in rec.get("authors") or [] if a.get("name")],
            citations=rec.get("citationCount"),
            preprint=not pmid and "JournalArticle" not in (rec.get("publicationTypes") or []),
        ))
    return papers
