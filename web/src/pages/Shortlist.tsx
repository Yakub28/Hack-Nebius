import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckIcon, DownloadIcon } from "../components/Icons";
import { Highlighted } from "../components/PaperDrawer";
import { GradeBadge, PaperActions, cardFacts } from "../components/ResultCard";
import { useToast } from "../components/Toast";
import { exportCsv, exportRis } from "../lib/export";
import { firstLink, plural } from "../lib/format";
import { useSession, type Kept } from "../lib/session";

/** A paper as it was kept, its keys explicit: putting back one kept before kept_from existed must not stamp it
 *  with whatever search happens to be on screen. */
const asKept = (p: Kept): Kept => ({ kept_from: undefined, kept_at: undefined, ...p });

/** The papers the researcher kept, from every search, grouped by the question each was kept for: a grade and
 *  a reason only mean something next to their question. */
export function Shortlist() {
  const { kept, toggleKeep, clearKept } = useSession();
  const toast = useToast();
  // A paper removed here stays on the page, faded, until you leave it, so a misclick is one click to undo.
  const [seen, setSeen] = useState<Record<string, Kept>>(kept);
  useEffect(() => setSeen((s) => ({ ...s, ...kept })), [kept]);
  useEffect(() => { document.title = "Shortlist · Snowball"; }, []);

  const keptList = Object.values(kept);
  const removed = Object.values(seen).filter((p) => !kept[p.id]);
  const groups = useMemo(() => {
    const by = new Map<string, Kept[]>();
    Object.values(seen).forEach((p) => by.set(p.kept_from ?? "", [...(by.get(p.kept_from ?? "") ?? []), p]));
    const latest = (papers: Kept[]) => Math.max(...papers.map((p) => p.kept_at ?? 0));
    return [...by.entries()]
      .map(([question, papers]) => ({
        question,
        papers: papers.sort((a, b) => (b.grade ?? -1) - (a.grade ?? -1) || (b.kept_at ?? 0) - (a.kept_at ?? 0)),
      }))
      .sort((a, b) => latest(b.papers) - latest(a.papers));
  }, [seen]);

  if (!groups.length) return <main className="page shortlist"><Empty /></main>;

  return (
    <main className="page shortlist">
      <header className="shortlist-head">
        <div>
          <h1>Your shortlist</h1>
          <p className="muted">
            {keptList.length ? plural(keptList.length, "paper") : "No papers"} kept, from every search you run here.
            Saved in this browser.
          </p>
        </div>
        <div className="shortlist-actions">
          <button type="button" className="btn utility sm" disabled={!keptList.length}
            onClick={() => { exportRis(keptList, "shortlist.ris"); toast(`Exported ${plural(keptList.length, "paper")} as RIS, ready for Zotero, EndNote or Mendeley.`); }}>
            <DownloadIcon />RIS
          </button>
          <button type="button" className="btn utility sm" disabled={!keptList.length}
            onClick={() => { exportCsv(keptList, () => "", "shortlist.csv"); toast(`Exported ${plural(keptList.length, "paper")} as CSV.`); }}>
            <DownloadIcon />CSV
          </button>
          <button type="button" className="link" disabled={!keptList.length} onClick={clearKept}>Clear all</button>
        </div>
      </header>

      {removed.length > 0 && (
        <p className="set-aside-note">
          {plural(removed.length, "paper")} removed; {removed.length === 1 ? "it leaves" : "they leave"} this page when you do.{" "}
          <button type="button" className="link" onClick={() => removed.forEach((p) => toggleKeep(asKept(p)))}>Put {removed.length === 1 ? "it" : "them"} back</button>
        </p>
      )}

      {groups.map((g) => (
        <section key={g.question} className="kept-group">
          <div className="kept-group-head">
            <span className="eyebrow">{g.question ? "Kept for" : "From earlier searches"}</span>
            {g.question && <h2>{g.question}</h2>}
          </div>
          <ol className="cards">
            {g.papers.map((p) => <li key={p.id}><KeptCard p={p} removed={!kept[p.id]} /></li>)}
          </ol>
        </section>
      ))}
    </main>
  );
}

/** A result card without the triage: the whole reason, the quote, and the abstract one click away. */
function KeptCard({ p, removed }: { p: Kept; removed: boolean }) {
  return (
    <article className={`card kept-card${removed ? " out" : ""}`}>
      <GradeBadge grade={p.grade} />
      <div className="card-body">
        <div className="card-top">
          <h3><a className="kept-title" href={firstLink(p)} target="_blank" rel="noopener">{p.title}</a></h3>
          <PaperActions paper={asKept(p)} dismiss={false} />
        </div>
        <div className="meta">
          {removed && <span className="badge out">Removed</span>}
          {p.preprint && <span className="badge pre" title="Not peer reviewed">Preprint</span>}
          {cardFacts(p).map((f, i) => <span key={i}>{f}</span>)}
        </div>
        {p.reason && <p className="reason">{p.reason}</p>}
        {p.quote && <blockquote className="quote" title="Verbatim from the abstract, checked word for word"><CheckIcon />“{p.quote}”</blockquote>}
        {p.abstract && (
          <details className="kept-abstract">
            <summary>Abstract</summary>
            <p className="abstract-full"><Highlighted text={p.abstract} quote={p.quote} /></p>
          </details>
        )}
      </div>
    </article>
  );
}

function Empty() {
  return (
    <section className="empty">
      <h2>Nothing kept yet</h2>
      <p className="empty-sub">Star a paper in any search, or press S on it, and it lands here with the question you
        kept it for. The shortlist carries across searches, ready to export to your reference manager.</p>
      <div className="empty-actions">
        <Link className="btn primary" to="/search">Start a search</Link>
        <Link className="btn secondary" to="/recorded">Open the recorded run</Link>
      </div>
    </section>
  );
}
