import type { Paper } from "../api/types";

export const GRADES: Record<number, string> = { 4: "Direct", 3: "High", 2: "Partial", 1: "Tangent", 0: "No" };

export const CHANNELS: Record<string, [string, string]> = {
  similar: ["PubMed similar", "PubMed's own nearest neighbours of a seed"],
  cites: ["Cites a seed", "Newer work that cites your seeds"],
  refs: ["Cited by a seed", "Earlier work your seeds build on"],
  cocited: ["Co-cited", "Cited together with your seeds by the same papers"],
  query: ["PubMed search", "LLM-written PubMed queries"],
  preprint: ["Preprint", "bioRxiv / medRxiv via Europe PMC"],
  web: ["Web (Tavily)", "Found by the web search agent, resolved to a PubMed or Europe PMC record"],
};

export const LINK_NAMES: Record<string, string> = { pubmed: "PubMed", doi: "DOI", europepmc: "Europe PMC" };

export const MAX_SEEDS = 30;

export function authors(list: string[]): string {
  if (!list.length) return "";
  return list.length > 3 ? `${list.slice(0, 3).join(", ")} et al.` : list.join(", ");
}

export function firstLink(p: Paper): string {
  return p.links.pubmed || p.links.doi || p.links.europepmc || "#";
}

/** Hrefs that came from a search engine: only plain web links are rendered as links. */
export function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

/** What the seed box takes for a paper: its most precise identifier. */
export function refOf(p: Paper): string {
  return p.pmid || p.doi || p.title;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function seedLines(text: string): string[] {
  return text.split("\n").map((s) => s.trim()).filter(Boolean);
}

/** The first author's surname and "et al.": enough to recognise a paper in a list. */
export function shortAuthors(list: string[]): string {
  if (!list.length) return "";
  const first = list[0].split(" ").pop() ?? list[0];
  return list.length > 1 ? `${first} et al.` : first;
}

const PHASES: Record<string, string> = { "Clinical Trial, Phase IV": "4", "Clinical Trial, Phase III": "3", "Clinical Trial, Phase II": "2", "Clinical Trial, Phase I": "1" };

/** The study design a reader screens on, from PubMed's publication types. */
export function studyDesign(types: string[]): string {
  const has = (t: string) => types.includes(t);
  const phase = Object.keys(PHASES).find(has);
  if (has("Meta-Analysis")) return "Meta-analysis";
  if (has("Systematic Review")) return "Systematic review";
  if (has("Randomized Controlled Trial")) return phase ? `Phase ${PHASES[phase]} RCT` : "RCT";
  if (phase) return `Phase ${PHASES[phase]} trial`;
  if (has("Clinical Trial")) return "Clinical trial";
  if (has("Observational Study")) return "Observational study";
  if (has("Review")) return "Review";
  return "";
}

/** Warnings that mean a source or step failed, as opposed to notes about what was skipped on purpose. Every
 *  warning is shown either way; this only decides how loudly. */
export function isProblem(warning: string): boolean {
  return /fail|not found|could not|is off|skipped/i.test(warning);
}

export function isSeedProblem(warning: string): boolean {
  return /^(Seed not found|Could not look up seed)/.test(warning);
}
