import type { Discovery } from "../api/types";
import { GRADES, plural } from "../lib/format";

/** The search as the engine understood it: the question, the seeds and how they graded, the criteria every
 *  result was judged against, and the searches it ran. Replaces the form once a search exists; Edit brings
 *  the form back. `compact` is the one-line version that sits above the results on a phone. */
export function QueryPanel({ data, question, seedRefs, running, compact = false, onEdit, onCancel }: {
  data: Discovery | null; question: string; seedRefs: string[]; running: boolean; compact?: boolean;
  onEdit: () => void; onCancel: () => void;
}) {
  const seeds = data?.seeds ?? [];
  const head = (
    <div className="query-head">
      <span className="eyebrow">{running ? "Searching" : "Your search"}</span>
      {running
        ? <button type="button" className="btn utility sm" onClick={onCancel}>Cancel</button>
        : <button type="button" className="btn utility sm" onClick={onEdit}>Edit</button>}
    </div>
  );
  if (compact) {
    return (
      <section className="panel query compact">
        {head}
        <p className="query-q">{question}</p>
        <span className="muted">{plural(seedRefs.length, "seed")}</span>
      </section>
    );
  }
  const groups: [keyof Discovery["queries"], string][] = [["pubmed_queries", "PubMed"], ["preprint_queries", "Preprints"]];
  if (data && !data.web_trail.length) groups.push(["web_queries", "Web"]);
  return (
    <section className="panel query">
      {head}
      <p className="query-q">{question}</p>

      <h3 className="eyebrow">Seeds</h3>
      <ul className="seeds">
        {seeds.length ? seeds.map((s) => (
          <li key={s.id}>
            <span className="lbl">{s.label}</span>
            <a className="t" href={s.links.pubmed || s.links.doi || s.links.europepmc} target="_blank" rel="noopener" title={s.title}>{s.title}</a>
            {s.grade != null
              ? <span className={`chip${s.grade >= 3 ? " ok" : ""}`} title="The seed's grade under the same prompt as the results">{s.grade} · {GRADES[s.grade]}</span>
              : running && data?.results.length ? <span className="chip">grading…</span> : null}
          </li>
        )) : seedRefs.map((ref) => <li key={ref}><span className="lbl">·</span><span className="t muted">{ref}</span></li>)}
      </ul>
      {data?.cutoff != null && (
        <p className="note">Your seeds graded {data.cutoff} or higher under the same prompt, which draws the relevance line.</p>
      )}

      {data && data.criteria.length > 0 && (
        <details className="more" open>
          <summary>Criteria every result is graded against</summary>
          <ul className="criteria">{data.criteria.map((c) => <li key={c}>{c}</li>)}</ul>
        </details>
      )}
      {data && (data.queries.pubmed_queries.length > 0 || data.web_trail.length > 0) && (
        <details className="more">
          <summary>How it searched</summary>
          {groups.filter(([k]) => data.queries[k].length).map(([k, title]) => (
            <div key={k} className="qgroup"><h4 className="eyebrow">{title}</h4>{data.queries[k].map((q) => <code key={q}>{q}</code>)}</div>
          ))}
          {data.web_trail.map((t) => (
            <div key={t.round} className="qgroup">
              <h4 className="eyebrow">Web agent · round {t.round}</h4>
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
