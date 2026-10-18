"""Tavily web search, narrowed to sources whose URLs name a citable paper."""
from __future__ import annotations

import os
import re

from engine import http

API = "https://api.tavily.com/search"
DOMAINS = ["pubmed.ncbi.nlm.nih.gov", "europepmc.org", "biorxiv.org", "medrxiv.org",
           "nature.com", "thelancet.com", "nejm.org", "jamanetwork.com", "bmj.com",
           "cell.com", "sciencedirect.com", "frontiersin.org", "plos.org", "mdpi.com"]
_PMID_RE = re.compile(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d+)|europepmc\.org/(?:abstract|article)/MED/(\d+)")
_DOI_RE = re.compile(r"(10\.\d{4,9}/[^\s?#]+)")
# bioRxiv/medRxiv URLs append a version and a view to the DOI: …/2024.01.02.123456v2.full
_DOI_SUFFIX_RE = re.compile(r"(v\d+)?(\.(full|abstract|supplementary-material)(\.pdf|-text)?)?/?$")


def enabled() -> bool:
    return bool(os.getenv("TAVILY_API_KEY"))


async def search(query: str, *, limit: int) -> list[tuple[str, str]]:
    """(kind, value) paper identifiers found on the web: ("pmid", "123") or ("doi", "10.…")."""
    data = await http.post_json(API, headers={"Authorization": f"Bearer {os.environ['TAVILY_API_KEY']}"},
                                json={"query": query, "max_results": limit, "include_domains": DOMAINS,
                                      "search_depth": "advanced"})
    found = []
    for result in data.get("results", []):
        ident = identify(result["url"])
        if ident and ident not in found:
            found.append(ident)
    return found


def identify(url: str) -> tuple[str, str] | None:
    """The paper a URL points at, if the URL itself says so. Pages that don't are dropped:
    a result we cannot tie to a record cannot be shown with verifiable metadata."""
    if m := _PMID_RE.search(url):
        return "pmid", m.group(1) or m.group(2)
    if m := _DOI_RE.search(url):
        return "doi", _DOI_SUFFIX_RE.sub("", m.group(1)).lower()
    return None
