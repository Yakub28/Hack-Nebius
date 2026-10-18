import type { Discovery, Result } from "../api/types";
import { GRADES, LINK_NAMES, authors, plural, refOf } from "../lib/format";
import { useSession } from "../lib/session";
import { useToast } from "./Toast";

export function GradeBadge({ grade, pending }: { grade: number | null; pending?: boolean }) {
  if (grade == null && pending) {
    return <div className="grade grading" title="The LLM has not graded this paper yet"><b>…</b><span className="meter"><i /><i /><i /><i /></span><small>Grading</small></div>;
  }
  return (
    <div className="grade" title={grade == null ? "Not graded: ranked by retrieval signals only" : `LLM grade ${grade} of 4`}>
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

export function SeedButton({ paper }: { paper: Result }) {
  const { addSeed, isSeed } = useSession();
  const toast = useToast();
  const ref = refOf(paper);
  const seeded = isSeed(ref);
  return (
    <button type="button" className="btn utility sm seed-btn" aria-pressed={seeded}
      title="Add this paper to the seed box, then run again to follow its citations"
      onClick={(e) => {
        e.stopPropagation();
        const outcome = addSeed(ref);
        toast(outcome === "added" ? "Added as a seed. Run the search again to follow its citations too."
          : outcome === "full" ? "The seed box is full (30). Remove one to add another." : "That paper is already a seed.");
      }}>
      {seeded ? "✓ Seed" : "+ Add as seed"}
    </button>
  );
}

export function Tags({ r, data }: { r: Result; data: Discovery }) {
  const theme = themeName(data, r.theme);
  return (
    <div className="chips">
      {r.likely_relevant && <span className="chip ok" title="Graded at least as high as your weakest seed">✓ Likely relevant</span>}
      {r.preprint && <span className="chip warn" title="Not peer reviewed">Preprint</span>}
      {theme && <span className="chip" title="Theme on the map"><ThemeDot id={r.theme!} />{theme}</span>}
      {r.cites_seeds.length > 0 && <span className="chip accent"><span className="k">cites</span> <b>{r.cites_seeds.join(", ")}</b></span>}
      {r.cited_by_seeds.length > 0 && <span className="chip accent"><span className="k">cited by</span> <b>{r.cited_by_seeds.join(", ")}</b></span>}
      <span className="chip" title="Cosine similarity of the embeddings"><span className="k">closest to</span> {r.nearest_seed.label} · {r.nearest_seed.similarity.toFixed(2)}</span>
    </div>
  );
}

export function Facts({ r }: { r: Result }) {
  const facts = [
    ...r.types.filter((t) => t !== "Journal Article").slice(0, 2),
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

export function ResultCard({ r, data, live, selected, below, onOpen }: {
  r: Result; data: Discovery; live: boolean; selected: boolean; below: boolean; onOpen: (id: string) => void;
}) {
  const web = r.sources.filter((s) => s.via !== "abstract").length;
  return (
    <article className={`card${below ? " below" : ""}${selected ? " selected" : ""}`}>
      <GradeBadge grade={r.grade} pending={live} />
      <div>
        <div className="card-head">
          <div>
            <h3><button type="button" className="title-btn" onClick={() => onOpen(r.id)}>{r.title}</button></h3>
            <Meta r={r} />
          </div>
          <SeedButton paper={r} />
        </div>
        {r.reason && <p className="reason">{r.reason}</p>}
        {r.quote && <blockquote className="quote">“{r.quote}”<span className="tag">✓ Verbatim from the abstract</span></blockquote>}
        <Tags r={r} data={data} />
        <Facts r={r} />
        <div className="card-foot">
          <div className="links">
            {Object.entries(r.links).map(([name, url]) => (
              <a key={name} href={url} target="_blank" rel="noopener">{LINK_NAMES[name] ?? name}</a>
            ))}
          </div>
          <button type="button" className="toggle" onClick={() => onOpen(r.id)}>
            Details{web ? ` · ${plural(web, "web source")}` : ""}
          </button>
        </div>
      </div>
    </article>
  );
}
