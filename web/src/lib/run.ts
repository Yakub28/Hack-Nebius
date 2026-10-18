import type { SearchRequest } from "../api/client";
import type { Brief, Discovery, Queries, Result, ResultMap, RunEvent, Seed, WebRound } from "../api/types";

// Typical seconds per stage, from real runs (2026-10-18): they weight the progress bar, they are not promises.
export const STAGES = [
  { key: "resolve", label: "Find your seeds", short: "Seeds", typical: 1 },
  { key: "plan", label: "Plan criteria and searches", short: "Plan", typical: 20 },
  { key: "graph", label: "Map the seeds' citations", short: "Citations", typical: 3 },
  { key: "candidates", label: "Search seven channels and the web", short: "Search", typical: 18 },
  { key: "hydrate", label: "Fetch records and citation metrics", short: "Records", typical: 8 },
  { key: "first_stage", label: "Embed and rank", short: "Rank", typical: 14 },
  { key: "judge", label: "Grade the strongest candidates", short: "Grade", typical: 55 },
  { key: "context", label: "Web context, the map and a brief", short: "Context", typical: 9 },
] as const;

export const TYPICAL_SECONDS = STAGES.reduce((sum, s) => sum + s.typical, 0);

export interface StageState {
  status: "pending" | "active" | "done";
  seconds?: number;
  startedAt?: number;
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
  brief?: Brief | null;
  data?: Discovery;
  error?: string;
  /** The result ids on screen when this run started, so its results can be marked new. */
  previous?: string[];
  /** Restored from storage after a reload, rather than watched live. */
  restored?: boolean;
}

export function newRun(request: SearchRequest, previous?: string[]): LiveRun {
  return {
    status: "running", request, started: Date.now(), previous,
    stages: Object.fromEntries(STAGES.map((s) => [s.key, { status: "pending" }])),
    seeds: [], channels: [], webRounds: [], results: [], graded: 0, warnings: [],
  };
}

/** A finished run as it was saved, ready to show again. */
export function restoredRun(saved: { request: SearchRequest; started: number; finished: number; previous?: string[]; data: Discovery }): LiveRun {
  const { data } = saved;
  return {
    ...newRun(saved.request, saved.previous),
    status: "done", started: saved.started, finished: saved.finished, restored: true, data,
    stages: Object.fromEntries(STAGES.map((s) => [s.key, { status: "done", seconds: data.timings[s.key] }])),
    seeds: data.seeds, results: data.results, warnings: data.warnings, map: data.map,
    plan: { criteria: data.criteria, queries: data.queries }, graded: data.stats.judged ?? 0,
  };
}

function cutoffOf(grades: (number | null)[] | undefined): number | null {
  const real = (grades ?? []).filter((g): g is number => g != null);
  return real.length ? Math.min(...real) : null;
}

/** Graded first, by grade; the rest in the first stage's order, until the judge reaches them. The engine's
 *  final sort is the same, so the live list converges on the finished one. */
export function liveOrder(a: Result, b: Result): number {
  return (b.grade ?? -1) - (a.grade ?? -1) || b.scores.fused - a.scores.fused;
}

export function applyEvent(run: LiveRun, e: RunEvent): LiveRun {
  switch (e.event) {
    case "stage": {
      const was = run.stages[e.data.stage];
      const state: StageState = e.data.status === "start"
        ? { status: "active", startedAt: Date.now() }
        : { ...was, status: "done", seconds: e.data.seconds };
      return { ...run, stages: { ...run.stages, [e.data.stage]: state } };
    }
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
      // Upsert: a paper the first stage ranked below the cut can grade its way into the list.
      const byId = new Map(run.results.map((r) => [r.id, r]));
      e.data.results.forEach((r) => byId.set(r.id, { ...byId.get(r.id), ...r }));
      const results = [...byId.values()].sort(liveOrder).slice(0, run.request.limit);
      return { ...run, results, judge: { done: e.data.done, total: e.data.total, papers: e.data.papers }, graded: run.graded + e.data.results.length };
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
    case "brief":
      return { ...run, brief: e.data.brief };
    case "warning":
      return { ...run, warnings: [...run.warnings, e.data.message] };
    case "result":
      return { ...run, status: "done", finished: Date.now(), data: e.data, results: e.data.results, seeds: e.data.seeds };
    case "error":
      return { ...run, status: "error", finished: Date.now(), error: e.data.detail };
  }
}

/** How far along the run is, 0–1, weighted by each stage's typical share of the time. The judge, the
 *  longest stage, counts its finished batches; other stages creep with time but never claim to be done. */
export function progress(run: LiveRun, now: number): number {
  let done = 0;
  for (const s of STAGES) {
    const state = run.stages[s.key];
    if (state.status === "done") done += s.typical;
    else if (state.status === "active") {
      const byTime = state.startedAt ? Math.min((now - state.startedAt) / 1000 / s.typical, 0.9) : 0;
      const fraction = s.key === "judge" ? (run.judge ? run.judge.done / run.judge.total : 0.03) : byTime;
      done += fraction * s.typical;
    }
  }
  return Math.min(done / TYPICAL_SECONDS, 1);
}

/** Seconds end to end: the engine's own stage timings when it reported them, else the wall clock. */
export function runSeconds(run: LiveRun, now: number): number {
  if (run.data) return Math.round(Object.values(run.data.timings).reduce((a, b) => a + b, 0));
  return Math.floor(((run.finished ?? now) - run.started) / 1000);
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
    brief: run.brief ?? null,
  };
}
