import type { Result } from "../api/types";
import { firstLink } from "./format";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportRis(list: Result[]) {
  const records = list.map((r) => [
    `TY  - ${r.preprint ? "UNPB" : "JOUR"}`,
    `TI  - ${r.title}`,
    ...r.authors.map((a) => `AU  - ${a}`),
    r.year ? `PY  - ${r.year}` : "",
    r.venue ? `JO  - ${r.venue}` : "",
    r.doi ? `DO  - ${r.doi}` : "",
    r.pmid ? `AN  - PMID:${r.pmid}` : "",
    r.abstract ? `AB  - ${r.abstract.replace(/\s+/g, " ")}` : "",
    `UR  - ${firstLink(r)}`,
    r.grade != null ? `N1  - Grade ${r.grade}/4. ${r.reason}` : "",
    "ER  - ",
  ].filter(Boolean).join("\r\n"));
  download("papers.ris", records.join("\r\n\r\n") + "\r\n", "application/x-research-info-systems");
}

export function exportCsv(list: Result[], themeName: (id: number | null) => string) {
  const cols = ["rank", "grade", "likely_relevant", "title", "year", "venue", "authors", "doi", "pmid",
    "citations", "channels", "theme", "reason", "quote", "url"];
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = list.map((r, i) => [i + 1, r.grade, r.likely_relevant, r.title, r.year, r.venue, r.authors.join("; "),
    r.doi, r.pmid, r.citations, r.channels.join("; "), themeName(r.theme), r.reason, r.quote, firstLink(r)].map(cell).join(","));
  download("papers.csv", [cols.join(","), ...rows].join("\r\n"), "text/csv");
}
