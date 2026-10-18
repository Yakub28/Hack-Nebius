"""PubMed E-utilities: records, similar articles, search."""
from __future__ import annotations

import asyncio
import os
import xml.etree.ElementTree as ET

from engine import http
from engine.paper import Paper, paper_id

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
FETCH_CHUNK = 200
_MONTHS = {m: f"{i:02d}" for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


async def search(term: str, *, limit: int, before: str | None = None) -> list[str]:
    """PMIDs for a PubMed query in Best Match order, optionally only those published before a date."""
    if before:
        term = f'({term}) AND ("1000/01/01"[dp] : "{before.replace("-", "/")}"[dp])'
    data = await http.get_json(f"{EUTILS}/esearch.fcgi", ttl=http.DAY, params=_params(
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
    data = await http.get_json(f"{EUTILS}/elink.fcgi", ttl=7 * http.DAY, params=params)
    out: dict[str, list[str]] = {}
    for linkset in data.get("linksets", []):
        seed = str(linkset["ids"][0])
        links = next((db["links"] for db in linkset.get("linksetdbs", [])
                      if db["linkname"] == "pubmed_pubmed"), [])
        ranked = sorted(links, key=lambda link: -int(link["score"]))
        out[seed] = [str(link["id"]) for link in ranked if str(link["id"]) != seed][:limit]
    return out


async def fetch(pmids: list[str]) -> list[Paper]:
    chunks = [pmids[i:i + FETCH_CHUNK] for i in range(0, len(pmids), FETCH_CHUNK)]

    async def one(chunk: list[str]) -> list[Paper]:
        text = await http.fetch("POST", f"{EUTILS}/efetch.fcgi", ttl=7 * http.DAY,
                                data=_params(db="pubmed", id=",".join(chunk), retmode="xml"))
        return parse_efetch(text)

    return [p for papers in await asyncio.gather(*(one(c) for c in chunks)) for p in papers]


def parse_efetch(xml_text: str) -> list[Paper]:
    papers = []
    for article in ET.fromstring(xml_text).iter("PubmedArticle"):
        citation = article.find("MedlineCitation")
        pmid = citation.findtext("PMID")
        body = citation.find("Article")
        ids = {el.get("IdType"): el.text for el in article.iterfind("PubmedData/ArticleIdList/ArticleId")}
        date = _date(body)
        pub_types = [t.text for t in body.iterfind("PublicationTypeList/PublicationType") if t.text]
        papers.append(Paper(
            id=paper_id(pmid=pmid),
            pmid=pmid,
            # itertext, not .text: titles and abstracts carry inline <i>, <sup>, <sub>,
            # and .text stops at the first one (it truncated a third of abstracts in axiom).
            title=_text(body.find("ArticleTitle")).rstrip("."),
            abstract=" ".join(_text(part) for part in body.iterfind("Abstract/AbstractText")),
            year=int(date[:4]) if date else None,
            date=date,
            journal=body.findtext("Journal/ISOAbbreviation") or body.findtext("Journal/Title") or "",
            authors=[name for a in body.iterfind("AuthorList/Author") if (name := _author(a))],
            doi=ids["doi"].lower() if ids.get("doi") else None,
            pmcid=ids.get("pmc"),
            pub_types=pub_types,
            mesh=[m.text for m in citation.iterfind("MeshHeadingList/MeshHeading/DescriptorName") if m.text],
            nct_ids=[n.text for bank in body.iterfind("DataBankList/DataBank")
                     if bank.findtext("DataBankName") == "ClinicalTrials.gov"
                     for n in bank.iterfind("AccessionNumberList/AccessionNumber") if n.text],
            is_retracted="Retracted Publication" in pub_types,
        ))
    return papers


def _date(body: ET.Element) -> str | None:
    """ISO date: the electronic publication date when given, else the journal issue date."""
    electronic = body.find("ArticleDate")
    if electronic is not None:
        return f"{electronic.findtext('Year')}-{electronic.findtext('Month')}-{electronic.findtext('Day')}"
    issue = body.find("Journal/JournalIssue/PubDate")
    year = issue.findtext("Year") or (issue.findtext("MedlineDate") or "")[:4]
    if not year.isdigit():
        return None
    raw_month = issue.findtext("Month") or ""
    month = _MONTHS.get(raw_month[:3]) or (raw_month.zfill(2) if raw_month.isdigit() else None)
    return f"{year}-{month}" if month else year


def _author(el: ET.Element) -> str:
    if name := el.findtext("CollectiveName"):
        return name
    return " ".join(filter(None, [el.findtext("LastName"), el.findtext("Initials")]))


def _text(el: ET.Element | None) -> str:
    return " ".join("".join(el.itertext()).split()) if el is not None else ""


def _params(**params) -> dict:
    params["tool"] = "snowball-discovery"
    if key := os.getenv("NCBI_API_KEY"):
        params["api_key"] = key
    if email := os.getenv("NCBI_EMAIL"):
        params["email"] = email
    return params
