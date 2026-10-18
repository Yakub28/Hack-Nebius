import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { MAX_SEEDS, plural, seedLines } from "../lib/format";
import { useSession } from "../lib/session";
import { useToast } from "./Toast";

export const EXAMPLE = {
  question: "Which incretin-based drugs reduce body weight in adults with obesity?",
  seeds: "33567185\nTirzepatide Once Weekly for the Treatment of Obesity",
};

/** Reads a reference-manager export into the seed box: shared by the centred search and the sidebar form. */
export function useCollectionImport(onError: (message: string | null) => void) {
  const { setForm } = useSession();
  const toast = useToast();
  const [note, setNote] = useState<string | null>(null);

  async function importFile(file: File) {
    onError(null);
    setNote(null);
    if (file.size > 5e6) {
      onError(`${file.name} is over 5 MB. Export only the papers you want as seeds.`);
      return;
    }
    try {
      const got = await api.importCollection(await file.text());
      const kept = got.refs.slice(0, got.max_seeds);
      setForm({ seeds: kept.join("\n") });
      const parts = [`Imported ${plural(kept.length, "paper")} from ${file.name} (${got.format}).`];
      if (got.refs.length > kept.length) {
        parts.push(`A search takes up to ${got.max_seeds} seeds, so the first ${got.max_seeds} of ${got.refs.length} are in the box; edit it to choose others.`);
      }
      if (got.without_id) {
        parts.push(`${plural(got.without_id, "entry", "entries")} without a PMID, DOI or title ${got.without_id === 1 ? "was" : "were"} skipped.`);
      }
      setNote(parts.join(" "));
      toast(`Imported ${plural(kept.length, "seed")} from ${file.name}`);
    } catch (err) {
      onError(err instanceof ApiError && err.status === 0 ? err.message : `Could not import ${file.name}: ${(err as Error).message}`);
    }
  }

  return { importFile, note };
}

// The API's bounds on how many results a search returns.
const LIMIT_MIN = 1;
const LIMIT_MAX = 200;
const clampLimit = (n: number) => Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.round(n)));

/** How many results to ask for: any number the API accepts, with − and + stepping between round tens. */
export function LimitField({ id, disabled }: { id: string; disabled?: boolean }) {
  const { form, setForm } = useSession();
  // The box holds what is typed, so an empty or half-typed value doesn't snap back mid-keystroke.
  const [draft, setDraft] = useState(String(form.limit));
  useEffect(() => setDraft(String(form.limit)), [form.limit]);

  function type(text: string) {
    const digits = text.replace(/\D/g, "").slice(0, 3);
    setDraft(digits);
    if (digits) setForm({ limit: clampLimit(Number(digits)) });
  }

  const step = (dir: 1 | -1) =>
    setForm({ limit: clampLimit(dir > 0 ? Math.floor(form.limit / 10) * 10 + 10 : Math.ceil(form.limit / 10) * 10 - 10) });

  return (
    <div className="limit">
      <label htmlFor={id}>Top</label>
      <div className={`limit-field${disabled ? " disabled" : ""}`}>
        <button type="button" aria-label="Fewer results" disabled={disabled || form.limit <= LIMIT_MIN} onClick={() => step(-1)}>−</button>
        <input id={id} type="text" inputMode="numeric" aria-describedby={`${id}-range`} value={draft} disabled={disabled}
          onChange={(e) => type(e.target.value)} onBlur={() => setDraft(String(form.limit))} />
        <button type="button" aria-label="More results" disabled={disabled || form.limit >= LIMIT_MAX} onClick={() => step(1)}>+</button>
      </div>
      <span id={`${id}-range`} className="visually-hidden">{LIMIT_MIN} to {LIMIT_MAX} results</span>
    </div>
  );
}

export function SearchForm({ onError, onClose }: { onError: (message: string | null) => void; onClose?: () => void }) {
  const { form, setForm, run, start, cancel } = useSession();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const { importFile, note } = useCollectionImport(onError);
  const running = run?.status === "running";
  const count = seedLines(form.seeds).length;

  function submit() {
    const problem = start();
    onError(problem);
    if (!problem) navigate("/search");
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!running) submit();
    }
  }

  function onDrop(e: DragEvent) {
    setDropping(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    importFile(file);
  }

  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); submit(); }} onKeyDown={onKey} autoComplete="off">
      <div className="panel-head">
        <h2>{onClose ? "Edit your search" : "New search"}</h2>
        {onClose && <button type="button" className="link" onClick={onClose}>Close</button>}
      </div>
      <div className="field">
        <label className="label" htmlFor="question">Research question</label>
        <textarea id="question" rows={3} required minLength={3} value={form.question} disabled={running}
          placeholder="Which incretin-based drugs reduce body weight in adults with obesity?"
          onChange={(e) => setForm({ question: e.target.value })} />
      </div>
      <div className="field">
        <label className="label" htmlFor="seeds">
          Seed papers
          <span className={`count${count > MAX_SEEDS ? " over" : ""}`} aria-live="polite">{count ? `${count} of ${MAX_SEEDS}` : ""}</span>
        </label>
        <textarea id="seeds" rows={5} required value={form.seeds} disabled={running} aria-describedby="seeds-help"
          className={dropping ? "drop" : ""} placeholder={"33567185\nTirzepatide Once Weekly for the Treatment of Obesity"}
          onChange={(e) => setForm({ seeds: e.target.value })}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true); } }}
          onDragLeave={() => setDropping(false)} onDrop={onDrop} />
        <p className="help" id="seeds-help">One per line: a PMID, DOI, PubMed link or exact title. Preprints work too.</p>
      </div>
      <div className="import">
        <button type="button" className="btn utility sm" onClick={() => fileInput.current?.click()} disabled={running}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10.5V2.5M4.8 5.6L8 2.4l3.2 3.2M2.5 10.5v2.2c0 .5.4.8.8.8h9.4c.4 0 .8-.3.8-.8v-2.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Import a collection
        </button>
        <span className="help">RIS, BibTeX, .nbib or CSV, or drop a file on the box</span>
        <input ref={fileInput} type="file" accept=".ris,.nbib,.txt,.bib,.bibtex,.csv" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importFile(f); }} />
      </div>
      {note && <p className="note">{note}</p>}
      <div className="form-foot">
        <LimitField id="form-limit" disabled={running} />
        {running
          ? <button type="button" className="btn utility" onClick={cancel}>Cancel search</button>
          : <button type="submit" className="btn primary">Discover papers</button>}
      </div>
      <div className="form-alt">
        <button type="button" className="link" disabled={running}
          onClick={() => setForm({ question: EXAMPLE.question, seeds: EXAMPLE.seeds })}>Fill in an example</button>
        <span>Usually 1–3 minutes</span>
      </div>
    </form>
  );
}
