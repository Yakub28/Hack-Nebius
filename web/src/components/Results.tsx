import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Discovery } from "../api/types";
import { CHANNELS, GRADES, plural } from "../lib/format";
import { exportCsv, exportRis } from "../lib/export";
import { CitationGraph } from "./CitationGraph";
import { PaperDrawer } from "./PaperDrawer";
import { ResultList } from "./ResultList";
import { ResultsMap } from "./ResultsMap";
import { ThemeDot, themeName } from "./ResultCard";
import { useToast } from "./Toast";

const VIEWS = [
  { id: "list", label: "List" },
  { id: "map", label: "Map" },
  { id: "graph", label: "Graph" },
] as const;
type View = (typeof VIEWS)[number]["id"];

/** Ranked results with filters and three views. The view and the open paper live in the URL, so a view is
 *  reloadable and shareable; the filters are this page's own. */
export function Results({ data, live }: { data: Discovery; live: boolean }) {
  const [params, setParams] = useSearchParams();
  const view: View = VIEWS.some((v) => v.id === params.get("view")) ? (params.get("view") as View) : "list";
  const open = params.get("paper");
  const toast = useToast();

  const [text, setText] = useState("");
  const [sort, setSort] = useState<"relevance" | "newest" | "cited">("relevance");
  const [onlyRelevant, setOnlyRelevant] = useState(false);
  const [channels, setChannels] = useState<Set<string>>(new Set());
  const [themes, setThemes] = useState<Set<number>>(new Set());

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null) next.delete(key); else next.set(key, value);
    setParams(next, { replace: key === "paper" && params.has("paper") });
  };
  const openPaper = (id: string) => setParam("paper", id);
  const hasMap = !!data.map && !live;

  const list = useMemo(() => {
    const q = text.trim().toLowerCase();
    const out = data.results.filter((r) => {
      if (onlyRelevant && !r.likely_relevant) return false;
      if (channels.size && !r.channels.some((c) => channels.has(c))) return false;
      if (themes.size && (r.theme == null || !themes.has(r.theme))) return false;
      return !q || [r.title, r.venue, r.authors.join(" "), r.abstract].join(" ").toLowerCase().includes(q);
    });
    if (sort === "newest") out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    if (sort === "cited") out.sort((a, b) => (b.citations ?? 0) - (a.citations ?? 0));
    return out;
  }, [data.results, text, sort, onlyRelevant, channels, themes]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    data.results.forEach((r) => r.channels.forEach((ch) => { c[ch] = (c[ch] ?? 0) + 1; }));
    return c;
  }, [data.results]);

  const clear = () => { setText(""); setOnlyRelevant(false); setChannels(new Set()); setThemes(new Set()); };
  const toggle = <T,>(set: Set<T>, value: T) => { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next; };
  const openResult = open ? data.results.find((r) => r.id === open) ?? null : null;
  const relevant = data.results.filter((r) => r.likely_relevant).length;
  const total = Object.values(data.timings).reduce((a, b) => a + b, 0);

  return (
    <div className={openResult ? "with-drawer" : ""}>
      <div className="stats">
        <span><b>{data.results.length}</b> {live ? "ranked so far" : "results"}</span>
        {data.cutoff != null && <span><b>{relevant}</b> likely relevant</span>}
        {data.stats.pool != null && <span><b>{data.stats.pool.toLocaleString()}</b> candidates screened</span>}
        {data.stats.judged != null && <span><b>{data.stats.judged}</b> graded by the LLM</span>}
        {!live && total > 0 && <span><b>{Math.round(total)} s</b> end to end</span>}
        <span className="spacer" />
        <span className="export" role="group" aria-label="Export the visible results">
          <button type="button" className="btn utility sm" title="Export the visible results as RIS, for Zotero, EndNote or Mendeley"
            onClick={() => { exportRis(list); toast(`Exported ${plural(list.length, "paper")} as RIS, ready for Zotero, EndNote or Mendeley.`); }}>
            <DownloadIcon />RIS</button>
          <button type="button" className="btn utility sm" title="Export the visible results as CSV, for spreadsheets"
            onClick={() => { exportCsv(list, (id) => themeName(data, id)); toast(`Exported ${plural(list.length, "paper")} as CSV.`); }}>
            <DownloadIcon />CSV</button>
        </span>
      </div>
      {data.warnings.length > 0 && (
        <details className="warnings">
          <summary>{plural(data.warnings.length, "warning")}: some sources were incomplete</summary>
          <ul>{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}

      <div className="toolbar">
        <div className="view-switch" role="tablist" aria-label="View">
          {VIEWS.map((v) => {
            const disabled = v.id !== "list" && !hasMap;
            return (
              <button key={v.id} type="button" role="tab" aria-selected={view === v.id} aria-pressed={view === v.id}
                disabled={disabled} title={disabled ? (live ? "Available when the search finishes" : "Too few results") : undefined}
                onClick={() => setParam("view", v.id === "list" ? null : v.id)}>{v.label}</button>
            );
          })}
        </div>
        <input type="search" placeholder="Filter results…" aria-label="Filter results" value={text}
          title="Matches title, authors, venue and abstract" onChange={(e) => setText(e.target.value)} />
        <select aria-label="Sort results" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="relevance">Relevance</option>
          <option value="newest">Newest</option>
          <option value="cited">Most cited</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={onlyRelevant} onChange={(e) => setOnlyRelevant(e.target.checked)} /> Likely relevant only
        </label>
      </div>

      <div className="chip-filter">
        <span className="row-label eyebrow">Found via</span>
        <div className="pills">
          {Object.keys(CHANNELS).filter((c) => counts[c]).map((c) => (
            <button key={c} type="button" aria-pressed={channels.has(c)} title={CHANNELS[c][1]}
              onClick={() => setChannels(toggle(channels, c))}>{CHANNELS[c][0]}<span className="n">{counts[c]}</span></button>
          ))}
        </div>
      </div>
      {data.map && data.map.themes.length > 0 && !live && (
        <div className="chip-filter">
          <span className="row-label eyebrow">Themes</span>
          <div className="pills">
            {data.map.themes.map((t) => (
              <button key={t.id} type="button" aria-pressed={themes.has(t.id)} title={`Named by ${t.named_by === "llm" ? "the LLM" : t.named_by}`}
                onClick={() => setThemes(toggle(themes, t.id))}><ThemeDot id={t.id} />{t.name}<span className="n">{t.size}</span></button>
            ))}
          </div>
        </div>
      )}

      {live && <p className="live-note"><span className="pulse" /> Live: grades arrive in batches and the list re-ranks as they do.</p>}

      {view === "map" && hasMap ? <ResultsMap data={data} list={list} selected={open} onOpen={openPaper} />
        : view === "graph" && hasMap ? <CitationGraph data={data} list={list} selected={open} onOpen={openPaper} />
          : <ResultList list={list} data={data} live={live} byRelevance={sort === "relevance" && !live}
              selected={open} onOpen={openPaper} onClear={clear} />}

      {openResult && (
        <PaperDrawer paper={openResult} data={data} list={list} live={live} onOpen={openPaper} onClose={() => setParam("paper", null)} />
      )}
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v8M4.8 7.4L8 10.6l3.2-3.2M2.5 10.5v2.2c0 .5.4.8.8.8h9.4c.4 0 .8-.3.8-.8v-2.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
}

export function SeedsPanel({ data }: { data: Discovery }) {
  const groups: [keyof Discovery["queries"], string][] = [["pubmed_queries", "PubMed"], ["preprint_queries", "Preprints"]];
  if (!data.web_trail.length) groups.push(["web_queries", "Web"]);
  return (
    <section className="panel">
      <div className="panel-head"><h2>Your seeds</h2></div>
      <ul className="seeds">
        {data.seeds.map((s) => (
          <li key={s.id}>
            <span className="lbl">{s.label}</span>
            <a className="t" href={s.links.pubmed || s.links.doi || s.links.europepmc} target="_blank" rel="noopener" title={s.title}>{s.title}</a>
            {s.grade == null ? <span className="chip">{data.results.length ? "grading…" : ""}</span>
              : <span className={`chip${s.grade >= 3 ? " ok" : ""}`}>{s.grade} · {GRADES[s.grade]}</span>}
          </li>
        ))}
      </ul>
      {data.cutoff != null && (
        <p className="note">Your seeds were graded under the same prompt; the weakest got {data.cutoff}. Results at or above that are marked likely relevant.</p>
      )}
      {data.criteria.length > 0 && (
        <details className="more">
          <summary>Inclusion criteria</summary>
          <ul className="criteria">{data.criteria.map((c) => <li key={c}>{c}</li>)}</ul>
        </details>
      )}
      {(data.queries.pubmed_queries.length > 0 || data.web_trail.length > 0) && (
        <details className="more">
          <summary>Search queries</summary>
          {groups.filter(([k]) => data.queries[k].length).map(([k, title]) => (
            <div key={k} className="qgroup"><h3 className="eyebrow">{title}</h3>{data.queries[k].map((q) => <code key={q}>{q}</code>)}</div>
          ))}
          {data.web_trail.map((t) => (
            <div key={t.round} className="qgroup">
              <h3 className="eyebrow">Web agent · round {t.round}</h3>
              {t.searches.map((q) => <code key={q}>{q}</code>)}
              {t.why && <p className="qwhy">{t.why}</p>}
              {t.searches.length > 0 && <p className="qwhy">{t.pages} pages read · {t.papers} tied to a paper record</p>}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
