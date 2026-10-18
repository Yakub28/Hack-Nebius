"""Europe PMC: complete reference lists and structured preprint search, keyless."""
from __future__ import annotations

import re

from engine import http
from engine.paper import Paper, paper_id

REST = "https://www.ebi.ac.uk/europepmc/webservices/rest"
_TAG_RE = re.compile(r"<[^>]+>")


async def references(pmid: str) -> set[str]:
    """PMIDs a paper cites. Fuller than PubMed or iCite, which only see PMC deposits."""
    data = await http.get_json(f"{REST}/MED/{pmid}/references", ttl=7 * http.DAY,
                               params={"format": "json", "pageSize": 1000})
    refs = (data.get("referenceList") or {}).get("reference") or []
    return {r["id"] for r in refs if r.get("source") == "MED" and r.get("id")}


async def preprints(query: str, *, limit: int, before: str | None = None) -> list[Paper]:
    """bioRxiv, medRxiv, Research Square… matching a query."""
    dates = f" AND FIRST_PDATE:[1000-01-01 TO {before}]" if before else ""
    return await _search(f"({query}) AND SRC:PPR{dates}", limit=limit, ttl=http.DAY)


async def by_doi(doi: str) -> Paper | None:
    found = await _search(f'DOI:"{doi}"', limit=1, ttl=7 * http.DAY)
    return found[0] if found else None


async def _search(query: str, *, limit: int, ttl: int) -> list[Paper]:
    data = await http.get_json(f"{REST}/search", ttl=ttl, params={
        "query": query, "resultType": "core", "format": "json", "pageSize": limit})
    return [_paper(r) for r in data["resultList"]["result"]
            if r.get("title") and (r.get("pmid") or r.get("doi"))]


def _paper(r: dict) -> Paper:
    pmid = r.get("pmid")
    doi = (r.get("doi") or "").lower() or None
    year = int(r["pubYear"]) if str(r.get("pubYear", "")).isdigit() else None
    pub_types = (r.get("pubTypeList") or {}).get("pubType") or []
    return Paper(
        id=paper_id(pmid=pmid, doi=doi),
        title=_clean(r["title"]).rstrip("."),
        abstract=_clean(r.get("abstractText") or ""),
        year=year,
        date=r.get("firstPublicationDate"),
        journal=r.get("journalTitle") or (r.get("bookOrReportDetails") or {}).get("publisher") or "",
        authors=[a.strip() for a in (r.get("authorString") or "").rstrip(".").split(",") if a.strip()],
        doi=doi,
        pmid=pmid,
        pmcid=r.get("pmcid"),
        pub_types=pub_types,
        is_preprint=r.get("source") == "PPR",
        is_retracted="Retracted Publication" in pub_types,
        cited_by=r.get("citedByCount"),
    )


def _clean(html: str) -> str:
    return " ".join(_TAG_RE.sub(" ", html).split())
