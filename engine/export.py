"""Reference-manager exports: RIS (Zotero, EndNote, Mendeley) and CSV."""
from __future__ import annotations

import csv
import io

from engine.run import Candidate


def ris(candidates: list[Candidate]) -> str:
    lines = []
    for c in candidates:
        p = c.paper
        lines.append("TY  - JOUR")
        lines.append(f"TI  - {p.title}")
        lines += [f"AU  - {a}" for a in p.authors]
        if p.year:
            lines.append(f"PY  - {p.year}")
        if p.journal:
            lines.append(f"JO  - {p.journal}")
        if p.doi:
            lines.append(f"DO  - {p.doi}")
        if p.pmid:
            lines.append(f"AN  - {p.pmid}")
        if url := next(iter(p.links.values()), None):
            lines.append(f"UR  - {url}")
        if p.abstract:
            lines.append(f"AB  - {p.abstract}")
        if note := _note(c):
            lines.append(f"N1  - {note}")
        lines.append("ER  - ")
        lines.append("")
    return "\n".join(lines)


def csv_text(candidates: list[Candidate]) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["title", "authors", "year", "journal", "doi", "pmid", "study_type", "preprint", "grade",
                     "score", "citations", "similar", "meaning", "fit", "relation", "reason", "quote", "links"])
    for c in candidates:
        p = c.paper
        writer.writerow([p.title, "; ".join(p.authors), p.year, p.journal, p.doi, p.pmid, p.study_type,
                         p.is_preprint, c.grade, c.score, c.signals.get("citations"), c.signals.get("similar"),
                         c.signals.get("meaning"), (c.grade or 0) / 3,
                         c.explained.relation if c.explained else "", _reason(c), c.quote or "",
                         " ".join(p.links.values())])
    return out.getvalue()


def _note(c: Candidate) -> str:
    parts = [f"Snowball: {_reason(c)}"] if _reason(c) else []
    if c.quote:
        parts.append(f'Quote: "{c.quote}"')
    return " ".join(parts)


def _reason(c: Candidate) -> str:
    if c.explained and not c.explained.abstain:
        return f"{c.explained.relation}: {c.explained.reason}"
    return c.screened.reason if c.screened else ""
