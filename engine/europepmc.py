"""Europe PMC: complete reference lists and structured preprint search, keyless."""
from __future__ import annotations

import re

from engine import http
from engine.paper import Paper, paper_id

REST = "https://www.ebi.ac.uk/europepmc/webservices/rest"
_TAG_RE = re.compile(r"<[^>]+>")


async def references(pmid: str) -> set[str]:
    """PMIDs a paper cites. Fuller than PubMed or iCite, which only see PMC deposits."""
    data = await http.get_json(f"{REST}/MED/{pmid}/references",
                               params={"format": "json", "pageSize": 1000})
    refs = (data.get("referenceList") or {}).get("reference") or []
    return {r["id"] for r in refs if r.get("source") == "MED" and r.get("id")}


async def preprints(query: str, *, limit: int) -> list[Paper]:
    """bioRxiv, medRxiv, Research Square… matching a plain boolean query."""
    return await _search(f"({query}) AND SRC:PPR", limit=limit)


async def by_doi(doi: str) -> Paper | None:
    found = await _search(f'DOI:"{doi}"', limit=1)
    return found[0] if found else None


async def _search(query: str, *, limit: int) -> list[Paper]:
    data = await http.get_json(f"{REST}/search", params={
        "query": query, "resultType": "core", "format": "json", "pageSize": limit})
    return [_paper(r) for r in data["resultList"]["result"]
            if r.get("title") and (r.get("pmid") or r.get("doi"))]


def _paper(r: dict) -> Paper:
    pmid = r.get("pmid")
    doi = (r.get("doi") or "").lower() or None
    is_preprint = r.get("source") == "PPR"
    venue = r.get("journalTitle") or (r.get("bookOrReportDetails") or {}).get("publisher") or ""
    return Paper(
        id=paper_id(pmid=pmid, doi=doi),
        title=_clean(r["title"]),
        abstract=_clean(r.get("abstractText") or ""),
        year=int(r["pubYear"]) if str(r.get("pubYear", "")).isdigit() else None,
        venue=venue,
        authors=[a.strip() for a in (r.get("authorString") or "").rstrip(".").split(",") if a.strip()],
        doi=doi,
        pmid=pmid,
        citations=r.get("citedByCount"),
        preprint=is_preprint,
    )


def _clean(html: str) -> str:
    return " ".join(_TAG_RE.sub(" ", html).split())
