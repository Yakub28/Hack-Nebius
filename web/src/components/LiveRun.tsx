import { useEffect, useState } from "react";
import { CHANNELS, plural } from "../lib/format";
import { STAGES, TYPICAL_SECONDS, type LiveRun as Run } from "../lib/run";

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** What the engine is doing right now, stage by stage, from the events it streams. Every number here is a
 *  real count from this search, not an estimate. */
export function LiveRun({ run }: { run: Run }) {
  const running = run.status === "running";
  const now = useNow(running);
  const elapsed = Math.floor(((run.finished ?? now) - run.started) / 1000);
  const [open, setOpen] = useState(true);
  useEffect(() => { if (run.status === "done") setOpen(false); }, [run.status]);

  return (
    <section className={`panel live${running ? " is-running" : ""}`} aria-live="polite">
      <div className="live-head">
        <div>
          <span className="eyebrow">{running ? "Searching live" : run.status === "done" ? "Search finished" : run.status === "cancelled" ? "Search cancelled" : "Search failed"}</span>
          <h2>{run.request.question}</h2>
        </div>
        <div className="live-clock">
          <b className="num">{elapsed} s</b>
          <span className="muted">{running ? `of about ${Math.round(TYPICAL_SECONDS / 10) * 10} s` : "end to end"}</span>
          <button type="button" className="toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide steps" : "Show steps"}
          </button>
        </div>
      </div>
      {running && <div className="live-bar"><i style={{ width: `${Math.min(100, (elapsed / TYPICAL_SECONDS) * 100)}%` }} /></div>}
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
                {/* Once the first ranking is on screen, finished stages fold to one line so the cards stay in view. */}
                {state.status === "active" || (state.status === "done" && !run.results.length)
                  ? <StageDetail stage={s.key} run={run} />
                  : state.status === "done" && <p className="tl-detail">{summary(s.key, run)}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function summary(stage: string, run: Run): string {
  const hits = run.channels.reduce((sum, c) => sum + c.found, 0);
  switch (stage) {
    case "resolve": return plural(run.seeds.length, "seed");
    case "plan": return run.plan ? `${plural(run.plan.criteria.length, "criterion", "criteria")} · ${
      plural(Object.values(run.plan.queries).flat().length, "search", "searches")}` : "";
    case "graph": return run.graph ? `${run.graph.cited_by.toLocaleString()} citing · ${run.graph.cocited.toLocaleString()} co-cited` : "";
    case "candidates": return `${plural(hits, "hit")} from ${plural(new Set(run.channels.map((c) => c.channel)).size, "channel")}${
      run.webRounds.length ? ` · ${plural(run.webRounds.filter((r) => r.searches.length).length, "web agent round")}` : ""}`;
    case "hydrate": return run.pool != null ? plural(run.pool, "candidate") : "";
    case "first_stage": return "First ranking below";
    case "judge": return `${plural(run.graded, "paper")} graded`;
    case "context": return run.map ? plural(run.map.themes.length, "theme") : "";
    default: return "";
  }
}

function StageDetail({ stage, run }: { stage: string; run: Run }) {
  switch (stage) {
    case "resolve":
      return run.seeds.length ? (
        <ul className="tl-seeds">{run.seeds.map((s) => <li key={s.id}><b>{s.label}</b> {s.title}</li>)}</ul>
      ) : null;
    case "plan":
      return run.plan ? (
        <p className="tl-detail">{plural(run.plan.criteria.length, "criterion", "criteria")} ·{" "}
          {plural(run.plan.queries.pubmed_queries.length, "PubMed search", "PubMed searches")} ·{" "}
          {plural(run.plan.queries.preprint_queries.length, "preprint search", "preprint searches")} ·{" "}
          {plural(run.plan.queries.web_queries.length, "web search", "web searches")}</p>
      ) : null;
    case "graph":
      return run.graph ? (
        <p className="tl-detail">{plural(run.graph.cited_by, "paper")} cite the seeds · they cite {run.graph.cites.toLocaleString()} ·{" "}
          {run.graph.cocited.toLocaleString()} co-cited with them</p>
      ) : null;
    case "candidates": {
      const totals = new Map<string, number>();
      run.channels.forEach((c) => totals.set(c.channel, (totals.get(c.channel) ?? 0) + c.found));
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
              {r.searches.length
                ? <p>{r.searches.map((q) => <code key={q}>{q}</code>)}</p>
                : null}
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
      return run.results.length ? <p className="tl-detail">A first ranking is below. Grades replace it as the LLM reads.</p> : null;
    case "judge":
      return run.judge ? (
        <div className="tl-progress">
          <div className="meter-bar"><i style={{ width: `${(run.judge.done / run.judge.total) * 100}%` }} /></div>
          <span className="num">{plural(run.graded, "paper")} graded · batch {run.judge.done} of {run.judge.total}</span>
        </div>
      ) : <p className="tl-detail">Reading the first abstracts…</p>;
    case "context":
      return <p className="tl-detail">{run.map ? `${plural(run.map.themes.length, "theme")} on the map` : "Looking for trials, commentary and news"}</p>;
    default:
      return null;
  }
}
