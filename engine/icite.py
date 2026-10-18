"""NIH iCite: citation links and citation metrics for PMIDs, keyless."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass

from engine import http

API = "https://icite.od.nih.gov/api/pubs"
CHUNK = 200          # 1,000 PMIDs in one URL returns 413
CONCURRENCY = 4


@dataclass
class Record:
    pmid: str
    year: int | None
    citations: int
    rcr: float | None
    references: set[str]      # only from PMC-deposited reference lists, so incomplete
    cited_by: set[str]


async def fetch(pmids: list[str], *, with_cited_by: bool = False) -> dict[str, Record]:
    fields = "pmid,year,citation_count,relative_citation_ratio,references"
    if with_cited_by:
        fields += ",cited_by"
    chunks = [pmids[i:i + CHUNK] for i in range(0, len(pmids), CHUNK)]
    gate = asyncio.Semaphore(CONCURRENCY)

    async def one(chunk: list[str]) -> list[dict]:
        async with gate:
            data = await http.get_json(API, params={"pmids": ",".join(chunk), "fl": fields})
        return data["data"]

    records = {}
    for rows in await asyncio.gather(*(one(c) for c in chunks)):
        for row in rows:
            pmid = str(row["pmid"])
            records[pmid] = Record(
                pmid=pmid,
                year=row.get("year"),
                citations=row.get("citation_count") or 0,
                rcr=row.get("relative_citation_ratio"),
                references={str(p) for p in row.get("references") or []},
                cited_by={str(p) for p in row.get("cited_by") or []},
            )
    return records
