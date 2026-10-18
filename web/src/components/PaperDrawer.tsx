import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Discovery, Paper, Result } from "../api/types";
import { CHANNELS, LINK_NAMES, firstLink, safeUrl } from "../lib/format";
import { CheckIcon } from "./Icons";
import { Facts, GradeBadge, Meta, PaperActions, Tags } from "./ResultCard";

/** The abstract with the verified quote marked where it occurs. The engine checked the quote against the
 *  text with case and whitespace squashed, so the match here is just as forgiving. React escapes both parts. */
export function Highlighted({ text, quote }: { text: string; quote: string | null }) {
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
  const panel = useRef<HTMLDivElement>(null);
  const index = list.findIndex((r) => r.id === paper.id);
  const prev = index > 0 ? list[index - 1] : null;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null;

  useEffect(() => { panel.current?.scrollTo({ top: 0 }); }, [paper.id]);
  // Which folds are open lives here, not in each <details>, so it carries over as J and K step through papers.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const fold = (id: string) => ({ open: !!open[id], onToggle: (o: boolean) => setOpen((m) => (m[id] === o ? m : { ...m, [id]: o })) });

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
      <aside className="drawer" aria-label="Paper details">
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
        <div className="drawer-body" ref={panel}>
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

          <Fold title="How it was found" count={paper.found_via.length} hint="The routes that led to this paper, and its retrieval scores" {...fold("found")}>
            <ul className="why">{paper.found_via.map((f) => <li key={f}>{f}</li>)}</ul>
            <div className="scores">
              <span className="chip"><span className="k">channels</span> {paper.channels.map((c) => CHANNELS[c]?.[0] ?? c).join(", ")}</span>
              <span className="chip" title="Reciprocal rank fusion of the retrieval signals"><span className="k">fused</span> {s.fused.toFixed(4)}</span>
              <span className="chip"><span className="k">seed sim</span> {s.seed_similarity.toFixed(2)}</span>
              <span className="chip"><span className="k">question sim</span> {s.question_similarity.toFixed(2)}</span>
              {s.cocited > 0 && <span className="chip"><span className="k">co-cited</span> {s.cocited}</span>}
              {s.shared_references > 0 && <span className="chip"><span className="k">shared refs</span> {s.shared_references}</span>}
            </div>
          </Fold>

          {cites.length > 0 && (
            <Fold title="Cites" count={cites.length} hint="Papers among these results and your seeds that this one cites" {...fold("cites")}>
              <Neighbors papers={cites} onOpen={onOpen} />
            </Fold>
          )}
          {citedBy.length > 0 && (
            <Fold title="Cited by" count={citedBy.length} hint="Papers among these results and your seeds that cite this one" {...fold("citedBy")}>
              <Neighbors papers={citedBy} onOpen={onOpen} />
            </Fold>
          )}

          {web.length > 0 && (
            <Fold title="Web context" count={web.length} {...fold("web")}>
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
            </Fold>
          )}

          {paper.abstract && (
            <Fold title="Abstract" {...fold("abstract")}>
              <p className="abstract-full"><Highlighted text={paper.abstract} quote={paper.quote} /></p>
            </Fold>
          )}
        </div>
      </aside>
    </>
  );
}

/** A drawer section that folds away behind its heading. The count says what a closed one holds. */
function Fold({ title, count, hint, open, onToggle, children }: {
  title: string; count?: number; hint?: string; open: boolean; onToggle: (open: boolean) => void; children: ReactNode;
}) {
  return (
    <details className="drawer-section fold" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary title={hint}>
        <h3 className="eyebrow">{title}</h3>
        {count !== undefined && <span className="fold-count">{count}</span>}
      </summary>
      {children}
    </details>
  );
}

function Neighbors({ papers, onOpen }: { papers: (Paper & { label?: string })[]; onOpen: (id: string) => void }) {
  return (
    <div className="neighbors">
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
