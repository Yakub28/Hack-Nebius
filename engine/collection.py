"""A researcher's existing collection, from a reference-manager export, as seed references.

Formats are detected from the content, not the file name: RIS (Zotero, Mendeley, EndNote), MEDLINE
(PubMed's .nbib), BibTeX, CSV (Zotero's or PubMed's export), or a plain list with one reference per line.
Each entry becomes its most precise identifier, PMID over DOI over title: an exact title is the weakest
match the seed resolver accepts.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass

from engine.paper import doi_in_url

_PMID_NOTE_RE = re.compile(r"\bPMID:?\s*(\d{1,9})\b", re.I)
_PUBMED_URL_RE = re.compile(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d{1,9})")
_DOI_RE = re.compile(r"10\.\d{4,9}/[^\s\"<>{}]+")
_RIS_LINE_RE = re.compile(r"^([A-Z][A-Z0-9])  -(?: (.*))?$")
_MEDLINE_LINE_RE = re.compile(r"^([A-Z]{2,4}) *- (.*)$")
_BIB_FIELD_RE = re.compile(r"\s*([\w-]+)\s*=\s*")
_BIB_BARE_RE = re.compile(r"[^,}]*")


@dataclass
class Entry:
    title: str = ""
    doi: str | None = None
    pmid: str | None = None

    @property
    def ref(self) -> str | None:
        return self.pmid or self.doi or self.title or None


@dataclass
class Collection:
    format: str
    entries: list[Entry]


def parse(text: str) -> Collection:
    text = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    if re.search(r"^TY  - ", text, re.M):
        return Collection("RIS", _ris(text))
    if re.search(r"^PMID- ", text, re.M):
        return Collection("MEDLINE", _medline(text))
    if re.search(r"^\s*@(?!comment|string|preamble)\w+\s*[{(]", text, re.M | re.I):
        return Collection("BibTeX", _bibtex(text))
    header = text.split("\n", 1)[0].lower()
    if "," in header and "title" in header:
        return Collection("CSV", _csv(text))
    return Collection("list", [_from_line(line.strip()) for line in text.split("\n") if line.strip()])


# --- formats --------------------------------------------------------------------

def _ris(text: str) -> list[Entry]:
    entries, tags = [], {}
    for line in text.split("\n"):
        m = _RIS_LINE_RE.match(line)
        if not m:
            continue
        tag, value = m.group(1), (m.group(2) or "").strip()
        if tag == "ER":
            entries.append(_ris_entry(tags))
            tags = {}
        else:
            tags.setdefault(tag, []).append(value)
    if tags:
        entries.append(_ris_entry(tags))
    return entries


def _ris_entry(tags: dict[str, list[str]]) -> Entry:
    title = next((v for t in ("TI", "T1", "CT") for v in tags.get(t, []) if v), "")
    urls = tags.get("UR", []) + tags.get("L2", [])
    doi = next((d for d in [*map(_doi, tags.get("DO", [])), *map(doi_in_url, urls)] if d), None)
    # Reference managers put the PMID in different places: an accession number, a note, a PubMed URL.
    notes = [v for t in ("AN", "N1", "M1", "C1", "C2", "C5", "C7") for v in tags.get(t, [])]
    pmid = next((p for p in (_pmid(v) for v in notes + urls) if p), None)
    an = tags.get("AN", [""])[0]
    if not pmid and an.isdigit() and any("pubmed" in v.lower() for v in tags.get("DB", []) + tags.get("DP", [])):
        pmid = an
    return Entry(title=_clean(title), doi=doi, pmid=pmid)


def _medline(text: str) -> list[Entry]:
    entries, tags, last = [], {}, None
    for line in [*text.split("\n"), ""]:     # the trailing blank line closes the last record
        if not line.strip():
            if tags:
                entries.append(_medline_entry(tags))
            tags, last = {}, None
        elif m := _MEDLINE_LINE_RE.match(line):
            last = m.group(1)
            tags.setdefault(last, []).append(m.group(2).strip())
        elif last and line.startswith(" "):     # a wrapped value continues on an indented line
            tags[last][-1] += " " + line.strip()
    return entries


def _medline_entry(tags: dict[str, list[str]]) -> Entry:
    ids = tags.get("LID", []) + tags.get("AID", [])
    doi = next((_doi(v) for v in ids if v.endswith("[doi]")), None)
    pmid = tags.get("PMID", [""])[0]
    return Entry(title=_clean(tags.get("TI", [""])[0]), doi=doi, pmid=pmid if pmid.isdigit() else None)


def _bibtex(text: str) -> list[Entry]:
    entries = []
    for m in re.finditer(r"@(\w+)\s*([{(])", text):
        if m.group(1).lower() in {"comment", "string", "preamble"}:
            continue
        body = _balanced(text, m.end() - 1)
        fields = _bib_fields(body)
        notes = " ".join(fields.get(k, "") for k in ("note", "annote", "extra", "annotation"))
        pmid = fields.get("pmid", "").strip() or _pmid(notes) or _pmid(fields.get("url", ""))
        doi = _doi(fields.get("doi", "")) or doi_in_url(fields.get("url", ""))
        entries.append(Entry(title=_clean(fields.get("title", "")), doi=doi,
                             pmid=pmid if pmid and pmid.isdigit() else None))
    return entries


def _balanced(text: str, start: int) -> str:
    """The text inside the bracket at `start`, up to its matching close."""
    close = "}" if text[start] == "{" else ")"
    depth = 0
    for i in range(start, len(text)):
        ch = text[i]
        if ch in "{(":
            depth += ch == text[start]
        elif ch == close and (depth := depth - 1) == 0:
            return text[start + 1:i]
    return text[start + 1:]


def _bib_fields(body: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    i = body.find(",") + 1          # skip the citation key
    while 0 < i < len(body):
        m = _BIB_FIELD_RE.match(body, i)
        if not m:
            i = body.find(",", i) + 1
            continue
        name, i = m.group(1).lower(), m.end()
        if body.startswith("{", i):
            value = _balanced(body, i)
            i += len(value) + 2
        elif body.startswith('"', i):
            end = body.find('"', i + 1)
            end = len(body) if end < 0 else end
            value, i = body[i + 1:end], end + 1
        else:
            bare = _BIB_BARE_RE.match(body, i)
            value, i = bare.group(0), bare.end()
        fields[name] = value.strip()
        i = body.find(",", i) + 1
    return fields


def _csv(text: str) -> list[Entry]:
    entries = []
    for row in csv.DictReader(io.StringIO(text)):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items() if isinstance(v, str)}
        pmid = row.get("pmid") or row.get("pubmed id") or _pmid(row.get("extra", "") + " " + row.get("notes", ""))
        doi = _doi(row.get("doi", "")) or doi_in_url(row.get("url", ""))
        title = row.get("title") or row.get("article title") or ""
        entries.append(Entry(title=_clean(title), doi=doi, pmid=pmid if pmid and pmid.isdigit() else None))
    return entries


def _from_line(line: str) -> Entry:
    if line.isdigit():
        return Entry(pmid=line)
    if pmid := _pmid(line):
        return Entry(pmid=pmid)
    if doi := doi_in_url(line) if "://" in line else _doi(line):
        return Entry(doi=doi)
    return Entry(title=line)


# --- fields ---------------------------------------------------------------------

def _pmid(value: str) -> str | None:
    m = _PUBMED_URL_RE.search(value) or _PMID_NOTE_RE.search(value)
    return m.group(1) if m else None


def _doi(value: str) -> str | None:
    m = _DOI_RE.search(value)
    return m.group(0).rstrip(".,;").lower() if m else None


def _clean(title: str) -> str:
    """BibTeX braces and LaTeX commands out, whitespace collapsed: the resolver matches titles exactly."""
    title = re.sub(r"\\[a-zA-Z]+\s*", "", title)
    return " ".join(title.replace("{", "").replace("}", "").split())
