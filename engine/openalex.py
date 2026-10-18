"""OpenAlex: single-work lookups (free) and semantic search (needs OPENALEX_API_KEY).

Keyless list and search calls share a $0.10/day budget per IP that is often already spent,
so search only runs with a key; single-record lookups cost nothing either way.
"""
from __future__ import annotations

import os

from engine import http
from engine.paper import Paper, paper_id

API = "https://api.openalex.org"


def enabled() -> bool:
    return bool(os.getenv("OPENALEX_API_KEY"))


async def work(openalex_id: str) -> dict:
    """The ids of one work: {"pmid": …, "doi": …} (either may be None)."""
    data = await http.get_json(f"{API}/works/{openalex_id}", ttl=7 * http.DAY, params=_params(select="ids,doi"))
    ids = data.get("ids") or {}
    pmid = (ids.get("pmid") or "").rsplit("/", 1)[-1] or None
    doi = (data.get("doi") or "").removeprefix("https://doi.org/").lower() or None
    return {"pmid": pmid, "doi": doi}


async def semantic(query: str, *, limit: int, before: str | None = None) -> list[Paper]:
    params = _params(**{"search.semantic": query, "per_page": limit,
                        "select": "ids,doi,title,abstract_inverted_index,publication_year,"
                                  "publication_date,primary_location,type,is_retracted"})
    if before:
        params["filter"] = f"to_publication_date:{before}"
    data = await http.get_json(f"{API}/works", ttl=http.DAY, params=params)
    papers = []
    for w in data.get("results", []):
        ids = w.get("ids") or {}
        pmid = (ids.get("pmid") or "").rsplit("/", 1)[-1] or None
        doi = (w.get("doi") or "").removeprefix("https://doi.org/").lower() or None
        if not (pmid or doi) or not w.get("title"):
            continue
        source = ((w.get("primary_location") or {}).get("source") or {})
        papers.append(Paper(
            id=paper_id(pmid=pmid, doi=doi), title=w["title"], abstract=_abstract(w.get("abstract_inverted_index")),
            year=w.get("publication_year"), date=w.get("publication_date"), journal=source.get("display_name") or "",
            doi=doi, pmid=pmid, is_preprint=w.get("type") == "preprint", is_retracted=bool(w.get("is_retracted")),
        ))
    return papers


def _abstract(inverted: dict[str, list[int]] | None) -> str:
    if not inverted:
        return ""
    words = sorted((i, word) for word, positions in inverted.items() for i in positions)
    return " ".join(word for _, word in words)


def _params(**params) -> dict:
    if key := os.getenv("OPENALEX_API_KEY"):
        params["api_key"] = key
    return params
