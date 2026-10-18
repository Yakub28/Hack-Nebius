import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Discovery, Result } from "../api/types";
import { CHANNELS, isProblem, plural } from "../lib/format";
import { exportCsv, exportRis } from "../lib/export";
import { useSession } from "../lib/session";
import { CitationGraph } from "./CitationGraph";
import { AlertIcon, DownloadIcon, FilterIcon, InfoIcon, SearchIcon, XIcon } from "./Icons";
import { Menu } from "./Menu";
import { PaperDrawer } from "./PaperDrawer";
import { ResultList } from "./ResultList";
import { ResultsMap } from "./ResultsMap";
import { ThemeDot, themeName, useSeedAction } from "./ResultCard";
import { useToast } from "./Toast";

const VIEWS = [
  { id: "list", label: "List" },
  { id: "map", label: "Map" },
  { id: "graph", label: "Graph" },
] as const;
type View = (typeof VIEWS)[number]["id"];

/** Ranked results with filters, three views and keyboard triage. The view and the open paper live in the
 *  URL, so a view is reloadable and shareable; the filters are this page's own. */
export function Results({ data, live, previous }: { data: Discovery; live: boolean; previous?: string[] }) {
  const [params, setParams] = useSearchParams();
  const view: View = VIEWS.some((v) => v.id === params.get("view")) ? (params.get("view") as View) : "list";
  const open = params.get("paper");
  const toast = useToast();
  const { kept, toggleKeep, dismissed, toggleDismiss } = useSession();
  const seedAction = useSeedAction();

  const [text, setText] = useState("");
  const [sort, setSort] = useState<"relevance" | "newest" | "cited">("relevance");
  const [onlyRelevant, setOnlyRelevant] = useState(false);
  const [hideKnown, setHideKnown] = useState(false);
  const [showSetAside, setShowSetAside] = useState(false);
  const [channels, setChannels] = useState<Set<string>>(new Set());
  const [themes, setThemes] = useState<Set<number>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null) next.delete(key); else next.set(key, value);
    setParams(next, { replace: key === "paper" && params.has("paper") });
  };
  const openPaper = (id: string) => { setCursor(id); setParam("paper", id); };
  const hasMap = !!data.map && !live;

  const setAside = data.results.filter((r) => dismissed.has(r.id)).length;
  const known = data.results.filter((r) => r.cited_by_seeds.length > 0).length;
  const list = useMemo(() => {
    const q = text.trim().toLowerCase();
    const out = data.results.filter((r) => {
      if (!showSetAside && dismissed.has(r.id)) return false;
      if (onlyRelevant && !r.likely_relevant) return false;
      if (hideKnown && r.cited_by_seeds.length > 0) return false;
      if (channels.size && !r.channels.some((c) => channels.has(c))) return false;
      if (themes.size && (r.theme == null || !themes.has(r.theme))) return false;
      return !q || [r.title, r.venue, r.authors.join(" "), r.abstract].join(" ").toLowerCase().includes(q);
    });
    if (sort === "newest") out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    if (sort === "cited") out.sort((a, b) => (b.citations ?? 0) - (a.citations ?? 0));
    return out;
  }, [data.results, text, sort, onlyRelevant, hideKnown, showSetAside, dismissed, channels, themes]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    data.results.forEach((r) => r.channels.forEach((ch) => { c[ch] = (c[ch] ?? 0) + 1; }));
    return c;
  }, [data.results]);

  // "New" only means something against a related earlier search: one that shares at least one result.
  const prev = useMemo(() => new Set(previous ?? []), [previous]);
  const overlap = data.results.some((r) => prev.has(r.id));
  const isNew = (id: string) => overlap && !prev.has(id);
  const fresh = overlap ? data.results.filter((r) => !prev.has(r.id)).length : 0;

  const relevant = data.results.filter((r) => r.likely_relevant).length;
  const allRelevant = data.cutoff != null && relevant === data.results.length;
  const total = Math.round(Object.values(data.timings).reduce((a, b) => a + b, 0));
  const active = channels.size + themes.size + (onlyRelevant ? 1 : 0) + (hideKnown ? 1 : 0) + (showSetAside ? 1 : 0);
  const clear = () => { setText(""); setOnlyRelevant(false); setHideKnown(false); setShowSetAside(false); setChannels(new Set()); setThemes(new Set()); };
  const toggle = <T,>(set: Set<T>, value: T) => { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next; };
  const openResult = open ? data.results.find((r) => r.id === open) ?? null : null;
  const keptList = Object.values(kept);
  const themeOf = (r: Result) => (data.results.some((x) => x.id === r.id) ? themeName(data, r.theme) : "");

  useEffect(() => { if (open) setCursor(open); }, [open]);

  // Triage from the keyboard: J/K move, Enter opens, S keeps, X sets aside, A adds as a seed, Esc closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable], details[open]")) return;
      const index = cursor ? list.findIndex((r) => r.id === cursor) : -1;
      const at = index >= 0 ? list[index] : null;
      const move = (step: number) => {
        const next = list[Math.max(0, Math.min(list.length - 1, index + step))];
        if (!next) return;
        if (openResult) openPaper(next.id); else setCursor(next.id);
      };
      switch (e.key) {
        case "j": move(index < 0 ? 0 : 1); break;
        case "k": move(index < 0 ? 0 : -1); break;
        case "Enter": case "o":
          if (!at || (e.key === "Enter" && target.closest("a, button"))) return;
          openPaper(at.id); break;
        case "s": if (!at) return; toggleKeep(at); break;
        case "x":
          if (!at) return;
          toggleDismiss(at.id);
          // A paper set aside leaves the list: the cursor moves on to the next one.
          if (!dismissed.has(at.id) && !showSetAside) setCursor(list[index + 1]?.id ?? list[index - 1]?.id ?? null);
          break;
        case "a": if (!at) return; seedAction(at); break;
        case "Escape": if (!openResult) return; setParam("paper", null); break;
        default: return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const problems = data.warnings.filter(isProblem);
  const notes = data.warnings.filter((w) => !isProblem(w));

  return (
    <div className="results">
      <div className="summary">
        <p>
          <b>{data.results.length}</b> {live ? "ranked so far" : "results"}
          {data.cutoff != null && (allRelevant
            ? <span className="ok-text"> · all as relevant as your seeds</span>
            : <> · <b>{relevant}</b> as relevant as your seeds</>)}
          {data.stats.pool != null && <> · <b>{data.stats.pool.toLocaleString()}</b> screened</>}
          {data.stats.judged != null && <> · <b>{data.stats.judged}</b> graded</>}
          {!live && total > 0 && <> · <b>{total} s</b></>}
          {fresh > 0 && <> · <span className="badge new">{fresh} new</span> since your last search</>}
        </p>
        <span className="kbd-hint" title="J/K move · Enter opens · S keeps · X sets aside · A adds as a seed">
          <kbd>J</kbd><kbd>K</kbd> move · <kbd>S</kbd> keep · <kbd>X</kbd> set aside · <kbd>A</kbd> seed
        </span>
      </div>

      {problems.length > 0 && (
        <details className="notice problem">
          <summary><AlertIcon />{plural(problems.length, "source problem")}: some results may be missing</summary>
          <ul>{problems.map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}
      {notes.length > 0 && (
        <details className="notice">
          <summary><InfoIcon />{plural(notes.length, "note")} about this search</summary>
          <ul>{notes.map((w) => <li key={w}>{w}</li>)}</ul>
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
        <label className="search-box">
          <SearchIcon />
          <input type="search" placeholder="Filter by title, author, journal…" aria-label="Filter results" value={text}
            onChange={(e) => setText(e.target.value)} />
        </label>
        <select aria-label="Sort results" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="relevance">Relevance</option>
          <option value="newest">Newest</option>
          <option value="cited">Most cited</option>
        </select>
        <Menu label="Filters" icon={<FilterIcon />} badge={active} align="right">
          <h4 className="eyebrow">Found via</h4>
          <div className="pills">
            {Object.keys(CHANNELS).filter((c) => counts[c]).map((c) => (
              <button key={c} type="button" className="pill" aria-pressed={channels.has(c)} title={CHANNELS[c][1]}
                onClick={() => setChannels(toggle(channels, c))}>{CHANNELS[c][0]}<span className="n">{counts[c]}</span></button>
            ))}
          </div>
          {data.map && data.map.themes.length > 0 && !live && (
            <>
              <h4 className="eyebrow">Themes</h4>
              <div className="pills">
                {data.map.themes.map((t) => (
                  <button key={t.id} type="button" className="pill" aria-pressed={themes.has(t.id)} title={`Named by ${t.named_by === "llm" ? "the LLM" : t.named_by}`}
                    onClick={() => setThemes(toggle(themes, t.id))}><ThemeDot id={t.id} />{t.name}<span className="n">{t.size}</span></button>
                ))}
              </div>
            </>
          )}
          <h4 className="eyebrow">Show</h4>
          {data.cutoff != null && !allRelevant && (
            <label className="check"><input type="checkbox" checked={onlyRelevant} onChange={(e) => setOnlyRelevant(e.target.checked)} /> Only papers as relevant as your seeds</label>
          )}
          {known > 0 && (
            <label className="check"><input type="checkbox" checked={hideKnown} onChange={(e) => setHideKnown(e.target.checked)} /> Hide papers your seeds already cite ({known})</label>
          )}
          <label className="check"><input type="checkbox" checked={showSetAside} disabled={!setAside && !showSetAside} onChange={(e) => setShowSetAside(e.target.checked)} /> Show papers you set aside ({setAside})</label>
          {active > 0 && <button type="button" className="link menu-clear" onClick={clear}>Clear all filters</button>}
        </Menu>
        <Menu label="Export" icon={<DownloadIcon />} align="right">
          {keptList.length > 0 && (
            <>
              <h4 className="eyebrow">Your shortlist · {plural(keptList.length, "paper")}</h4>
              <div className="menu-row">
                <button type="button" className="btn utility sm" onClick={() => { exportRis(keptList, "shortlist.ris"); toast(`Exported your shortlist of ${plural(keptList.length, "paper")} as RIS.`); }}>RIS</button>
                <button type="button" className="btn utility sm" onClick={() => { exportCsv(keptList, themeOf, "shortlist.csv"); toast(`Exported your shortlist of ${plural(keptList.length, "paper")} as CSV.`); }}>CSV</button>
              </div>
            </>
          )}
          <h4 className="eyebrow">Results shown · {plural(list.length, "paper")}</h4>
          <div className="menu-row">
            <button type="button" className="btn utility sm" onClick={() => { exportRis(list); toast(`Exported ${plural(list.length, "paper")} as RIS, ready for Zotero, EndNote or Mendeley.`); }}>RIS</button>
            <button type="button" className="btn utility sm" onClick={() => { exportCsv(list, themeOf); toast(`Exported ${plural(list.length, "paper")} as CSV.`); }}>CSV</button>
          </div>
          <p className="help">RIS opens in Zotero, EndNote and Mendeley.</p>
        </Menu>
      </div>

      {(active > 0 || text) && (
        <div className="active-filters">
          {text && <FilterChip label={`“${text}”`} onRemove={() => setText("")} />}
          {[...channels].map((c) => <FilterChip key={c} label={CHANNELS[c]?.[0] ?? c} onRemove={() => setChannels(toggle(channels, c))} />)}
          {[...themes].map((t) => <FilterChip key={t} label={themeName(data, t)} onRemove={() => setThemes(toggle(themes, t))} />)}
          {onlyRelevant && <FilterChip label="As relevant as your seeds" onRemove={() => setOnlyRelevant(false)} />}
          {hideKnown && <FilterChip label="Hiding what your seeds cite" onRemove={() => setHideKnown(false)} />}
          {showSetAside && <FilterChip label="Showing set-aside papers" onRemove={() => setShowSetAside(false)} />}
          <span className="muted">{plural(list.length, "paper")}</span>
          <button type="button" className="link" onClick={clear}>Clear all</button>
        </div>
      )}
      {!active && !text && setAside > 0 && (
        <p className="set-aside-note">{plural(setAside, "paper")} set aside. <button type="button" className="link" onClick={() => setShowSetAside(true)}>Show them</button></p>
      )}

      {live && <p className="live-note"><span className="pulse" /> Live: grades arrive in batches and the list re-ranks as they do.</p>}

      {view === "map" && hasMap ? <ResultsMap data={data} list={list} selected={open} onOpen={openPaper} />
        : view === "graph" && hasMap ? <CitationGraph data={data} list={list} selected={open} onOpen={openPaper} />
          : <ResultList list={list} data={data} live={live} byRelevance={sort === "relevance" && !live}
              selected={open} cursor={cursor} isNew={isNew} showRelevance={!allRelevant} onOpen={openPaper} onClear={clear} />}

      {openResult && (
        <PaperDrawer paper={openResult} data={data} list={list} live={live} onOpen={openPaper} onClose={() => setParam("paper", null)} />
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="filter-chip">{label}
      <button type="button" onClick={onRemove} aria-label={`Remove filter: ${label}`}><XIcon /></button>
    </span>
  );
}
