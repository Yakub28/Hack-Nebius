import { useEffect, useState } from "react";
import { CHANNELS, isProblem, isSeedProblem, plural } from "../lib/format";
import { STAGES, progress, runSeconds, type LiveRun as Run } from "../lib/run";
import { AlertIcon, InfoIcon } from "./Icons";

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** What the engine is doing right now, stage by stage, from the events it streams. Every number is a real
 *  count from this search. Until the first ranking arrives it is the page's main content; after that it
 *  folds into a one-line stepper so the results it is grading stay in view. */
export function LiveRun({ run }: { run: Run }) {
  const running = run.status === "running";
  const now = useNow(running);
  const [pinned, setPinned] = useState<boolean | null>(null);   // null: open or folded automatically
  useEffect(() => setPinned(null), [run.started]);
  const open = pinned ?? (running && !run.results.length);
  const active = STAGES.find((s) => run.stages[s.key].status === "active");
  const step = STAGES.filter((s) => run.stages[s.key].status === "done").length + (active ? 1 : 0);
  const status = running ? "Searching live" : run.status === "done" ? (run.restored ? "Your last search" : "Search finished")
    : run.status === "cancelled" ? "Search cancelled" : "Search failed";

  return (
    <section className={`panel live${running ? " is-running" : ""}`} aria-live="polite">
      <div className="live-head">
        <div>
          <span className="eyebrow">{running && <span className="pulse" />}{status}</span>
          <h2>{run.request.question}</h2>
        </div>
        <div className="live-clock">
          <b className="num">{runSeconds(run, now)} s</b>
          <span className="muted">{running ? "usually 1–3 min" : run.status === "done" ? "end to end" : ""}</span>
        </div>
      </div>

      {running && (
        <>
          <div className="live-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress(run, now) * 100)}>
            <i style={{ width: `${progress(run, now) * 100}%` }} />
          </div>
          <ol className="stepper" aria-label={`Step ${step} of ${STAGES.length}`}>
            {STAGES.map((s) => <li key={s.key} className={run.stages[s.key].status} title={s.label}>{s.short}</li>)}
          </ol>
          {!open && active && (
            <div className="live-now">
              <span><b>{active.label}</b> · step {step} of {STAGES.length}</span>
              <StageDetail stage={active.key} run={run} inline />
            </div>
          )}
        </>
      )}

      {open && (
        <ol className="timeline">
          {STAGES.map((s) => {
            const state = run.stages[s.key];
            return (
              <li key={s.key} className={state.status}>
                <div className="tl-row">
                  <span className="tl-label">{s.label}</span>
                  {state.seconds != null && <span className="tl-time num">{state.seconds.toFixed(1)} s</span>}
                </div>
                {state.status === "active" || (running && state.status === "done" && (s.key === "resolve" || s.key === "plan"))
                  ? <StageDetail stage={s.key} run={run} />
                  : state.status === "done" && <p className="tl-detail">{summary(s.key, run)}</p>}
              </li>
            );
          })}
        </ol>
      )}

      {running && run.warnings.length > 0 && <LiveWarnings warnings={run.warnings} />}

      {(run.status === "done" || run.results.length > 0) && (
        <button type="button" className="toggle live-toggle" aria-expanded={open} onClick={() => setPinned(!open)}>
          {open ? "Hide the steps" : "Show every step"}
        </button>
      )}
    </section>
  );
}

/** Problems as they happen, not a minute later: a seed that was not found shows here at the first stage. */
function LiveWarnings({ warnings }: { warnings: string[] }) {
  return (
    <ul className="live-warnings">
      {warnings.map((w) => (
        <li key={w} className={isProblem(w) ? "problem" : ""}>{isProblem(w) ? <AlertIcon /> : <InfoIcon />}<span>{w}</span></li>
      ))}
    </ul>
  );
}

function seedCount(run: Run): string {
  const missing = run.warnings.filter(isSeedProblem).length;
  return missing ? `${run.seeds.length} of ${run.request.seeds.length} seeds found` : plural(run.seeds.length, "seed");
}

function summary(stage: string, run: Run): string {
  const hits = run.channels.reduce((sum, c) => sum + c.found, 0);
  switch (stage) {
    case "resolve": return seedCount(run);
    case "plan": return run.plan ? `${plural(run.plan.criteria.length, "criterion", "criteria")} · ${
      plural(Object.values(run.plan.queries).flat().length, "search", "searches")}` : "";
    case "graph": return run.graph ? `${run.graph.cited_by.toLocaleString()} citing · ${run.graph.cocited.toLocaleString()} co-cited` : "";
    case "candidates": return `${plural(hits, "hit")} from ${plural(new Set(run.channels.map((c) => c.channel)).size, "channel")}${
      run.webRounds.length ? ` · ${plural(run.webRounds.filter((r) => r.searches.length).length, "web agent round")}` : ""}`;
    case "hydrate": return run.pool != null ? plural(run.pool, "candidate") : "";
    case "first_stage": return "First ranking";
    case "judge": return `${plural(run.graded, "paper")} graded`;
    case "context": return run.map ? plural(run.map.themes.length, "theme") : "";
    default: return "";
  }
}

function StageDetail({ stage, run, inline = false }: { stage: string; run: Run; inline?: boolean }) {
  switch (stage) {
    case "resolve":
      return (
        <>
          <p className="tl-detail">{seedCount(run)}</p>
          {run.seeds.length > 0 && <ul className="tl-seeds">{run.seeds.map((s) => <li key={s.id}><b>{s.label}</b> {s.title}</li>)}</ul>}
        </>
      );
    case "plan":
      return run.plan ? (
        <>
          <p className="tl-detail">{plural(run.plan.queries.pubmed_queries.length, "PubMed search", "PubMed searches")} ·{" "}
            {plural(run.plan.queries.preprint_queries.length, "preprint search", "preprint searches")} ·{" "}
            {plural(run.plan.queries.web_queries.length, "web search", "web searches")}, and every result will be graded against:</p>
          <ul className="tl-criteria">{run.plan.criteria.map((c) => <li key={c}>{c}</li>)}</ul>
        </>
      ) : <p className="tl-detail">The LLM is reading your seeds' abstracts to draft the criteria and searches.</p>;
    case "graph":
      return run.graph ? (
        <p className="tl-detail">{plural(run.graph.cited_by, "paper")} cite the seeds · they cite {run.graph.cites.toLocaleString()} ·{" "}
          {run.graph.cocited.toLocaleString()} co-cited with them</p>
      ) : null;
    case "candidates": {
      const totals = new Map<string, number>();
      run.channels.forEach((c) => totals.set(c.channel, (totals.get(c.channel) ?? 0) + c.found));
      if (inline) return <span className="muted">{plural([...totals.values()].reduce((a, b) => a + b, 0), "hit")} so far</span>;
      return (
        <>
          <div className="tl-chips">
            {[...totals].map(([channel, n]) => (
              <span key={channel} className="chip pop" title={CHANNELS[channel]?.[1]}>
                {CHANNELS[channel]?.[0] ?? channel} <b className="num">{n.toLocaleString()}</b>
              </span>
            ))}
          </div>
          {run.webRounds.map((r) => (
            <div key={r.round} className="tl-round pop">
              <span className="eyebrow">Web agent · round {r.round}</span>
              {r.searches.length ? <ul>{r.searches.map((q) => <li key={q}>{q}</li>)}</ul> : null}
              {r.why && <p className="muted">{r.why}</p>}
              {r.searches.length > 0 && <p className="muted">{r.pages} pages read · {r.papers} tied to a paper record</p>}
            </div>
          ))}
        </>
      );
    }
    case "hydrate":
      return run.pool != null ? <p className="tl-detail">{plural(run.pool, "candidate")} with full records</p> : null;
    case "first_stage":
      return <p className="tl-detail">Embedding every candidate and fusing the signals into a first ranking.</p>;
    case "judge": {
      const bar = run.judge ? (
        <span className="tl-progress">
          <span className="meter-bar"><i style={{ width: `${(run.judge.done / run.judge.total) * 100}%` }} /></span>
          <span className="num">{plural(run.graded, "paper")} graded · batch {run.judge.done} of {run.judge.total}</span>
        </span>
      ) : <span className="tl-detail">Reading the first abstracts…</span>;
      return inline ? bar : <div>{bar}</div>;
    }
    case "context":
      return <p className="tl-detail">{run.map ? `${plural(run.map.themes.length, "theme")} on the map` : "Looking for trials, commentary and news"}</p>;
    default:
      return null;
  }
}
