"""Tavily web search, narrowed to sources that name citable papers."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

from engine import http

API = "https://api.tavily.com/search"
DOMAINS = ["biorxiv.org", "medrxiv.org", "pubmed.ncbi.nlm.nih.gov", "pmc.ncbi.nlm.nih.gov", "europepmc.org",
           "nature.com", "science.org", "cell.com", "thelancet.com", "nejm.org", "jamanetwork.com", "bmj.com",
           "plos.org", "frontiersin.org", "mdpi.com", "clinicaltrials.gov"]
_PMID_RE = re.compile(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d{1,8})|europepmc\.org/(?:abstract|article)/MED/(\d{1,8})")
_DOI_RE = re.compile(r'10\.\d{4,9}/[^\s"<>]+')
_NCT_RE = re.compile(r"\bNCT\d{8}\b")
# bioRxiv/medRxiv URLs append a version and a view to the DOI: …/2024.01.02.123456v2.full
_DOI_TAIL_RE = re.compile(r"(v\d+)?(\.(full|abstract|supplementary-material)(\.pdf|-text)?)?[/.,;)\]]*$")


@dataclass
class Page:
    url: str
    title: str
    rank: int
    pmids: list[str]
    dois: list[str]
    nct_ids: list[str]


async def search(query: str, *, limit: int) -> list[Page]:
    """Pages on scholarly domains for a query, with the paper identifiers each one names."""
    key = os.getenv("TAVILY_API_KEY")
    # Without a key Tavily still serves /search in its keyless access mode, at a lower rate.
    headers = {"Authorization": f"Bearer {key}"} if key else {"X-Tavily-Access-Mode": "keyless"}
    data = await http.post_json(API, ttl=http.DAY, headers=headers, json={
        "query": query, "search_depth": "basic", "max_results": limit, "time_range": "year",
        "include_domains": DOMAINS})
    pages = []
    for rank, result in enumerate(data.get("results", []), 1):
        url, text = result["url"], f"{result['url']} {result.get('content', '')}"
        pmid = _PMID_RE.search(url)
        pages.append(Page(
            url=url, title=result.get("title") or url, rank=rank,
            pmids=[pmid.group(1) or pmid.group(2)] if pmid else [],
            dois=list(dict.fromkeys(clean_doi(d) for d in _DOI_RE.findall(text))),
            nct_ids=list(dict.fromkeys(_NCT_RE.findall(text))),
        ))
    return pages


def clean_doi(raw: str) -> str:
    return _DOI_TAIL_RE.sub("", raw).lower()
