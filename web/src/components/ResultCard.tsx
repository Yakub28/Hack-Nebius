import type { Discovery, Result } from "../api/types";
import { CHANNELS, GRADES, KEYWORD_CHANNELS, authors, firstLink, plural, refOf, shortAuthors, studyDesign } from "../lib/format";
import { useSession } from "../lib/session";
import { CheckIcon, ExternalIcon, PlusIcon, StarIcon, XIcon } from "./Icons";
import { useToast } from "./Toast";

export function GradeBadge({ grade, pending }: { grade: number | null; pending?: boolean }) {
  if (grade == null && pending) {
    return <div className="grade grading" title="The LLM has not graded this paper yet"><b>…</b><span className="meter"><i /><i /><i /><i /></span><small>Grading</small></div>;
  }
  return (
    <div className={`grade g${grade ?? "x"}`} title={grade == null ? "Not graded: ranked by retrieval signals only" : `LLM grade ${grade} of 4`}>
      <b>{grade ?? "–"}</b>
      <span className="meter" aria-hidden="true">{[1, 2, 3, 4].map((n) => <i key={n} className={grade != null && n <= grade ? "on" : ""} />)}</span>
      <small>{grade == null ? "Unjudged" : GRADES[grade]}</small>
    </div>
  );
}

export function ThemeDot({ id }: { id: number }) {
  return <span className="dot" style={{ background: `var(--t${id})` }} />;
}

export function themeName(data: Discovery, id: number | null): string {
  return id == null ? "" : data.map?.themes.find((t) => t.id === id)?.name ?? "";
}

/** Adds a paper to the seed box, and says what happened. */
export function useSeedAction() {
  const { addSeed } = useSession();
  const toast = useToast();
  return (paper: Result) => {
    const outcome = addSeed(refOf(paper));
    toast(outcome === "added" ? "Added as a seed. Run again from the bar at the bottom to follow its citations too."
      : outcome === "full" ? "The seed box is full (30). Remove one to add another." : "That paper is already a seed.");
  };
}

/** Keep, set aside, use as a seed, open the source: the review actions, on cards and in the drawer. */
export function PaperActions({ paper, labels = false }: { paper: Result; labels?: boolean }) {
  const { kept, toggleKeep, dismissed, toggleDismiss, isSeed } = useSession();
  const seedAction = useSeedAction();
  const isKept = !!kept[paper.id];
  const isOut = dismissed.has(paper.id);
  const seeded = isSeed(refOf(paper));
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <div className="actions" role="group" aria-label="Review this paper">
      <button type="button" className={`act${isKept ? " on keep" : ""}`} aria-pressed={isKept} onClick={stop(() => toggleKeep(paper))}
        title={isKept ? "In your shortlist (S to remove)" : "Keep in your shortlist (S)"}>
        <StarIcon filled={isKept} />{labels && (isKept ? "Kept" : "Keep")}
      </button>
      <button type="button" className={`act${isOut ? " on out" : ""}`} aria-pressed={isOut} onClick={stop(() => toggleDismiss(paper.id))}
        title={isOut ? "Set aside (X to restore)" : "Not relevant: set it aside (X)"}>
        <XIcon />{labels && (isOut ? "Set aside" : "Not relevant")}
      </button>
      <button type="button" className={`act seed${seeded ? " on" : ""}`} aria-pressed={seeded} disabled={seeded}
        onClick={stop(() => seedAction(paper))} title={seeded ? "Already a seed" : "Add as a seed, then run again to follow its citations (A)"}>
        {seeded ? <CheckIcon /> : <PlusIcon />}Seed
      </button>
      {!labels && (
        <a className="act" href={firstLink(paper)} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}
          title="Open the record" aria-label="Open the record in a new tab"><ExternalIcon /></a>
      )}
    </div>
  );
}

/** Every tag, for the drawer; the card shows only the links to the seeds. */
export function Tags({ r, data }: { r: Result; data: Discovery }) {
  const theme = themeName(data, r.theme);
  return (
    <div className="chips">
      {r.likely_relevant && <span className="chip ok" title="Graded at least as high as your weakest seed">✓ Likely relevant</span>}
      {r.preprint && <span className="chip warn" title="Not peer reviewed">Preprint</span>}
      {theme && <span className="chip" title="Theme on the map"><ThemeDot id={r.theme!} />{theme}</span>}
      <SeedLinks r={r} />
      <span className="chip" title="Cosine similarity of the embeddings"><span className="k">closest to</span> {r.nearest_seed.label} · {r.nearest_seed.similarity.toFixed(2)}</span>
    </div>
  );
}

function SeedLinks({ r }: { r: Result }) {
  return (
    <>
      {r.cites_seeds.length > 0 && <span className="chip accent" title="This paper cites these seeds"><span className="k">cites</span> <b>{r.cites_seeds.join(", ")}</b></span>}
      {r.cited_by_seeds.length > 0 && <span className="chip accent" title="These seeds cite this paper: you may know it already"><span className="k">cited by</span> <b>{r.cited_by_seeds.join(", ")}</b></span>}
    </>
  );
}

export function Facts({ r }: { r: Result }) {
  const facts = [
    ...r.types.filter((t) => t !== "Journal Article").slice(0, 3),
    r.citations != null ? plural(r.citations, "citation") : "",
    r.rcr != null ? `RCR ${r.rcr.toFixed(1)}` : "",
    ...r.sources.filter((s) => s.via === "abstract").map((s) => `Trial ${s.title}`),
  ].filter(Boolean);
  return facts.length ? <div className="facts">{facts.map((f) => <span key={f}>{f}</span>)}</div> : null;
}

export function Meta({ r }: { r: Result }) {
  return (
    <div className="meta">
      {[authors(r.authors), r.venue, r.year].filter(Boolean).map((part, i, all) => (
        <span key={i}>{i === 1 && r.venue ? <span className="venue">{part}</span> : part}{i < all.length - 1 ? " · " : ""}</span>
      ))}
    </div>
  );
}

/** Why a paper is "beyond keywords", or null when it isn't: none of this run's keyword searches returned it.
 *  Only when they ran and found something, so a failed PubMed channel can't badge every result. */
function beyondKeywords(r: Result, data: Discovery): string | null {
  const searches = data.queries.pubmed_queries.length + data.queries.preprint_queries.length;
  const keyword = (p: Result) => p.channels.some((c) => KEYWORD_CHANNELS.has(c));
  if (!searches || keyword(r) || !r.channels.length || !data.results.some(keyword)) return null;
  return `Beyond keyword search: none of this run's ${plural(searches, "PubMed or preprint query", "PubMed and preprint queries")} `
    + `returned this paper.\nFound by: ${r.channels.map((c) => CHANNELS[c]?.[0] ?? c).join(", ")}.`;
}

/** One result, compact enough to scan: grade, title, the facts a reader screens on, one line of the judge's
 *  reason and the verified quote. Everything else is one click away in the drawer. */
export function ResultCard({ r, data, live, selected, cursor, below, isNew, showRelevance, onOpen }: {
  r: Result; data: Discovery; live: boolean; selected: boolean; cursor: boolean; below: boolean;
  isNew: boolean; showRelevance: boolean; onOpen: (id: string) => void;
}) {
  const { dismissed } = useSession();
  const out = dismissed.has(r.id);
  const theme = themeName(data, r.theme);
  const design = studyDesign(r.types);
  const beyond = beyondKeywords(r, data);
  const facts =[shortAuthors(r.authors), r.venue, r.year, design, r.citations != null ? plural(r.citations, "citation") : ""].filter(Boolean);
  const cls = ["card", below && "below", selected && "selected", cursor && "cursor", out && "out"].filter(Boolean).join(" ");
  return (
    // The whole card opens the paper, except its own links and buttons, and a drag that selected text to copy.
    <article className={cls} onClick={(e) => {
      if (!(e.target as HTMLElement).closest("a, button") && !window.getSelection()?.toString()) onOpen(r.id);
    }}>
      <GradeBadge grade={r.grade} pending={live} />
      <div className="card-body">
        <div className="card-top">
          <h3><button type="button" className="title-btn" onClick={() => onOpen(r.id)}>{r.title}</button></h3>
          <PaperActions paper={r} />
        </div>
        <div className="meta">
          {isNew && <span className="badge new" title="Not in your previous search's results">New</span>}
          {beyond && <span className="badge beyond" title={beyond}>Beyond keywords</span>}
          {r.preprint &&<span className="badge pre" title="Not peer reviewed">Preprint</span>}
          {out && <span className="badge out">Set aside</span>}
          {facts.map((f, i) => <span key={i} className={i === 1 ? "venue" : undefined}>{f}</span>)}
        </div>
        {r.reason && <p className="reason clamp-1" title={r.reason}>{r.reason}</p>}
        {r.quote && <blockquote className="quote clamp-2" title="Verbatim from the abstract, checked word for word"><CheckIcon />“{r.quote}”</blockquote>}
        <div className="card-links">
          {showRelevance && r.likely_relevant && <span className="chip ok">✓ Likely relevant</span>}
          <SeedLinks r={r} />
          {theme && <span className="chip" title="Theme on the map"><ThemeDot id={r.theme!} />{theme}</span>}
          <span className="found" title={r.found_via.join("\n")}>found {plural(r.found_via.length, "way")}</span>
        </div>
      </div>
    </article>
  );
}
