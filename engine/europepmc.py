"""Europe PMC: complete reference lists, preprints, and records PubMed doesn't hold. Keyless."""
from __future__ import annotations

import re

from engine import http
from engine.paper import Paper, paper_id, title_key

REST = "https://www.ebi.ac.uk/europepmc/webservices/rest"
_TAG_RE = re.compile(r"<[^>]+>")


async def references(record: str) -> set[str]:
    """PMIDs a paper cites, for a Europe PMC "source/id" ("MED/<pmid>", "PPR/PPR…").
    Fuller than PubMed or iCite, which only see PMC deposits."""
    data = await http.get_json(f"{REST}/{record}/references", params={"format": "json", "pageSize": 1000})
    refs = (data.get("referenceList") or {}).get("reference") or []
    return {r["id"] for r in refs if r.get("source") == "MED" and r.get("id")}


async def citations(record: str) -> set[str]:
    """PMIDs of papers citing a Europe PMC record. iCite covers PubMed papers; this covers the rest."""
    data = await http.get_json(f"{REST}/{record}/citations", params={"format": "json", "pageSize": 1000})
    cites = (data.get("citationList") or {}).get("citation") or []
    return {c["id"] for c in cites if c.get("source") == "MED" and c.get("id")}


async def preprints(query: str, *, limit: int) -> list[Paper]:
    """bioRxiv, medRxiv, Research Square… matching a plain boolean query."""
    return await _search(f"({query}) AND SRC:PPR", limit=limit)


async def by_doi(doi: str) -> Paper | None:
    found = await _search(f'DOI:"{doi}"', limit=1)
    return found[0] if found else None


async def by_title(title: str) -> Paper | None:
    """Only an exact title match counts, as in PubMed: a wrong seed would steer the whole search."""
    wanted = title_key(title)
    if not wanted:
        return None
    phrase = " ".join(re.findall(r"[^\W_]+", title))
    found = [p for p in await _search(f'TITLE:"{phrase}"', limit=5) if title_key(p.title) == wanted]
    # The same title can be a preprint and its published version: prefer the PubMed record.
    return next((p for p in found if p.pmid), found[0] if found else None)


async def by_pmcid(pmcid: str) -> Paper | None:
    found = await _search(f"PMCID:{pmcid.upper()}", limit=1)
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
        epmc=f"{r['source']}/{r['id']}" if r.get("source") and r.get("id") else None,
    )


def _clean(html: str) -> str:
    return " ".join(_TAG_RE.sub(" ", html).split())
