import type { Discovery } from "../api/types";
import { foundByKeywords, plural, studyDesign } from "./format";

export interface Pattern {
  label: string;
  detail: string;
  paper?: string;     // a result the pattern is about, to open
}

const DESIGNS: [RegExp, string, string][] = [
  [/RCT$/, "RCT", "RCTs"],
  [/^Meta-analysis$/, "meta-analysis", "meta-analyses"],
  [/^Systematic review$/, "systematic review", "systematic reviews"],
  [/trial$/, "other trial", "other trials"],
  [/^Observational/, "observational study", "observational studies"],
  [/^Review$/, "review", "reviews"],
];

/** Patterns across the results, counted from the records rather than written by a model: they can be
 *  incomplete, but not invented. */
export function patterns(data: Discovery): Pattern[] {
  const results = data.results;
  if (results.length < 5) return [];
  const out: Pattern[] = [];

  const searches = data.queries.pubmed_queries.length + data.queries.preprint_queries.length;
  const beyond = results.filter((r) => r.channels.length && !foundByKeywords(r)).length;
  if (searches && beyond && results.some(foundByKeywords)) {
    out.push({
      label: `${beyond} of ${results.length} beyond keyword search`,
      detail: `None of this run's ${plural(searches, "PubMed or preprint query", "PubMed and preprint queries")} returned them: `
        + "they came from the seeds' citations, co-citation, PubMed similar articles or the web agent.",
    });
  }

  // The result the others cite most: often the paper the rest builds on.
  const ids = new Set(results.map((r) => r.id));
  const cited = new Map<string, number>();
  for (const e of data.map?.edges ?? []) {
    if (ids.has(e.from) && ids.has(e.to)) cited.set(e.to, (cited.get(e.to) ?? 0) + 1);
  }
  const [hub, times] = [...cited].sort((a, b) => b[1] - a[1])[0] ?? [];
  const paper = results.find((r) => r.id === hub);
  if (paper && times >= 3) {
    out.push({ label: `Most cited here: ${shortTitle(paper.title)}`, paper: paper.id,
               detail: `${paper.title} Cited by ${times} of the other results.` });
  }

  const designs = new Map<number, number>();
  for (const r of results) {
    const design = studyDesign(r.types);
    const kind = DESIGNS.findIndex(([test]) => test.test(design));
    if (kind >= 0) designs.set(kind, (designs.get(kind) ?? 0) + 1);
  }
  const mix = [...designs].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (mix.length) {
    out.push({ label: mix.map(([kind, n]) => `${n} ${n === 1 ? DESIGNS[kind][1] : DESIGNS[kind][2]}`).join(" · "),
               detail: "Study designs, from PubMed's publication types." });
  }

  const years = results.map((r) => r.year).filter((y): y is number => y != null).sort((a, b) => a - b);
  if (years.length >= 5) {
    out.push({ label: `${years[0]}–${years[years.length - 1]}, half since ${years[Math.floor(years.length / 2)]}`,
               detail: "Publication years of the results." });
  }
  const preprints = results.filter((r) => r.preprint).length;
  if (preprints) out.push({ label: plural(preprints, "preprint"), detail: "Not peer reviewed yet." });
  return out;
}

function shortTitle(title: string): string {
  const clean = title.replace(/\.$/, "");
  return clean.length <= 48 ? clean : `${clean.slice(0, 46).replace(/\s+\S*$/, "")}…`;
}
