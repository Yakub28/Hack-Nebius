import { useEffect, useMemo, useRef } from "react";
import type { Discovery, Paper, Result } from "../api/types";
import { CHANNELS, LINK_NAMES, firstLink, safeUrl } from "../lib/format";
import { CheckIcon } from "./Icons";
import { Facts, GradeBadge, Meta, PaperActions, Tags } from "./ResultCard";

/** The abstract with the verified quote marked where it occurs. The engine checked the quote against the
 *  text with case and whitespace squashed, so the match here is just as forgiving. React escapes both parts. */
function Highlighted({ text, quote }: { text: string; quote: string | null }) {
  const match = useMemo(() => {
    if (!quote) return null;
    const words = quote.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(words.join("\\s+"), "i").exec(text);
  }, [text, quote]);
  if (!match) return <>{text}</>;
  return <>{text.slice(0, match.index)}<mark title="The quote on the card: verbatim from here">{match[0]}</mark>{text.slice(match.index + match[0].length)}</>;
}

/** One paper in full, beside the list. Its citations among the results are links, so the panel walks the
 *  result set rather than being a dead end; J and K (handled by the list) step through it in order. */
export function PaperDrawer({ paper, data, list, live, onOpen, onClose }: {
  paper: Result; data: Discovery; list: Result[]; live: boolean;
  onOpen: (id: string) => void; onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const index = list.findIndex((r) => r.id === paper.id);
  const prev = index > 0 ? list[index - 1] : null;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null;

  useEffect(() => { panel.current?.scrollTo({ top: 0 }); }, [paper.id]);

  const byId = useMemo(() => {
    const m = new Map<string, Paper & { label?: string }>();
    data.results.forEach((r) => m.set(r.id, r));
    data.seeds.forEach((s) => m.set(s.id, s));
    return m;
  }, [data]);
  const edges = data.map?.edges ?? [];
  const cites = edges.filter((e) => e.from === paper.id).map((e) => byId.get(e.to)).filter(Boolean) as (Paper & { label?: string })[];
  const citedBy = edges.filter((e) => e.to === paper.id).map((e) => byId.get(e.from)).filter(Boolean) as (Paper & { label?: string })[];
  const web = paper.sources;
  const s = paper.scores;

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" ref={panel} aria-label="Paper details">
        <div className="drawer-bar">
          <span className="eyebrow">{index >= 0 ? `Paper ${index + 1} of ${list.length}` : "Paper"}</span>
          <div className="drawer-nav">
            <span className="kbd-hint"><kbd>J</kbd><kbd>K</kbd></span>
            <button type="button" className="icon-btn sm" disabled={!prev} onClick={() => prev && onOpen(prev.id)} aria-label="Previous paper (K)" title="Previous (K)">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button type="button" className="icon-btn sm" disabled={!next} onClick={() => next && onOpen(next.id)} aria-label="Next paper (J)" title="Next (J)">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button type="button" className="icon-btn sm" onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>

        <div className="drawer-head">
          <GradeBadge grade={paper.grade} pending={live} />
          <div>
            <h2><a href={firstLink(paper)} target="_blank" rel="noopener">{paper.title}</a></h2>
            <Meta r={paper} />
          </div>
        </div>
        <div className="drawer-actions">
          <PaperActions paper={paper} labels />
          <div className="links">
            {Object.entries(paper.links).map(([name, url]) => <a key={name} href={url} target="_blank" rel="noopener">{LINK_NAMES[name] ?? name} ↗</a>)}
          </div>
        </div>

        {paper.reason && (
          <section className="drawer-section first">
            <h3 className="eyebrow">Why it is relevant</h3>
            <p className="reason">{paper.reason}</p>
            {paper.quote && <blockquote className="quote"><CheckIcon />“{paper.quote}”<span className="tag">Verbatim from the abstract, checked word for word</span></blockquote>}
          </section>
        )}
        <Tags r={paper} data={data} />
        <Facts r={paper} />

        <section className="drawer-section">
          <h3 className="eyebrow">How it was found</h3>
          <ul className="why">{paper.found_via.map((f) => <li key={f}>{f}</li>)}</ul>
          <div className="scores">
            <span className="chip"><span className="k">channels</span> {paper.channels.map((c) => CHANNELS[c]?.[0] ?? c).join(", ")}</span>
            <span className="chip" title="Reciprocal rank fusion of the retrieval signals"><span className="k">fused</span> {s.fused.toFixed(4)}</span>
            <span className="chip"><span className="k">seed sim</span> {s.seed_similarity.toFixed(2)}</span>
            <span className="chip"><span className="k">question sim</span> {s.question_similarity.toFixed(2)}</span>
            {s.cocited > 0 && <span className="chip"><span className="k">co-cited</span> {s.cocited}</span>}
            {s.shared_references > 0 && <span className="chip"><span className="k">shared refs</span> {s.shared_references}</span>}
          </div>
        </section>

        {(cites.length > 0 || citedBy.length > 0) && (
          <section className="drawer-section">
            <h3 className="eyebrow">Citations among these results</h3>
            <Neighbors title="Cites" papers={cites} onOpen={onOpen} />
            <Neighbors title="Cited by" papers={citedBy} onOpen={onOpen} />
          </section>
        )}

        {web.length > 0 && (
          <section className="drawer-section">
            <h3 className="eyebrow">Web context</h3>
            <ul className="sources">
              {web.map((x) => (
                <li key={x.url}>
                  <span className="chip">{x.kind}</span>
                  <a href={safeUrl(x.url)} target="_blank" rel="noopener nofollow">{x.title}</a><span className="dom">{x.domain}</span>
                  {x.snippet && <p>{x.snippet}</p>}
                </li>
              ))}
            </ul>
            <p className="note">Pages about this paper, found by web search on its title, plus trial numbers its abstract quotes. Links to read, not claims about the paper.</p>
          </section>
        )}

        {paper.abstract && (
          <section className="drawer-section">
            <h3 className="eyebrow">Abstract</h3>
            <p className="abstract-full"><Highlighted text={paper.abstract} quote={paper.quote} /></p>
          </section>
        )}
      </aside>
    </>
  );
}

function Neighbors({ title, papers, onOpen }: { title: string; papers: (Paper & { label?: string })[]; onOpen: (id: string) => void }) {
  if (!papers.length) return null;
  return (
    <div className="neighbors">
      <span className="k">{title}</span>
      <ul>
        {papers.map((p) => (
          <li key={p.id}>
            {p.label
              ? <span className="neighbor seed"><b>{p.label}</b> {p.title}</span>
              : <button type="button" className="neighbor" onClick={() => onOpen(p.id)}>{p.title}</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
