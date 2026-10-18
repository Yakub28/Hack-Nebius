import { useMemo, useState } from "react";
import type { Discovery } from "../api/types";
import { patterns } from "../lib/brief";
import { plural } from "../lib/format";
import { CheckIcon } from "./Icons";

/** The research brief above the list: what the strongest results say together, then patterns counted across
 *  all of them. The engine already left out every finding it could not check, so this shows what survived,
 *  each claim with its papers one click away and its quote one click further. */
export function Brief({ data, onOpen }: { data: Discovery; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const [quote, setQuote] = useState<number | null>(null);
  const brief = data.brief ?? null;
  const found = useMemo(() => patterns(data), [data]);
  const rank = useMemo(() => new Map(data.results.map((r, i) => [r.id, i + 1])), [data.results]);
  if (!brief && !found.length) return null;
  const title = (id: string) => data.results.find((r) => r.id === id)?.title ?? "";

  const cites = (ids: string[], most = 5) => {
    const shown = ids.filter((id) => rank.has(id));
    return (
      <span className="cites">
        {shown.slice(0, most).map((id) => (
          <button key={id} type="button" className="cite" title={`#${rank.get(id)} ${title(id)}`}
            aria-label={`Open result ${rank.get(id)}`} onClick={() => onOpen(id)}>{rank.get(id)}</button>
        ))}
        {shown.length > most && <span className="cite more" title={shown.slice(most).map((id) => `#${rank.get(id)} ${title(id)}`).join("\n")}>+{shown.length - most}</span>}
      </span>
    );
  };
  const toggleQuote = (i: number) => setQuote(quote === i ? null : i);

  return (
    <section className="brief" aria-label="Research brief">
      <div className="brief-head">
        <span className="eyebrow">Research brief</span>
        <button type="button" className="toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button>
      </div>
      {open && (
        <>
          {brief?.answer && <p className="brief-answer">{brief.answer.text}{cites(brief.answer.papers)}</p>}
          {brief && (
            <ul className="brief-findings">
              {brief.findings.map((f, i) => (
                <li key={f.text}>
                  <CheckIcon />
                  {/* A span, not a button: a button wraps as a block and pushes the citations onto a line of their own. */}
                  <span className="finding" role="button" tabIndex={0} aria-expanded={quote === i} title="Show the quote it rests on"
                    onClick={() => toggleQuote(i)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleQuote(i); } }}>{f.text}</span>
                  {cites(f.papers)}
                  {quote === i && (
                    <blockquote className="quote">“{f.quote}”
                      <span className="from">Word for word from #{rank.get(f.quote_paper)}, {title(f.quote_paper)}</span>
                    </blockquote>
                  )}
                </li>
              ))}
            </ul>
          )}
          {found.length > 0 && (
            <div className="brief-patterns">
              {found.map((p) => p.paper
                ? <button key={p.label} type="button" className="chip pattern" title={p.detail} onClick={() => onOpen(p.paper!)}>{p.label}</button>
                : <span key={p.label} className="chip pattern" title={p.detail}>{p.label}</span>)}
            </div>
          )}
          <p className="brief-note">
            {brief && <>Written by {brief.model.split("/").pop()} from the top {plural(brief.read, "abstract")} · each finding
              quotes a cited paper word for word · its numbers appear in the cited abstracts
              {brief.dropped > 0 && <> · {plural(brief.dropped, "finding")} that didn't check out left out</>} · </>}
            patterns counted from the records
          </p>
        </>
      )}
    </section>
  );
}
