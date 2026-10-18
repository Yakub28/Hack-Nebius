"""Turn what the user pasted into seed papers: PMIDs, DOIs, links, PMC and OpenAlex IDs, titles."""
from __future__ import annotations

import asyncio
import difflib
import re
from dataclasses import dataclass, field
from typing import Literal

from engine import europepmc, openalex, pubmed
from engine.paper import Paper
from engine.web import clean_doi

MAX_SEEDS = 30
MIN_TITLE_WORDS = 6
CHOOSE_MIN_RATIO = 0.75
_PMID_URL_RE = re.compile(r"(?:pubmed\.ncbi\.nlm\.nih\.gov/|europepmc\.org/(?:abstract|article)/MED/)(\d{1,8})")
_PMC_RE = re.compile(r"\bPMC\d+\b", re.I)
_OPENALEX_RE = re.compile(r"(?:https?://)?(?:api\.)?(?:openalex\.org/)?(?:works/)?(W\d{4,})", re.I)
_DOI_RE = re.compile(r'10\.\d{4,9}/[^\s"<>]+')
# Also the boolean operators, which PubMed would otherwise parse as AND/OR/NOT.
_STOPWORDS = {"a", "an", "the", "of", "for", "in", "on", "and", "or", "not", "with", "to", "by",
              "at", "from", "vs", "versus", "is", "are"}


@dataclass
class Resolution:
    line: str
    status: Literal["found", "choose", "not_found"]
    seed: Paper | None = None
    options: list[Paper] = field(default_factory=list)
    note: str = ""      # why it failed, or that it duplicates an earlier line


async def resolve(lines: list[str]) -> list[Resolution]:
    lines = [line.strip() for line in lines if line.strip()]
    results = list(await asyncio.gather(*(resolve_line(line) for line in lines[:MAX_SEEDS])))
    seen: dict[str, int] = {}
    for i, r in enumerate(results, 1):
        if r.seed is None:
            continue
        if r.seed.id in seen:
            r.note = f"Same paper as line {seen[r.seed.id]}"
        else:
            seen[r.seed.id] = i
    return results


async def resolve_line(line: str) -> Resolution:
    if m := _PMID_URL_RE.search(line) or re.fullmatch(r"(?:pmid:)?\s*(\d{1,8})", line, re.I):
        return await _by_pmid(line, m.group(1))
    if m := _PMC_RE.search(line):
        found = await pubmed.search(f"{m.group(0).upper()}[pmcid]", limit=1)
        return await _by_pmid(line, found[0]) if found else _missing(line, "No PubMed record for this PMC ID")
    if m := _OPENALEX_RE.fullmatch(line.rstrip("/")):
        ids = await openalex.work(m.group(1).upper())
        if ids["pmid"]:
            return await _by_pmid(line, ids["pmid"])
        if ids["doi"]:
            return await _by_doi(line, ids["doi"])
        return _missing(line, "This OpenAlex work has no PMID or DOI")
    if m := _DOI_RE.search(line):
        return await _by_doi(line, clean_doi(m.group(0)))
    if len(line.split()) >= MIN_TITLE_WORDS:
        return await _by_title(line)
    return _missing(line, "Couldn't find this. Check the DOI or PMID, or paste the title")


async def _by_pmid(line: str, pmid: str) -> Resolution:
    papers = await pubmed.fetch([pmid])
    return Resolution(line, "found", seed=papers[0]) if papers else _missing(line, "No PubMed record with this PMID")


async def _by_doi(line: str, doi: str) -> Resolution:
    found = await pubmed.search(f'"{doi}"[doi]', limit=1)
    if found:
        return await _by_pmid(line, found[0])
    # Preprints and some journals are not in PubMed; Europe PMC indexes them by DOI.
    paper = await europepmc.by_doi(doi)
    if paper is None:
        return _missing(line, "No PubMed or Europe PMC record for this DOI")
    return Resolution(line, "found", seed=paper)


async def _by_title(line: str) -> Resolution:
    words = [w for w in re.findall(r"[A-Za-z0-9]+", line) if w.lower() not in _STOPWORDS]
    candidates = await pubmed.fetch(await pubmed.search(" AND ".join(f"{w}[ti]" for w in words), limit=20))
    wanted = _title_key(line)
    for paper in candidates:
        if _title_key(paper.title) == wanted:
            return Resolution(line, "found", seed=paper)
    ranked = sorted(candidates, key=lambda p: -_similarity(wanted, _title_key(p.title)))
    close = [p for p in ranked[:3] if _similarity(wanted, _title_key(p.title)) >= CHOOSE_MIN_RATIO]
    if close:
        return Resolution(line, "choose", options=close, note=f"Title matches {len(close)} papers: choose one")
    return _missing(line, "No paper with this title in PubMed")


def _missing(line: str, note: str) -> Resolution:
    return Resolution(line, "not_found", note=note)


def _title_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]", "", title.lower())


def _similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()
