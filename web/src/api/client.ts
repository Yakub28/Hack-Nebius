import type { CollectionImport, Discovery, Health, RunEvent } from "./types";

// Empty: same origin (the API serves the built app, and the dev server proxies to it).
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface SearchRequest {
  question: string;
  seeds: string[];
  limit: number;
}

function detail(payload: unknown): string {
  const d = (payload as { detail?: unknown } | null)?.detail;
  if (!d) return "";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d.map((x: { loc?: unknown[]; msg?: string }) => `${(x.loc ?? []).slice(1).join(".")}: ${x.msg}`).join("; ");
  }
  return JSON.stringify(d);
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(`Could not reach the API at ${API_BASE || location.origin}. Is it running?`, 0);
  }
  if (!resp.ok) {
    const payload: T | null = await resp.json().catch(() => null);
    throw new ApiError(detail(payload) || `HTTP ${resp.status}`, resp.status);
  }
  return resp;
}

export const api = {
  async health(): Promise<Health> {
    const resp = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new ApiError(`HTTP ${resp.status}`, resp.status);
    return resp.json();
  },

  async importCollection(text: string): Promise<CollectionImport> {
    return (await post("/collection", { text })).json();
  },

  async recorded(): Promise<Discovery> {
    const resp = await fetch("/sample.json");
    if (!resp.ok) throw new ApiError(`sample.json: HTTP ${resp.status}`, resp.status);
    return resp.json();
  },

  /** Runs a search, calling `onEvent` for each server-sent event as it arrives. Resolves when the stream
   *  ends; aborting `signal` closes the connection, which cancels the search on the server. */
  async stream(body: SearchRequest, onEvent: (e: RunEvent) => void, signal: AbortSignal): Promise<void> {
    const resp = await post("/discover/stream", body, signal);
    const reader = resp.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let event = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (data) onEvent({ event, data: JSON.parse(data) } as RunEvent);   // ":" lines are keep-alives
      }
    }
  },
};
