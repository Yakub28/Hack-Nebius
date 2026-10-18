"""PubMed E-utilities: resolve references, fetch records, similar articles, search."""
from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET

from engine import http
from engine.paper import Paper, paper_id, title_key

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
FETCH_CHUNK = 200
_DOI_RE = re.compile(r"10\.\d{4,9}/\S+")
# Also the boolean operators, which would otherwise be parsed as AND/OR/NOT.
_STOPWORDS = {"a", "an", "the", "of", "for", "in", "on", "and", "or", "not", "with", "to", "by",
              "at", "from", "vs", "versus", "is", "are"}


async def resolve(ref: str) -> str | None:
    """PMID for a user-supplied PMID, DOI, PubMed URL or title; None if PubMed has no match."""
    ref = ref.strip()
    if m := re.search(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d+)", ref):
        return m.group(1)
    if ref.isdigit():
        return ref
    if doi := find_doi(ref):
        hits = await search(f'"{doi}"[doi]', limit=1)
        return hits[0] if hits else None
    return await _by_title(ref)


def find_doi(ref: str) -> str | None:
    m = _DOI_RE.search(ref)
    return m.group(0).rstrip(".") if m else None


async def _by_title(title: str) -> str | None:
    """Only an exact title match counts: a wrong seed would steer the whole search."""
    words = [w for w in re.findall(r"[A-Za-z0-9]+", title) if w.lower() not in _STOPWORDS]
    if not words:
        return None
    pmids = await search(" AND ".join(f"{w}[ti]" for w in words), limit=20)
    wanted = title_key(title)
    return next((p.pmid for p in await fetch(pmids) if title_key(p.title) == wanted), None)


async def search(term: str, *, limit: int) -> list[str]:
    """PMIDs for a PubMed query, best match first."""
    data = await http.get_json(f"{EUTILS}/esearch.fcgi", params=_params(
        db="pubmed", term=term, retmax=limit, sort="relevance", retmode="json"))
    result = data["esearchresult"]
    if "ERROR" in result:
        raise ValueError(f"esearch {term!r}: {result['ERROR']}")
    return result["idlist"]


async def similar(pmids: list[str], *, limit: int) -> dict[str, list[str]]:
    """PubMed "Similar articles" per seed, most similar first."""
    params = _params(dbfrom="pubmed", db="pubmed", linkname="pubmed_pubmed",
                     cmd="neighbor_score", retmode="json")
    # Repeated `id` params return one linkset per seed; a comma list would merge them.
    params["id"] = pmids
    data = await http.get_json(f"{EUTILS}/elink.fcgi", params=params)
    out: dict[str, list[str]] = {}
    for linkset in data.get("linksets", []):
        seed = str(linkset["ids"][0])
        links = next((db["links"] for db in linkset.get("linksetdbs", [])
                      if db["linkname"] == "pubmed_pubmed"), [])
        ranked = sorted(links, key=lambda link: -int(link["score"]))
        out[seed] = [str(link["id"]) for link in ranked if str(link["id"]) != seed][:limit]
    return out


async def fetch(pmids: list[str]) -> list[Paper]:
    papers: list[Paper] = []
    for start in range(0, len(pmids), FETCH_CHUNK):
        chunk = pmids[start:start + FETCH_CHUNK]
        resp = await http.request("POST", f"{EUTILS}/efetch.fcgi", data=_params(
            db="pubmed", id=",".join(chunk), retmode="xml"))
        papers.extend(parse_efetch(resp.text))
    return papers


def parse_efetch(xml_text: str) -> list[Paper]:
    papers = []
    for article in ET.fromstring(xml_text).iter("PubmedArticle"):
        citation = article.find("MedlineCitation")
        pmid = citation.findtext("PMID")
        body = citation.find("Article")
        doi = next((el.text for el in article.iterfind(".//ArticleIdList/ArticleId")
                    if el.get("IdType") == "doi" and el.text), None)
        year = body.findtext("Journal/JournalIssue/PubDate/Year") or \
            (body.findtext("Journal/JournalIssue/PubDate/MedlineDate") or "")[:4]
        authors = [" ".join(filter(None, [a.findtext("ForeName"), a.findtext("LastName")]))
                   or a.findtext("CollectiveName") or ""
                   for a in body.iterfind("AuthorList/Author")]
        papers.append(Paper(
            id=paper_id(pmid=pmid),
            pmid=pmid,
            # itertext, not .text: titles and abstracts carry inline <i>, <sup>, <sub>,
            # and .text stops at the first one (it truncated a third of abstracts in axiom).
            title=_text(body.find("ArticleTitle")),
            abstract=" ".join(_text(part) for part in body.iterfind("Abstract/AbstractText")),
            year=int(year) if year.isdigit() else None,
            venue=body.findtext("Journal/Title") or "",
            authors=[a for a in authors if a],
            doi=doi.lower() if doi else None,
            types=[t.text for t in body.iterfind("PublicationTypeList/PublicationType") if t.text],
        ))
    return papers


def _text(el: ET.Element | None) -> str:
    return " ".join("".join(el.itertext()).split()) if el is not None else ""


def _params(**params) -> dict:
    params["tool"] = "tumor-discovery"
    if key := os.getenv("NCBI_API_KEY"):
        params["api_key"] = key
    return params
