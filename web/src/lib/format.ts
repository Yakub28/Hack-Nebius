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

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

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
