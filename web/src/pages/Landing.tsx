import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Discovery } from "../api/types";
import { GRADES, plural } from "../lib/format";
import { SeedField } from "../components/SeedField";

/** The hero's constellation is a citation graph: two seeds (diamonds) and the papers they lead to. A still
 *  picture for the one-column hero; wider screens get the same picture live (SeedField). */
function Constellation() {
  const results: [number, number, number, string][] = [
    [80, 90, 10, "#2a9d99"], [110, 250, 12, "#dd5b00"], [210, 60, 8, "#62aef0"], [230, 230, 12, "#ff64c8"],
    [360, 220, 10, "#1aae39"], [390, 70, 8, "#d6b6f6"], [250, 300, 6, "#2a9d99"], [60, 180, 6, "#62aef0"],
    [330, 300, 7, "#dd5b00"], [420, 160, 7, "#ff64c8"], [190, 130, 5, "#1aae39"],
  ];
  return (
    <svg className="constellation" viewBox="0 0 460 340" role="img" aria-label="Two seed papers connected to the new papers they lead to">
      <g fill="#fff" opacity=".35">
        {[[24, 30], [440, 22], [300, 18], [446, 300], [20, 310], [160, 320], [130, 20], [452, 120]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" />)}
      </g>
      <g stroke="#fff" strokeOpacity=".28" strokeWidth="1.4" fill="none" className="constellation-lines">
        <path d="M150 170L80 90M150 170L110 250M150 170L230 230M150 170L60 180M150 170L190 130" />
        <path d="M300 120L210 60M300 120L230 230M300 120L360 220M300 120L390 70M300 120L420 160" />
        <path d="M230 230L250 300M360 220L330 300M80 90L210 60" />
        <path d="M150 170L300 120" strokeDasharray="4 5" strokeOpacity=".5" />
      </g>
      <g className="constellation-nodes">
        {results.map(([x, y, r, c], i) => <circle key={i} cx={x} cy={y} r={r} fill={c} style={{ animationDelay: `${i * 0.12}s` }} />)}
      </g>
      <g fill="#fff"><path d="M150 156L164 170L150 184L136 170Z" /><path d="M300 106L314 120L300 134L286 120Z" /></g>
      <g fill="#fff" fontFamily="Inter, sans-serif" fontSize="13" fontWeight="700"><text x="168" y="190">S1</text><text x="318" y="112">S2</text></g>
    </svg>
  );
}

export function Landing() {
  const [run, setRun] = useState<Discovery | null>(null);
  useEffect(() => { document.title = "Snowball"; api.recorded().then(setRun).catch(() => {}); }, []);

  return (
    <>
      <section className="hero-band">
        <SeedField />
        <div className="hero-inner">
          <div>
            <span className="badge">Biomedical literature</span>
            <h1>Start from the papers you trust.</h1>
            <p>Add a question and a few papers you trust. It follows their citations, searches PubMed, preprints and
              the web, and ranks what it finds, each paper with a quote that shows why it fits.</p>
            <div className="cta-row">
              <Link className="btn primary" to="/search">Start a search</Link>
              <Link className="btn secondary" to="/recorded">See an example</Link>
            </div>
          </div>
          <div className="hero-art"><Constellation /></div>
        </div>
      </section>

      <main className="page">
        <section className="section">
          <h2>Finds what keyword search misses.</h2>
          <p className="lead">We gave it the first few papers of published systematic reviews and counted how many of the rest it found in its top 50.</p>
          <div className="stat-row">
            <div><b>7×</b><span>more than a PubMed search</span></div>
            <div><b>2×</b><span>more than Google Scholar</span></div>
            <div><b>0</b><span>invented citations</span></div>
          </div>
        </section>

        <section className="section">
          <h2>How it works</h2>
          <p className="lead">Two to three minutes, and you watch each step as it happens.</p>
          <ol className="how">
            <Step n={1} band="sky" art={<SeedsArt />} title="Follow your seeds">
              It follows their citations both ways and searches PubMed, preprints and the web. A web agent reads what
              it finds and decides where to look next.
            </Step>
            <Step n={2} band="purple" art={<GradeArt />} title="See why each fits">
              The LLM grades every strong candidate from 0 to 4, with a quote checked word for word against the
              abstract. Your seeds are graded too, so you can see what counts as relevant.
            </Step>
            <Step n={3} band="orange" art={<MapArt />} title="Explore the field">
              A theme map and a citation graph show how the results connect. Add any of them as a seed and search
              again, or export them to Zotero, EndNote or a spreadsheet.
            </Step>
          </ol>
        </section>

        {run && <RealSearch run={run} />}

        <footer className="foot">
          <span>PubMed, iCite, Europe PMC and Tavily · Qwen3 and Nemotron on Nebius Token Factory</span>
          <a href="/docs">API reference</a>
        </footer>
      </main>
    </>
  );
}

function Step({ n, band, art, title, children }: { n: number; band: string; art: ReactNode; title: string; children: ReactNode }) {
  return (
    <li>
      <div className={`band ${band}`} aria-hidden="true">{art}</div>
      <div className="how-body">
        <h3><span className="n">{n}</span>{title}</h3>
        <p>{children}</p>
      </div>
    </li>
  );
}

/** The recorded run in miniature: its question, its top three, and the way in. */
function RealSearch({ run }: { run: Discovery }) {
  const seconds = Math.round(Object.values(run.timings).reduce((a, b) => a + b, 0));
  const facts = [plural(run.seeds.length, "seed"), run.stats.pool != null && `${run.stats.pool.toLocaleString()} screened`, `${seconds} s`];
  return (
    <section className="section">
      <h2>A real search</h2>
      <p className="lead">Recorded with the live engine, so it opens instantly and needs no API key.</p>
      <div className="run">
        <p className="run-q">“{run.question}”</p>
        <ol className="top-list">
          {run.results.slice(0, 3).map((r) => (
            <li key={r.id}>
              <span className="g">{r.grade ?? "–"} · {r.grade != null ? GRADES[r.grade] : "Unjudged"}</span>
              <div><Link to={`/recorded?paper=${encodeURIComponent(r.id)}`}>{r.title}</Link>
                <p className="top-meta">{[r.venue, r.year].filter(Boolean).join(" · ")}</p>
                {r.quote && <p className="top-quote">“{r.quote}”</p>}</div>
            </li>
          ))}
        </ol>
        <div className="run-foot">
          <span>{facts.filter(Boolean).join(" · ")}</span>
          <Link className="btn utility" to="/recorded">See all {run.results.length} results</Link>
        </div>
      </div>
    </section>
  );
}

function SeedsArt() {
  return (
    <svg viewBox="0 0 150 84">
      <path d="M45 44L20 20M45 44L28 70M45 44L80 58M105 34L80 58M105 34L130 18M105 34L128 64M45 44L105 34" stroke="var(--ink)" strokeOpacity=".25" strokeWidth="1.5" fill="none" />
      <circle cx="20" cy="20" r="6" fill="#2a9d99" /><circle cx="28" cy="70" r="7" fill="#62aef0" /><circle cx="80" cy="58" r="8" fill="#dd5b00" />
      <circle cx="130" cy="18" r="5" fill="#1aae39" /><circle cx="128" cy="64" r="6" fill="#ff64c8" />
      <path d="M45 35L54 44L45 53L36 44Z M105 25L114 34L105 43L96 34Z" fill="var(--ink)" />
    </svg>
  );
}

function GradeArt() {
  return (
    <svg viewBox="0 0 150 84">
      <rect x="12" y="16" width="34" height="40" rx="6" fill="var(--surface)" />
      <text x="29" y="40" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="18" fontWeight="700" fill="var(--ink)">4</text>
      <g fill="var(--ink)">{[18, 24.5, 31, 37.5].map((x) => <rect key={x} x={x} y="46" width="5" height="2" rx="1" />)}</g>
      <rect x="56" y="18" width="3" height="34" rx="1.5" fill="var(--ink)" />
      <g fill="var(--ink)" opacity=".35"><rect x="66" y="20" width="72" height="5" rx="2.5" /><rect x="66" y="31" width="64" height="5" rx="2.5" /><rect x="66" y="42" width="48" height="5" rx="2.5" /></g>
      <circle cx="72" cy="66" r="6" fill="#1aae39" /><path d="M69.3 66.2l1.8 1.8 3.6-3.8" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <rect x="82" y="63.5" width="50" height="5" rx="2.5" fill="#1aae39" opacity=".5" />
    </svg>
  );
}

function MapArt() {
  return (
    <svg viewBox="0 0 150 84">
      <g fill="#2a9d99"><circle cx="26" cy="26" r="6" /><circle cx="38" cy="34" r="5" /><circle cx="22" cy="40" r="4" /></g>
      <g fill="#dd5b00"><circle cx="100" cy="22" r="6" /><circle cx="114" cy="30" r="5" /><circle cx="104" cy="36" r="4" /></g>
      <g fill="#62aef0"><circle cx="64" cy="62" r="6" /><circle cx="78" cy="68" r="5" /><circle cx="58" cy="72" r="4" /></g>
      <path d="M38 34L64 62M100 22L78 68M38 34L100 22" stroke="var(--ink)" strokeOpacity=".3" strokeWidth="1.3" />
      <path d="M128 52L136 60L128 68L120 60Z" fill="var(--ink)" />
    </svg>
  );
}
