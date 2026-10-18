import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, api } from "../api/client";
import { applyEvent, newRun, type LiveRun } from "./run";
import { MAX_SEEDS, seedLines } from "./format";

export interface Form {
  question: string;
  seeds: string;
  limit: number;
}

interface Session {
  form: Form;
  setForm: (patch: Partial<Form>) => void;
  run: LiveRun | null;
  /** Starts a search from the form; returns why it could not, if it could not. */
  start: () => string | null;
  cancel: () => void;
  addSeed: (ref: string) => "added" | "exists" | "full";
  isSeed: (ref: string) => boolean;
}

const SessionContext = createContext<Session | null>(null);

function loadForm(): Form {
  try {
    const saved = JSON.parse(localStorage.getItem("pd:last") ?? "null");
    if (saved) return { question: saved.question ?? "", seeds: saved.seeds ?? "", limit: saved.limit ?? 50 };
  } catch { /* private mode or blocked storage: start empty */ }
  return { question: "", seeds: "", limit: 50 };
}

function saveForm(form: Form) {
  try { localStorage.setItem("pd:last", JSON.stringify(form)); } catch { /* the form still works */ }
}

/** One search session for the whole app: it survives moving between pages, so a running search keeps
 *  running while you read the overview. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [form, setFormState] = useState<Form>(loadForm);
  const [run, setRun] = useState<LiveRun | null>(null);
  const controller = useRef<AbortController | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  const setForm = useCallback((patch: Partial<Form>) => {
    setFormState((f) => {
      const next = { ...f, ...patch };
      saveForm(next);
      return next;
    });
  }, []);

  const start = useCallback((): string | null => {
    const f = formRef.current;
    const seeds = seedLines(f.seeds);
    if (f.question.trim().length < 3 || !seeds.length) return "Enter a question and at least one seed paper.";
    if (seeds.length > MAX_SEEDS) return `A search takes up to ${MAX_SEEDS} seeds; there are ${seeds.length} in the box.`;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const request = { question: f.question.trim(), seeds, limit: f.limit };
    setRun(newRun(request));
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
  }, []);

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

  const value = useMemo(() => ({ form, setForm, run, start, cancel, addSeed, isSeed }),
    [form, setForm, run, start, cancel, addSeed, isSeed]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}
