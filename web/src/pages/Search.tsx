import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { Discovery } from "../api/types";
import { ActionBar } from "../components/ActionBar";
import { LiveRun } from "../components/LiveRun";
import { QueryPanel } from "../components/QueryPanel";
import { Results } from "../components/Results";
import { EXAMPLE, SearchForm } from "../components/SearchForm";
import { SearchHero } from "../components/SearchHero";
import { useToast } from "../components/Toast";
import { CHANNELS, refOf, seedLines } from "../lib/format";
import { asDiscovery } from "../lib/run";
import { useSession } from "../lib/session";

function useNarrow(): boolean {
  const query = "(max-width: 960px)";
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const update = () => setNarrow(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  return narrow;
}

/** The workspace: on the left the search (the form, or once a search exists, what the engine made of it); on
 *  the right the live run, then its results. `recorded` shows the saved run instead, so the page works
 *  without a key and opens instantly. */
export function Search({ recorded = false }: { recorded?: boolean }) {
  const { run, form, setForm, setShown, start, cancel, interrupted, dismissInterrupted } = useSession();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Discovery | null>(null);
  const [editing, setEditing] = useState(false);
  const narrow = useNarrow();
  useEffect(() => setEditing(false), [run?.started]);

  useEffect(() => {
    if (!recorded) return;
    let alive = true;
    api.recorded()
      .then((d) => {
        if (!alive) return;
        setSaved(d);
        // An empty form takes the recorded run's question and seeds, so "Add as seed" and a re-run just work.
        if (!form.question.trim() && !seedLines(form.seeds).length) {
          setForm({ question: d.question, seeds: d.seeds.map(refOf).join("\n") });
        }
      })
      .catch((e: Error) => alive && setError(`Could not load the recorded run: ${e.message}`));
    return () => { alive = false; };
  }, [recorded]);   // once per visit: the form check reads the form as it was on arrival, on purpose

  useEffect(() => { if (run?.status === "error") setError(run.error ?? "The search failed."); }, [run?.status, run?.error]);
  useEffect(() => { document.title = recorded ? "Recorded run · Paper Discovery" : "Search · Paper Discovery"; }, [recorded]);

  const data = recorded ? saved : run ? asDiscovery(run) : null;
  const live = !recorded && run?.status === "running";
  const hasResults = !!data && data.results.length > 0;
  useEffect(() => setShown(hasResults ? data : null));

  // What the results on screen were searched with: the baseline for "run again".
  const baseline = recorded
    ? saved && { question: saved.question, seeds: saved.seeds.map(refOf) }
    : run && { question: run.request.question, seeds: run.request.seeds };
  const settled = !!data && (recorded || run?.status === "running" || run?.status === "done");
  const showQuery = settled && !editing;
  const paper = params.get("paper");
  const drawerOpen = hasResults && !!paper && data!.results.some((r) => r.id === paper);
  const query = (compact: boolean) => (
    <QueryPanel data={data} question={baseline?.question ?? form.question} seedRefs={baseline?.seeds ?? []} running={live}
      compact={compact} onEdit={() => setEditing(true)} onCancel={cancel} />
  );

  // Before any search the page is the search: one centred task on the night band, like the overview's hero.
  if (!recorded && !run && !interrupted) {
    return (
      <section className="search-band">
        {error && <div className="alert band-alert" role="alert">{error}</div>}
        <SearchHero onError={setError} />
      </section>
    );
  }

  return (
    <div className={`page workspace${drawerOpen ? " drawer-open" : ""}`}>
      <div className="layout">
        <aside className="side">
          {showQuery ? query(narrow) : <SearchForm onError={setError} onClose={settled ? () => setEditing(false) : undefined} />}
        </aside>
        <main className="main" id="main">
          {error && <div className="alert" role="alert">{error}</div>}
          {interrupted && !live && !recorded && (
            <div className="callout">
              <span className="badge">Interrupted</span>
              <span className="callout-text">The page reloaded while “{interrupted.question}” was running, so the search stopped.</span>
              <button type="button" className="btn primary sm" onClick={() => {
                setError(start({ question: interrupted.question, seeds: interrupted.seeds.join("\n"), limit: interrupted.limit }));
              }}>Run it again</button>
              <button type="button" className="link" onClick={dismissInterrupted}>Dismiss</button>
            </div>
          )}
          {recorded && saved && (
            <div className="callout">
              <span className="badge">Recorded run</span>
              <span className="callout-text">Real engine output from {saved.recorded}, saved so it opens instantly and without an API key.
                Keep papers, add any as a seed, and run it live.</span>
            </div>
          )}
          {!recorded && run && <LiveRun run={run} />}
          {hasResults ? <Results data={data!} live={live} previous={recorded ? undefined : run?.previous} />
            : recorded ? (saved ? null : <ResultsSkeleton />)
              : run ? (run.status === "running" ? <ResultsSkeleton note="The first ranking appears in about a minute; then grades stream in and the list re-ranks." /> : null)
                : <Empty />}
          {narrow && hasResults && showQuery && <div className="after-results">{query(false)}</div>}
        </main>
      </div>
      {hasResults && baseline && <ActionBar baseline={baseline} running={live} />}
    </div>
  );
}

function ResultsSkeleton({ note }: { note?: string }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {note && <p className="note">{note}</p>}
      {[0, 1, 2].map((i) => (
        <div key={i} className="card skeleton-card">
          <div className="sk sk-grade" />
          <div><div className="sk" style={{ width: "72%", height: 16 }} /><div className="sk" style={{ width: "40%" }} /><div className="sk" /><div className="sk" style={{ width: "88%" }} /></div>
        </div>
      ))}
    </div>
  );
}

function Empty() {
  const { setForm } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <section className="empty">
      <svg className="empty-art" viewBox="0 0 220 110" aria-hidden="true">
        <path d="M40 62L82 30L128 54L176 26M82 30L96 84L128 54L160 88M40 62L96 84" stroke="var(--ink)" strokeOpacity=".18" strokeWidth="1.5" fill="none" />
        <circle cx="40" cy="62" r="9" fill="var(--ink)" /><circle cx="128" cy="54" r="9" fill="var(--ink)" />
        <circle cx="82" cy="30" r="7" fill="#2a9d99" /><circle cx="96" cy="84" r="8" fill="#dd5b00" />
        <circle cx="176" cy="26" r="6" fill="#62aef0" /><circle cx="160" cy="88" r="7" fill="#ff64c8" />
        <circle cx="196" cy="62" r="5" fill="#1aae39" />
        <path d="M176 26L196 62L160 88" stroke="var(--ink)" strokeOpacity=".18" strokeWidth="1.5" fill="none" strokeDasharray="3 4" />
      </svg>
      <h2>Start from papers you already trust</h2>
      <p className="empty-sub">Enter a question and a few seed papers. You will watch the engine work: it follows their
        citations, searches PubMed, preprints and the web, then an LLM grades every strong candidate, live.</p>
      <div className="empty-actions">
        <button type="button" className="btn primary" onClick={() => {
          setForm({ question: EXAMPLE.question, seeds: EXAMPLE.seeds });
          toast("Example filled in. Press Discover papers to run it.");
        }}>Try an example</button>
        <button type="button" className="btn secondary" onClick={() => navigate("/recorded")}>Open a recorded run</button>
      </div>
      <p className="eyebrow">Seven ways it finds candidates</p>
      <div className="channels-legend">
        {Object.values(CHANNELS).map(([name, desc]) => <span key={name} className="chip" title={desc}>{name}</span>)}
      </div>
    </section>
  );
}
