import type { SearchRequest } from "../api/client";
import type { Discovery, Queries, Result, ResultMap, RunEvent, Seed, WebRound } from "../api/types";

export const STAGES = [
  { key: "resolve", label: "Find your seeds", typical: 1 },
  { key: "plan", label: "Plan criteria and searches", typical: 13 },
  { key: "graph", label: "Map the seeds' citations", typical: 3 },
  { key: "candidates", label: "Search seven channels and the web", typical: 18 },
  { key: "hydrate", label: "Fetch records and citation metrics", typical: 8 },
  { key: "first_stage", label: "Embed and rank", typical: 11 },
  { key: "judge", label: "Grade the strongest candidates", typical: 49 },
  { key: "context", label: "Web context and the map", typical: 7 },
] as const;

export const TYPICAL_SECONDS = STAGES.reduce((sum, s) => sum + s.typical, 0);

export interface StageState {
  status: "pending" | "active" | "done";
  seconds?: number;
}

export interface LiveRun {
  status: "running" | "done" | "error" | "cancelled";
  request: SearchRequest;
  started: number;
  finished?: number;
  stages: Record<string, StageState>;
  seeds: Seed[];
  plan?: { criteria: string[]; queries: Queries };
  graph?: { cited_by: number; cites: number; cocited: number };
  channels: { channel: string; name: string; found: number }[];
  webRounds: WebRound[];
  pool?: number;
  results: Result[];
  judge?: { done: number; total: number; papers: number };
  graded: number;
  seedGrades?: (number | null)[];
  warnings: string[];
  map?: ResultMap | null;
  data?: Discovery;
  error?: string;
}

export function newRun(request: SearchRequest): LiveRun {
  return {
    status: "running", request, started: Date.now(),
    stages: Object.fromEntries(STAGES.map((s) => [s.key, { status: "pending" }])),
    seeds: [], channels: [], webRounds: [], results: [], graded: 0, warnings: [],
  };
}

function cutoffOf(grades: (number | null)[] | undefined): number | null {
  const real = (grades ?? []).filter((g): g is number => g != null);
  return real.length ? Math.min(...real) : null;
}

/** Graded first, by grade; the rest in the first stage's order, until the judge reaches them. */
export function liveOrder(a: Result, b: Result): number {
  return (b.grade ?? -1) - (a.grade ?? -1) || b.scores.fused - a.scores.fused;
}

export function applyEvent(run: LiveRun, e: RunEvent): LiveRun {
  switch (e.event) {
    case "stage":
      return { ...run, stages: { ...run.stages, [e.data.stage]: { status: e.data.status === "start" ? "active" : "done", seconds: e.data.seconds } } };
    case "seeds":
      return { ...run, seeds: e.data.seeds };
    case "plan":
      return { ...run, plan: e.data };
    case "graph":
      return { ...run, graph: e.data };
    case "channel":
      return { ...run, channels: [...run.channels, e.data] };
    case "web_round":
      return { ...run, webRounds: [...run.webRounds, e.data] };
    case "pool":
      return { ...run, pool: e.data.size };
    case "ranked":
      return { ...run, results: e.data.results };
    case "graded": {
      const byId = new Map(e.data.grades.map((g) => [g.id, g]));
      const results = run.results.map((r) => {
        const g = byId.get(r.id);
        return g ? { ...r, grade: g.grade, reason: g.reason, quote: g.quote } : r;
      });
      return { ...run, results: [...results].sort(liveOrder), judge: e.data, graded: run.graded + e.data.grades.length };
    }
    case "seed_grades": {
      const cutoff = cutoffOf(e.data.grades);
      return {
        ...run, seedGrades: e.data.grades,
        seeds: run.seeds.map((s, i) => ({ ...s, grade: e.data.grades[i] ?? null })),
        results: run.results.map((r) => ({ ...r, likely_relevant: r.grade != null && cutoff != null && r.grade >= cutoff })),
      };
    }
    case "sources":
      return { ...run, results: run.results.map((r) => (r.id === e.data.id ? { ...r, sources: e.data.sources } : r)) };
    case "map":
      return { ...run, map: e.data.map };
    case "warning":
      return { ...run, warnings: [...run.warnings, e.data.message] };
    case "result":
      return { ...run, status: "done", finished: Date.now(), data: e.data, results: e.data.results, seeds: e.data.seeds };
    case "error":
      return { ...run, status: "error", finished: Date.now(), error: e.data.detail };
  }
}

/** A run in progress, shaped like a finished search, so the same components render both. */
export function asDiscovery(run: LiveRun): Discovery {
  if (run.data) return run.data;
  const stats: Record<string, number> = {};
  run.channels.forEach((c) => { stats[c.channel] = (stats[c.channel] ?? 0) + c.found; });
  if (run.pool != null) stats.pool = run.pool;
  stats.judged = run.graded;
  return {
    question: run.request.question,
    seeds: run.seeds,
    criteria: run.plan?.criteria ?? [],
    queries: run.plan?.queries ?? { pubmed_queries: [], preprint_queries: [], web_queries: [] },
    cutoff: cutoffOf(run.seedGrades),
    results: run.results,
    warnings: run.warnings,
    stats,
    timings: Object.fromEntries(Object.entries(run.stages).filter(([, s]) => s.seconds != null).map(([k, s]) => [k, s.seconds!])),
    web_trail: run.webRounds,
    map: run.map ?? null,
  };
}
