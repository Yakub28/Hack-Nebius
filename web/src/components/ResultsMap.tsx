import { useMemo, useState } from "react";
import type { Discovery, Result } from "../api/types";
import { GRADES } from "../lib/format";

const W = 1000;
const H = 560;
const PAD = 40;

/** Nearby = similar content (a 2D projection of the ranking embeddings); colour = theme; size = grade. */
export function ResultsMap({ data, list, selected, onOpen }: {
  data: Discovery; list: Result[]; selected: string | null; onOpen: (id: string) => void;
}) {
  const map = data.map!;
  const [hover, setHover] = useState<Result | null>(null);
  const at = (id: string): [number, number] | null => {
    const p = map.points[id];
    return p ? [PAD + p[0] * (W - 2 * PAD), PAD + (1 - p[1]) * (H - 2 * PAD)] : null;
  };
  const visible = list.filter((r) => at(r.id));
  const seedIds = useMemo(() => new Set(data.seeds.map((s) => s.id)), [data.seeds]);
  const shown = new Set([...seedIds, ...visible.map((r) => r.id)]);

  // Every citation at once is a hairball: the links to the seeds, and all of the selected paper's.
  const edges = map.edges.filter((e) => shown.has(e.from) && shown.has(e.to))
    .filter((e) => e.from === selected || e.to === selected || seedIds.has(e.from) || seedIds.has(e.to));

  const labels = map.themes.map((t) => {
    const pts = visible.filter((r) => r.theme === t.id).map((r) => at(r.id)!);
    if (!pts.length) return null;
    const x = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
    const y = Math.min(...pts.map((p) => p[1])) - 18;     // above the cluster, not on its densest point
    return { id: t.id, name: t.name, x: Math.min(Math.max(x, 90), W - 90), y: Math.max(y, 16) };
  }).filter(Boolean) as { id: number; name: string; x: number; y: number }[];

  const hoverAt = hover && at(hover.id);
  const namedBy = map.themes[0]?.named_by;

  return (
    <section className="panel map-panel">
      <div className="map-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Map of the results" onMouseLeave={() => setHover(null)}>
          <g>
            {edges.map((e, i) => {
              const a = at(e.from)!;
              const b = at(e.to)!;
              const focus = e.from === selected || e.to === selected;
              return <line key={i} className={`edge${focus ? " focus" : ""}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
            })}
          </g>
          <g>
            {visible.map((r) => {
              const [x, y] = at(r.id)!;
              const below = data.cutoff != null && !r.likely_relevant;
              return (
                <circle key={r.id} className={`node${below ? " below" : ""}${r.id === selected ? " selected" : ""}`}
                  cx={x} cy={y} r={4.5 + 1.8 * (r.grade ?? 0)} style={{ fill: r.theme == null ? "var(--faint)" : `var(--t${r.theme})` }}
                  tabIndex={0} role="button" aria-label={`${r.title}, ${r.grade == null ? "not graded" : `grade ${r.grade}`}`}
                  onMouseEnter={() => setHover(r)} onFocus={() => setHover(r)} onBlur={() => setHover(null)}
                  onClick={() => onOpen(r.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r.id); } }} />
              );
            })}
          </g>
          <g>
            {data.seeds.map((s) => {
              const p = at(s.id);
              if (!p) return null;
              const [x, y] = p;
              return (
                <g key={s.id} className="seed">
                  <path d={`M${x} ${y - 9}L${x + 9} ${y}L${x} ${y + 9}L${x - 9} ${y}Z`}><title>{`${s.label}: ${s.title}`}</title></path>
                  <text x={x + 12} y={y + 5}>{s.label}</text>
                </g>
              );
            })}
          </g>
          <g>{labels.map((l) => <text key={l.id} className="theme-label" x={l.x} y={l.y} textAnchor="middle">{l.name}</text>)}</g>
        </svg>
        {hover && hoverAt && (
          <div className={`map-tip${hoverAt[1] < H * 0.3 ? " below" : ""}`} style={{ left: `${(hoverAt[0] / W) * 100}%`, top: `${(hoverAt[1] / H) * 100}%` }}>
            <b>{hover.title}</b>
            <span>{hover.grade == null ? "Not graded" : `${hover.grade} · ${GRADES[hover.grade]}`}{hover.year ? ` · ${hover.year}` : ""}{hover.venue ? ` · ${hover.venue}` : ""}</span>
          </div>
        )}
      </div>
      <p className="note">
        Nearby papers have similar content (a 2D projection of the Qwen3 embeddings).
        {namedBy && ` Colour is the theme, named by ${namedBy === "llm" ? "the LLM from the titles" : "the most distinctive title words"}.`}
        {" "}Size is the LLM grade, faded dots are below your seeds' grade, ◆ are your seeds, and lines are citations of them.
        {" "}{visible.length ? "Click a paper to open it and see all its citations." : "No results match these filters."}
      </p>
    </section>
  );
}
