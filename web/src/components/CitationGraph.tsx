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
const FADED = "#2c3670";
const FOCUS = "#ffd84d";

interface Node {
  id: string;
  name: string;
  color: string;
  val: number;
  seed: boolean;
  x?: number;
  y?: number;
  z?: number;
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

  const endId = (end: unknown) => (typeof end === "object" && end ? (end as Node).id : end);
  const touches = (link: { source: unknown; target: unknown }) =>
    selected != null && (endId(link.source) === selected || endId(link.target) === selected);
  // With a paper open, the graph is about that paper: its citation neighbours keep their colour, the rest fade.
  const near = useMemo(() => {
    if (!selected) return null;
    const ids = new Set([selected]);
    graphData.links.forEach((l) => { if (touches(l)) { ids.add(endId(l.source) as string); ids.add(endId(l.target) as string); } });
    return ids;
  }, [selected, graphData]);

  // ...and the camera flies to it, close enough to read its neighbourhood.
  useEffect(() => {
    const node = graphData.nodes.find((n) => n.id === selected);
    if (!node || node.x == null || !graph.current) return;
    const ratio = 1 + 90 / Math.max(1, Math.hypot(node.x, node.y ?? 0, node.z ?? 0));
    graph.current.cameraPosition({ x: node.x * ratio, y: (node.y ?? 0) * ratio, z: (node.z ?? 0) * ratio }, node as { x: number; y: number; z: number }, 900);
  }, [selected, graphData]);

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
              nodeColor={(n: object) => ((n as Node).id === selected ? FOCUS : near && !near.has((n as Node).id) ? FADED : (n as Node).color)}
              nodeVal={(n: object) => (n as Node).val}
              nodeOpacity={0.95}
              nodeResolution={16}
              linkColor={(l: object) => (touches(l as { source: unknown; target: unknown }) ? FOCUS : near ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.28)")}
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
        <span>arrows point from the citing paper to the cited one · drag to orbit · scroll to zoom · click a paper to focus on it</span>
      </p>
    </section>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}
