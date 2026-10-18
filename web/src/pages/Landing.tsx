import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Discovery } from "../api/types";
import { GRADES } from "../lib/format";

/** The hero's constellation is a citation graph: two seeds (diamonds) and the papers they lead to. */
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
  useEffect(() => { document.title = "Paper Discovery"; api.recorded().then(setRun).catch(() => {}); }, []);

  const top10 = run?.results.slice(0, 10) ?? [];
  const total = run ? Math.round(Object.values(run.timings).reduce((a, b) => a + b, 0)) : 110;
  const webOnly = run?.results.filter((r) => r.channels.length === 1 && r.channels[0] === "web").length ?? 0;

  return (
    <>
      <section className="hero-band">
        <div className="hero-inner">
          <div>
            <span className="badge">Biomedical literature · Nebius Token Factory</span>
            <h1>Start from the papers you trust.</h1>
            <p>Give a research question and a few seed papers. Watch Paper Discovery follow their citations, search
              PubMed, preprints and the web, and rank new papers live, each with where it was found and a quote
              that shows why.</p>
            <div className="cta-row">
              <Link className="btn primary" to="/search">Start a search</Link>
              <Link className="btn secondary" to="/recorded">See a recorded run</Link>
            </div>
          </div>
          <Constellation />
        </div>
      </section>

      <main className="page">
        <section className="section">
          <h2>Every result is a real record, and shows its work.</h2>
          <p className="lead">Each paper comes from PubMed or Europe PMC, found by following your seeds' citations and by
            searching for what they describe. Nothing comes from the model's memory.</p>
          <div className="features">
            <Feature band="sky" title="Find what your seeds point to" ask="Which papers belong next to the ones I already trust?"
              cta={<Link className="go" to="/search">Start a search →</Link>} art={<SeedsArt />}>
              <li>Follows the seeds' <strong>citations both ways</strong>, plus papers co-cited with them.</li>
              <li>PubMed's own <strong>similar articles</strong> for every seed.</li>
              <li><strong>LLM-written PubMed searches</strong>: one per seed, plus the facets of your question.</li>
              <li>Preprints, and a <strong>web search agent</strong> that reads what it finds and picks its next searches.</li>
            </Feature>
            <Feature band="purple" title="See why each paper is there" ask="Can I trust a result without reading the whole paper?"
              cta={<Link className="go" to="/recorded">See a recorded run →</Link>} art={<GradeArt />}>
              <li>An LLM <strong>grades every strong candidate 0–4</strong> against criteria drawn from your question.</li>
              <li>Your seeds are graded too, which draws a <strong>relevance line</strong>: above it, as relevant as your seeds.</li>
              <li>Each result quotes its abstract, and the quote is <strong>checked word for word</strong>.</li>
              <li>Every link to a seed is <strong>a citation or a similarity score</strong> you can check.</li>
            </Feature>
            <Feature band="orange" title="Explore what it found" ask="Where should I start reading?"
              cta={<Link className="go" to="/recorded?view=graph">Open the citation graph →</Link>} art={<MapArt />}>
              <li>A <strong>theme map</strong> and a <strong>3D citation graph</strong> of the results and your seeds.</li>
              <li>Open any paper to walk <strong>its citations</strong> among the results, with its full abstract.</li>
              <li><strong>Add any result as a seed</strong> and run again to follow it further.</li>
              <li>Import your <strong>Zotero, EndNote or PubMed</strong> export; export the results as RIS or CSV.</li>
            </Feature>
          </div>
        </section>

        <section className="section">
          <h2>How it works</h2>
          <p className="lead">Six steps in about two minutes, streamed to your screen as they happen.</p>
          <ol className="steps">
            <li><b><span className="n">1</span>Resolve</b>Seeds, typed in or imported from a reference manager, are found in PubMed, or in Europe PMC for preprints.</li>
            <li><b><span className="n">2</span>Plan</b>The LLM turns the question and seeds into inclusion criteria and search queries.</li>
            <li><b><span className="n">3</span>Collect</b>Seven channels gather candidates, the web agent among them. Each records where it came from.</li>
            <li><b><span className="n">4</span>Rank</b>Embedding similarity to each seed and to the question, fused with citation signals.</li>
            <li><b><span className="n">5</span>Judge</b>The strongest ~130 candidates are graded against the criteria, each with a verified quote.</li>
            <li><b><span className="n">6</span>Explore</b>Trials and web context for the top results, a theme map and a citation graph.</li>
          </ol>
        </section>

        <section className="section">
          <h2>One recorded run</h2>
          <p className="lead">Real engine output, saved so it opens instantly. Open it to see every card, the map, the graph and the web agent's searches.</p>
          <div className="run">
            <p className="run-q">“{run?.question ?? "Which incretin-based drugs reduce body weight in adults with obesity?"}”
              {" "}<span className="muted">with STEP 1 and SURMOUNT-1 as seeds</span></p>
            <div className="metrics">
              <div className="metric"><span>Candidates screened</span><b>{run?.stats.pool?.toLocaleString() ?? "667"}</b></div>
              <div className="metric"><span>Graded by the LLM</span><b>{run?.stats.judged ?? 128}</b></div>
              <div className="metric"><span>Top 10 graded 4 of 4</span><b>{run ? `${top10.filter((r) => r.grade === 4).length} / ${top10.length}` : "10 / 10"}</b></div>
              <div className="metric"><span>End to end</span><b>{total} s</b></div>
            </div>
            {run && (
              <ol className="top-list">
                {run.results.slice(0, 3).map((r) => (
                  <li key={r.id}>
                    <span className="g">{r.grade ?? "–"} · {r.grade != null ? GRADES[r.grade] : "Unjudged"}</span>
                    <div><Link to={`/recorded?paper=${encodeURIComponent(r.id)}`}>{r.title}</Link>
                      <p className="why">{[r.venue, r.year].filter(Boolean).join(" · ")} · found {r.found_via.length} ways</p></div>
                  </li>
                ))}
                {webOnly > 0 && <li><span /><p className="why">…and {webOnly} of the {run.results.length} were found only by the web search agent.</p></li>}
              </ol>
            )}
            <div className="run-foot">
              <span>{run?.recorded ? `Recorded on ${run.recorded}, with ${run.results.length} results.` : "Recorded with the current engine."}</span>
              <Link className="btn utility" to="/recorded">Open the full run</Link>
            </div>
          </div>
        </section>

        <footer className="foot">
          <div className="foot-cols">
            <div><h3>Sources</h3><ul><li>PubMed E-utilities</li><li>NIH iCite</li><li>Europe PMC</li><li>Tavily web search</li></ul></div>
            <div><h3>Models</h3><ul><li>Qwen3-Embedding-8B for retrieval</li><li>Qwen3-235B as judge, planner and agent</li><li>Both on Nebius Token Factory</li></ul></div>
            <div><h3>API</h3><ul><li><a href="/docs">Reference (/docs)</a></li><li><code>POST /discover/stream</code></li><li><code>POST /collection</code></li><li><code>GET /health</code></li></ul></div>
            <div><h3>Run it</h3><ul><li><code>NEBIUS_API_KEY</code> is required</li><li><code>TAVILY_API_KEY</code> for the web agent</li><li><code>NCBI_API_KEY</code> for faster PubMed</li></ul></div>
          </div>
        </footer>
      </main>
    </>
  );
}

function Feature({ band, title, ask, art, cta, children }: {
  band: string; title: string; ask: string; art: React.ReactNode; cta: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <article className="feature">
      <div className={`band ${band}`} aria-hidden="true">{art}</div>
      <div className="feature-body">
        <h3>{title}</h3>
        <p className="ask">{ask}</p>
        <ul>{children}</ul>
        {cta}
      </div>
    </article>
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
