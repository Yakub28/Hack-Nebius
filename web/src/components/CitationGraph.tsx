import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-3d";
import type { Discovery, Result } from "../api/types";
import { GRADES } from "../lib/format";

/* three.js is several hundred KB that only this view needs: lazy, so the rest of the app never pays for it. */
const ForceGraph3D = lazy(() => import("react-force-graph-3d"));

// The map's theme colours (the sticker palette, see app.css), as hex for WebGL.
const THEME_HEX = ["#2a9d99", "#dd5b00", "#62aef0", "#ff64c8", "#1aae39", "#d6b6f6"];
const SEED_HEX = "#ffffff";
// The night band from design.md: the one dark island, and the palette reads far better against it.
const NIGHT = "#141d52";

interface Node {
  id: string;
  name: string;
  color: string;
  val: number;
  seed: boolean;
}

/** The results and seeds as a force-directed citation network: what cites what, in 3D. Drag to orbit,
 *  scroll to zoom, click a paper to open it. */
export function CitationGraph({ data, list, selected, onOpen }: {
  data: Discovery; list: Result[]; selected: string | null; onOpen: (id: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraphMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 560 });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const update = () => setSize({ width: Math.round(el.getBoundingClientRect().width), height: 560 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graphData = useMemo(() => {
    const nodes: Node[] = [
      ...data.seeds.map((s) => ({ id: s.id, name: `${s.label} · seed: ${s.title}`, color: SEED_HEX, val: 9, seed: true })),
      ...list.map((r) => ({
        id: r.id, color: r.theme == null ? "#9aa3b5" : THEME_HEX[r.theme % THEME_HEX.length], val: 1.5 + (r.grade ?? 0) * 1.2, seed: false,
        name: `${r.title} · ${r.grade == null ? "not graded" : `${r.grade} · ${GRADES[r.grade]}`}`,
      })),
    ];
    const ids = new Set(nodes.map((n) => n.id));
    const links = (data.map?.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ source: e.from, target: e.to }));
    return { nodes, links };
  }, [data, list]);

  const touches = (link: { source: unknown; target: unknown }) => {
    const id = (end: unknown) => (typeof end === "object" && end ? (end as Node).id : end);
    return selected != null && (id(link.source) === selected || id(link.target) === selected);
  };

  return (
    <section className="graph-panel">
      <div className="graph-canvas" ref={wrap}>
        {size.width > 0 && (
          <Suspense fallback={<div className="graph-loading">Loading the 3D view…</div>}>
            <ForceGraph3D
              ref={graph}
              width={size.width}
              height={size.height}
              graphData={graphData}
              backgroundColor={NIGHT}
              showNavInfo={false}
              nodeLabel={(n: object) => `<div class="graph-tip">${escapeHtml((n as Node).name)}</div>`}
              nodeColor={(n: object) => ((n as Node).id === selected ? "#ffd84d" : (n as Node).color)}
              nodeVal={(n: object) => (n as Node).val}
              nodeOpacity={0.95}
              nodeResolution={16}
              linkColor={(l: object) => (touches(l as { source: unknown; target: unknown }) ? "#ffd84d" : "rgba(255,255,255,0.28)")}
              linkWidth={(l: object) => (touches(l as { source: unknown; target: unknown }) ? 1.6 : 0.4)}
              linkDirectionalArrowLength={2.5}
              linkDirectionalArrowRelPos={1}
              linkDirectionalParticles={(l: object) => (touches(l as { source: unknown; target: unknown }) ? 3 : 0)}
              linkDirectionalParticleWidth={1.6}
              onNodeClick={(n: object) => { if (!(n as Node).seed) onOpen((n as Node).id); }}
              cooldownTicks={120}
              onEngineStop={() => graph.current?.zoomToFit(500, 40)}
            />
          </Suspense>
        )}
      </div>
      <p className="graph-legend">
        <span><i className="swatch seed" /> your seeds</span>
        <span><i className="swatch" /> results, coloured by theme, sized by grade</span>
        <span>arrows point from the citing paper to the cited one · drag to orbit · scroll to zoom · click to open</span>
      </p>
    </section>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}
