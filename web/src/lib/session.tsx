import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, api, type SearchRequest } from "../api/client";
import type { Discovery, Result } from "../api/types";
import { applyEvent, newRun, restoredRun, type LiveRun } from "./run";
import { MAX_SEEDS, seedLines } from "./format";

/** A paper on the shortlist, with the question it was kept for: its grade and reason answer that question. */
export type Kept = Result & { kept_from?: string; kept_at?: number };

export interface Form {
  question: string;
  seeds: string;
  limit: number;
}

interface Session {
  form: Form;
  setForm: (patch: Partial<Form>) => void;
  run: LiveRun | null;
  /** Starts a search from the form (with `override` applied to it first); returns why it could not, if it could not. */
  start: (override?: Partial<Form>) => string | null;
  cancel: () => void;
  addSeed: (ref: string) => "added" | "exists" | "full";
  isSeed: (ref: string) => boolean;
  /** A search the page lost by reloading mid-run (the server stops when the connection closes). */
  interrupted: SearchRequest | null;
  dismissInterrupted: () => void;
  /** The researcher's shortlist, kept across searches, and the papers they set aside. */
  kept: Record<string, Kept>;
  toggleKeep: (paper: Kept) => void;
  clearKept: () => void;
  dismissed: Set<string>;
  toggleDismiss: (id: string) => void;
  /** What the page is showing, so the next search can tell which of its results are new. */
  setShown: (data: Discovery | null) => void;
}

const SessionContext = createContext<Session | null>(null);

// Browser storage is a convenience: every read and write may fail (private mode, quota), and the app works without it.
function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* still works, just not across reloads */ }
}

function loadForm(): Form {
  const saved = load<Partial<Form> | null>("pd:last", null);
  return { question: saved?.question ?? "", seeds: saved?.seeds ?? "", limit: saved?.limit ?? 50 };
}

function loadRun(): LiveRun | null {
  const saved = load<Parameters<typeof restoredRun>[0] | null>("pd:run", null);
  try { return saved?.data?.results ? restoredRun(saved) : null; } catch { return null; }
}

/** One search session for the whole app: it survives moving between pages, so a running search keeps
 *  running while you read the overview, and the finished one survives a reload. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [form, setFormState] = useState<Form>(loadForm);
  const [run, setRun] = useState<LiveRun | null>(loadRun);
  const [interrupted, setInterrupted] = useState<SearchRequest | null>(() => load("pd:pending", null));
  const [kept, setKept] = useState<Record<string, Kept>>(() => load("pd:kept", {}));
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set(load<string[]>("pd:dismissed", [])));
  const controller = useRef<AbortController | null>(null);
  const formRef = useRef(form);
  formRef.current = form;
  const shown = useRef<Discovery | null>(null);

  useEffect(() => { save("pd:kept", kept); }, [kept]);
  useEffect(() => { save("pd:dismissed", [...dismissed]); }, [dismissed]);
  // A finished run is saved whole; a run that ends any other way leaves nothing pending behind.
  useEffect(() => {
    if (!run || run.status === "running") return;
    save("pd:pending", null);
    if (run.status === "done" && run.data && !run.restored) {
      save("pd:run", { request: run.request, started: run.started, finished: run.finished, previous: run.previous, data: run.data });
    }
  }, [run?.status, run?.data]);

  const setForm = useCallback((patch: Partial<Form>) => {
    setFormState((f) => {
      const next = { ...f, ...patch };
      save("pd:last", next);
      return next;
    });
  }, []);

  const start = useCallback((override?: Partial<Form>): string | null => {
    if (override) setForm(override);
    const f = override ? { ...formRef.current, ...override } : formRef.current;
    const seeds = seedLines(f.seeds);
    if (f.question.trim().length < 3 || !seeds.length) return "Enter a question and at least one seed paper.";
    if (seeds.length > MAX_SEEDS) return `A search takes up to ${MAX_SEEDS} seeds; there are ${seeds.length} in the box.`;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const request = { question: f.question.trim(), seeds, limit: f.limit };
    setRun(newRun(request, shown.current?.results.map((r) => r.id)));
    setInterrupted(null);
    save("pd:pending", request);
    api.stream(request, (e) => setRun((r) => (r && !abort.signal.aborted ? applyEvent(r, e) : r)), abort.signal)
      .then(() => setRun((r) => (r && r.status === "running"
        ? { ...r, status: "error", error: "The connection closed before the search finished." } : r)))
      .catch((err: Error) => {
        if (err.name === "AbortError") {
          setRun((r) => (r ? { ...r, status: "cancelled", finished: Date.now() } : r));
        } else {
          setRun((r) => (r ? { ...r, status: "error", error: err instanceof ApiError ? err.message : String(err) } : r));
        }
      });
    return null;
  }, [setForm]);

  const cancel = useCallback(() => controller.current?.abort(), []);

  const isSeed = useCallback(
    (ref: string) => seedLines(formRef.current.seeds).some((s) => s.toLowerCase() === ref.toLowerCase()), []);

  const addSeed = useCallback((ref: string) => {
    const seeds = seedLines(formRef.current.seeds);
    if (seeds.some((s) => s.toLowerCase() === ref.toLowerCase())) return "exists";
    if (seeds.length >= MAX_SEEDS) return "full";
    setForm({ seeds: [...seeds, ref].join("\n") });
    return "added";
  }, [setForm]);

  // A paper put back from the shortlist page brings its own kept_from; one kept from results takes the search on screen.
  const toggleKeep = useCallback((paper: Kept) => setKept((k) => {
    const next = { ...k };
    if (next[paper.id]) delete next[paper.id];
    else next[paper.id] = { kept_from: shown.current?.question, kept_at: Date.now(), ...paper };
    return next;
  }), []);
  const clearKept = useCallback(() => setKept({}), []);
  const toggleDismiss = useCallback((id: string) => setDismissed((d) => {
    const next = new Set(d);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const dismissInterrupted = useCallback(() => { setInterrupted(null); save("pd:pending", null); }, []);
  const setShown = useCallback((data: Discovery | null) => { shown.current = data; }, []);

  const value = useMemo(() => ({
    form, setForm, run, start, cancel, addSeed, isSeed, interrupted, dismissInterrupted,
    kept, toggleKeep, clearKept, dismissed, toggleDismiss, setShown,
  }), [form, setForm, run, start, cancel, addSeed, isSeed, interrupted, dismissInterrupted, kept, toggleKeep, clearKept, dismissed, toggleDismiss, setShown]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}
