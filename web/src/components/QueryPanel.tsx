import { Fragment } from "react";
import type { Discovery, Queries } from "../api/types";
import { GRADES, plural } from "../lib/format";
import { FIELD_HELP, readQuery } from "../lib/query";
import { ExternalIcon } from "./Icons";

// Where each boolean query ran, so the reader can run the exact one themselves.
const RUN_AT: Partial<Record<keyof Queries, [string, (q: string) => string]>> = {
  pubmed_queries: ["PubMed", (q) => `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(q)}`],
  preprint_queries: ["Europe PMC", (q) => `https://europepmc.org/search?query=${encodeURIComponent(`(${q}) AND SRC:PPR`)}`],
};

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
  const groups: [keyof Queries, string][] = [["pubmed_queries", "PubMed"], ["preprint_queries", "Preprints"]];
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
            <div key={k} className="qgroup">
              <h4 className="eyebrow">{title}</h4>
              <ul className="qlist">
                {data.queries[k].map((q) => (RUN_AT[k] ? <BooleanQuery key={q} query={q} runAt={RUN_AT[k]} /> : <li key={q} className="q">{q}</li>))}
              </ul>
            </div>
          ))}
          {data.web_trail.map((t) => (
            <div key={t.round} className="qgroup">
              <h4 className="eyebrow">Web agent · round {t.round}</h4>
              {t.searches.length > 0 && <ul className="qlist">{t.searches.map((q) => <li key={q} className="q">{q}</li>)}</ul>}
              {t.why && <p className="qwhy">{t.why}</p>}
              {t.searches.length > 0 && <p className="qwhy">{t.pages} pages read · {t.papers} tied to a paper record</p>}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

/** A boolean query as a reader would say it: one line per concept, its synonyms joined with "or". The exact
 *  query is on hover, and one click runs it where the engine did. Syntax it can't read is shown as written. */
function BooleanQuery({ query, runAt: [where, url] }: { query: string; runAt: [string, (q: string) => string] }) {
  const clauses = readQuery(query);
  const oneLine = clauses?.every((c) => c.terms.length === 1);
  return (
    <li className="q" title={query}>
      {clauses ? (
        <span className="q-text">
          {clauses.map((c, i) => (
            <span key={i} className={oneLine ? undefined : "q-line"}>
              {i > 0 && <span className="q-op">{c.not ? " but not " : " and "}</span>}
              {c.terms.map((t, j) => (
                <Fragment key={j}>
                  {j > 0 && <span className="q-op">{j === c.terms.length - 1 ? " or " : ", "}</span>}
                  {t.text}
                  {t.field && <span className="q-tag" title={FIELD_HELP[t.field]}>{t.field}</span>}
                </Fragment>
              ))}
            </span>
          ))}
        </span>
      ) : <code className="q-text">{query}</code>}
      <a className="q-run" href={url(query)} target="_blank" rel="noopener" aria-label={`Run this query in ${where}`}
        title={`Run this exact query in ${where}`}><ExternalIcon /></a>
    </li>
  );
}
