// The JSON shapes api.py sends. Kept by hand: the API is small and these change together with it.

export interface Paper {
  id: string;
  title: string;
  abstract: string;
  year: number | null;
  venue: string;
  authors: string[];
  doi: string | null;
  pmid: string | null;
  citations: number | null;
  rcr: number | null;
  preprint: boolean;
  types: string[];
  links: Record<string, string>;
}

export interface Seed extends Paper {
  label: string;
  grade: number | null;
}

export interface Source {
  kind: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  via: string;
}

export interface Result extends Paper {
  grade: number | null;
  likely_relevant: boolean;
  reason: string;
  quote: string | null;
  sources: Source[];
  theme: number | null;
  found_via: string[];
  channels: string[];
  cites_seeds: string[];
  cited_by_seeds: string[];
  nearest_seed: { label: string; similarity: number };
  scores: {
    fused: number;
    seed_similarity: number;
    question_similarity: number;
    cocited: number;
    shared_references: number;
  };
}

export interface WebRound {
  round: number;
  searches: string[];
  why: string;
  pages: number;
  papers: number;
}

export interface Theme {
  id: number;
  name: string;
  size: number;
  named_by: string;
}

export interface ResultMap {
  themes: Theme[];
  points: Record<string, [number, number]>;
  edges: { from: string; to: string }[];
}

/** A claim in the research brief and the results it rests on (ids from this search's results). */
export interface BriefClaim {
  text: string;
  papers: string[];
}

export interface BriefFinding extends BriefClaim {
  quote: string;          // verbatim from quote_paper's abstract: the engine checked it word for word
  quote_paper: string;
}

/** What the strongest results say together. The engine keeps only findings that check out (checked_brief). */
export interface Brief {
  answer: BriefClaim | null;
  findings: BriefFinding[];
  read: number;           // graded results the model read
  dropped: number;        // findings left out because they did not check out
  model: string;
}

export type Queries = Record<"pubmed_queries" | "preprint_queries" | "web_queries", string[]>;

export interface Discovery {
  question: string;
  seeds: Seed[];
  criteria: string[];
  queries: Queries;
  cutoff: number | null;
  results: Result[];
  warnings: string[];
  stats: Record<string, number>;
  timings: Record<string, number>;
  web_trail: WebRound[];
  map: ResultMap | null;
  brief?: Brief | null;
  recorded?: string;
}

export interface CollectionImport {
  format: string;
  refs: string[];
  entries: number;
  without_id: number;
  max_seeds: number;
}

export interface Health {
  ok: boolean;
  nebius: boolean;
  web: boolean;
}

/** Server-sent events from POST /discover/stream, in the order a search emits them. */
export type RunEvent =
  | { event: "stage"; data: { stage: string; status: "start" | "done"; seconds?: number } }
  | { event: "seeds"; data: { seeds: Seed[] } }
  | { event: "plan"; data: { criteria: string[]; queries: Queries } }
  | { event: "graph"; data: { cited_by: number; cites: number; cocited: number } }
  | { event: "channel"; data: { channel: string; name: string; found: number } }
  | { event: "web_round"; data: WebRound }
  | { event: "pool"; data: { size: number } }
  | { event: "ranked"; data: { results: Result[] } }
  | { event: "graded"; data: { done: number; total: number; papers: number; results: Result[] } }
  | { event: "seed_grades"; data: { grades: (number | null)[] } }
  | { event: "sources"; data: { id: string; sources: Source[] } }
  | { event: "map"; data: { map: ResultMap | null } }
  | { event: "brief"; data: { brief: Brief } }
  | { event: "warning"; data: { message: string } }
  | { event: "result"; data: Discovery }
  | { event: "error"; data: { status: number; detail: string } };
