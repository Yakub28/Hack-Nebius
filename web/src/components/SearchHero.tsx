import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CHANNELS, IS_MAC, MAX_SEEDS, seedLines } from "../lib/format";
import { useSession } from "../lib/session";
import { EXAMPLE, useCollectionImport } from "./SearchForm";

/** What a seed chip shows: the kind of reference, then the reference itself. */
function chipLabel(ref: string): [string, string] {
  if (/^\d+$/.test(ref)) return ["PMID", ref];
  const pubmed = ref.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
  if (pubmed) return ["PMID", pubmed[1]];
  const doi = ref.match(/10\.\d{4,9}\/\S+/);
  if (doi) return ["DOI", doi[0]];
  return ["Title", ref];
}

/** The search page before a search: one centred task. The question, the seeds as chips, one action. */
export function SearchHero({ onError }: { onError: (message: string | null) => void }) {
  const { form, setForm, start } = useSession();
  const navigate = useNavigate();
  const { importFile, note } = useCollectionImport(onError);
  const fileInput = useRef<HTMLInputElement>(null);
  const question = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [dropping, setDropping] = useState(false);
  const seeds = seedLines(form.seeds);

  // The question box grows with its text instead of scrolling inside itself.
  useEffect(() => {
    const el = question.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [form.question]);

  useEffect(() => { question.current?.focus(); }, []);

  function add(text: string) {
    const lines = seedLines(text);
    if (!lines.length) return;
    const known = new Set(seeds.map((s) => s.toLowerCase()));
    setForm({ seeds: [...seeds, ...lines.filter((l) => !known.has(l.toLowerCase()))].join("\n") });
    setDraft("");
  }

  function remove(i: number) {
    setForm({ seeds: seeds.filter((_, j) => j !== i).join("\n") });
  }

  function submit() {
    // A seed still being typed counts: nobody should have to press Enter before Discover.
    const pending = seedLines(draft);
    setDraft("");
    const problem = start(pending.length ? { seeds: [...seeds, ...pending].join("\n") } : undefined);
    onError(problem);
    if (!problem) navigate("/search");
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  function onSeedKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && seeds.length) {
      remove(seeds.length - 1);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (text.includes("\n")) {
      e.preventDefault();
      add(text);
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
    <div className="hero-search" onKeyDown={onKey}>
      <span className="eyebrow">TUMor</span>
      <h1>Find the papers your seeds point to</h1>
      <p className="hero-sub">Ask a question, add the papers you already trust, and watch new ones arrive, ranked, each with a verified quote.</p>

      <form className={`search-card${dropping ? " drop" : ""}`} autoComplete="off"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false); }}
        onDrop={onDrop}>
        <label className="visually-hidden" htmlFor="hero-question">Research question</label>
        <textarea id="hero-question" ref={question} rows={1} className="hero-question" value={form.question}
          placeholder="What is your research question?"
          onChange={(e) => setForm({ question: e.target.value })} />

        <div className="hs-seeds">
          <div className="hs-head">
            <label htmlFor="hero-seed">Seed papers</label>
            <span className={`count${seeds.length > MAX_SEEDS ? " over" : ""}`}>{seeds.length ? `${seeds.length} of ${MAX_SEEDS}` : "PMID, DOI, PubMed link or exact title"}</span>
          </div>
          <div className="hs-chips" onClick={() => document.getElementById("hero-seed")?.focus()}>
            {seeds.map((ref, i) => {
              const [kind, text] = chipLabel(ref);
              return (
                <span key={`${ref}-${i}`} className="hs-chip" title={ref}>
                  <span className="kind">{kind}</span><span className="txt">{text}</span>
                  <button type="button" aria-label={`Remove ${ref}`} onClick={(e) => { e.stopPropagation(); remove(i); }}>×</button>
                </span>
              );
            })}
            <input id="hero-seed" value={draft} placeholder={seeds.length ? "Add another…" : "Paste or type a seed, then press Enter"}
              onChange={(e) => setDraft(e.target.value)} onKeyDown={onSeedKey} onPaste={onPaste} onBlur={() => add(draft)} />
          </div>
        </div>

        <div className="search-actions">
          <button type="button" className="btn utility sm" onClick={() => fileInput.current?.click()}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10.5V2.5M4.8 5.6L8 2.4l3.2 3.2M2.5 10.5v2.2c0 .5.4.8.8.8h9.4c.4 0 .8-.3.8-.8v-2.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Import a collection
          </button>
          <input ref={fileInput} type="file" accept=".ris,.nbib,.txt,.bib,.bibtex,.csv" hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importFile(f); }} />
          <select aria-label="Number of results" value={form.limit} onChange={(e) => setForm({ limit: Number(e.target.value) })}>
            <option value={20}>Top 20</option>
            <option value={50}>Top 50</option>
            <option value={100}>Top 100</option>
          </select>
          <span className="spacer" />
          <span className="hint"><kbd>{IS_MAC ? "⌘" : "Ctrl"}</kbd> <kbd>Enter</kbd></span>
          <button type="submit" className="btn primary">Discover papers</button>
        </div>
        {dropping && <div className="drop-hint">Drop a RIS, BibTeX, .nbib or CSV file to import its papers as seeds</div>}
      </form>
      {note && <p className="note hero-note">{note}</p>}

      <div className="hero-alt">
        <button type="button" className="link" onClick={() => setForm({ question: EXAMPLE.question, seeds: EXAMPLE.seeds })}>Try an example</button>
        <span aria-hidden="true">·</span>
        <button type="button" className="link" onClick={() => navigate("/recorded")}>Open a recorded run</button>
        <span aria-hidden="true">·</span>
        <span>About 2 minutes, streamed live</span>
      </div>
      <div className="channels-legend hero-channels">
        {Object.values(CHANNELS).map(([name, desc]) => <span key={name} className="chip" title={desc}>{name}</span>)}
      </div>
    </div>
  );
}
