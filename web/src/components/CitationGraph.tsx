import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import * as THREE from "three";
import type { Discovery, Result } from "../api/types";
import { GRADES } from "../lib/format";

// The map's theme hues (the sticker palette, see app.css) at one lightness (OKLCH L 0.80, C 0.12): the stickers
// mix light and dark tones, and on the night canvas the dark ones (teal, green) read as less important papers.
const THEME_HEX = ["#47d6cf", "#f9a870", "#78c6ff", "#f89dc9", "#83d494", "#d0aafc"];
const SEED_HEX = "#ffffff";
const UNTHEMED = "#b4bccf";
// One neutral for every faded paper: fading each hue toward the night turned orange brown and pink maroon.
const FADED = "#4c546c";
const FOCUS = "#ffd84d";
// three-forcegraph places arrowheads from nodeVal and its default nodeRelSize (4): our spheres use the same radius.
const REL_SIZE = 4;

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

/** One node's scene object and the materials a selection change repaints, so focusing a paper never rebuilds the scene. */
interface Look {
  group: THREE.Group;
  core: THREE.MeshStandardMaterial;
  halo: THREE.Sprite;
  ring: THREE.Sprite | null;
  color: THREE.Color;
  r: number;
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
        id: r.id, color: r.theme == null ? UNTHEMED : THEME_HEX[r.theme % THEME_HEX.length], val: 1.5 + (r.grade ?? 0) * 1.2, seed: false,
        name: `${r.title} · ${r.grade == null ? "not graded" : `${r.grade} · ${GRADES[r.grade]}`}`,
      })),
    ];
    const ids = new Set(nodes.map((n) => n.id));
    const links = (data.map?.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ source: e.from, target: e.to }));
    return { nodes, links };
  }, [data, list]);

  const looks = useMemo(() => new Map(graphData.nodes.map((n) => [n.id, makeLook(n)])), [graphData]);
  const nodeObject = useCallback((n: object) => looks.get((n as Node).id)!.group, [looks]);

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

  useEffect(() => {
    looks.forEach((look, id) => paint(look, id === selected ? "focus" : near && !near.has(id) ? "faded" : "rest"));
  }, [looks, selected, near]);

  // The default springs (30) pack a few dozen papers into a knot: longer links and a stronger repulsion give
  // each citation room to read as an arrow.
  const mounted = size.width > 0;
  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    g.d3Force("link")?.distance(70);
    g.d3Force("charge")?.strength(-90);
    g.d3ReheatSimulation();
  }, [mounted, graphData]);

  // A sparse, dim starfield far behind the graph: it turns with the camera, so orbiting reads as moving through space.
  useEffect(() => {
    const scene = graph.current?.scene();
    if (!scene) return;
    const stars = makeStars();
    scene.add(stars);
    return () => { scene.remove(stars); stars.geometry.dispose(); (stars.material as THREE.Material).dispose(); };
  }, [mounted]);

  // ...and the camera flies to it, close enough to read its neighbourhood.
  useEffect(() => {
    const node = graphData.nodes.find((n) => n.id === selected);
    if (!node || node.x == null || !graph.current) return;
    const ratio = 1 + 120 / Math.max(1, Math.hypot(node.x, node.y ?? 0, node.z ?? 0));
    graph.current.cameraPosition({ x: node.x * ratio, y: (node.y ?? 0) * ratio, z: (node.z ?? 0) * ratio }, node as { x: number; y: number; z: number }, 900);
  }, [selected, graphData]);

  return (
    <section className="graph-panel">
      <div className="graph-canvas" ref={wrap}>
        {mounted && (
          <ForceGraph3D
            ref={graph}
            width={size.width}
            height={size.height}
            graphData={graphData}
            backgroundColor="rgba(0,0,0,0)"
            showNavInfo={false}
            nodeLabel={(n: object) => `<div class="graph-tip">${escapeHtml((n as Node).name)}</div>`}
            nodeThreeObject={nodeObject}
            nodeVal={(n: object) => (n as Node).val}
            nodeRelSize={REL_SIZE}
            linkOpacity={1}
            linkColor={(l: object) => (touches(l as { source: unknown; target: unknown }) ? "rgba(255,216,77,0.9)" : near ? "rgba(170,185,255,0.07)" : "rgba(170,185,255,0.3)")}
            linkWidth={(l: object) => (touches(l as { source: unknown; target: unknown }) ? 1.2 : 0.35)}
            linkDirectionalArrowLength={5}
            linkDirectionalArrowRelPos={1}
            linkDirectionalArrowResolution={12}
            linkDirectionalArrowColor={(l: object) => (touches(l as { source: unknown; target: unknown }) ? FOCUS : near ? "rgba(170,185,255,0.03)" : "rgba(170,185,255,0.2)")}
            linkDirectionalParticles={(l: object) => (touches(l as { source: unknown; target: unknown }) ? 3 : 0)}
            linkDirectionalParticleWidth={1.8}
            linkDirectionalParticleColor={() => FOCUS}
            onNodeClick={(n: object) => { if (!(n as Node).seed) onOpen((n as Node).id); }}
            cooldownTicks={160}
            onEngineStop={() => graph.current?.zoomToFit(500, 40)}
          />
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

/** A glossy sphere with a soft additive halo (and a ring for seeds): the palette glows against the night like
 *  the sticker constellations in design.md. */
function makeLook(n: Node): Look {
  const r = Math.cbrt(n.val) * REL_SIZE;
  const color = new THREE.Color(n.color);
  const core = new THREE.MeshStandardMaterial({ color, emissive: color, roughness: 0.4, metalness: 0, transparent: true });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), core));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture("glow"), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  group.add(halo);
  let ring: THREE.Sprite | null = null;
  if (n.seed) {
    ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture("ring"), color, transparent: true, depthWrite: false }));
    ring.scale.setScalar(r * 3);
    group.add(ring);
  }
  const look = { group, core, halo, ring, color, r };
  paint(look, "rest");
  return look;
}

function paint(look: Look, state: "rest" | "focus" | "faded") {
  const { core, halo, ring, r } = look;
  const color = state === "focus" ? new THREE.Color(FOCUS) : look.color;
  core.color.set(state === "faded" ? FADED : color);
  core.emissive.copy(color);
  core.emissiveIntensity = state === "faded" ? 0 : state === "focus" ? 0.35 : 0.08;
  core.opacity = state === "faded" ? 0.3 : 1;
  core.depthWrite = state !== "faded";
  halo.visible = state !== "faded";
  halo.material.color.copy(color);
  halo.material.opacity = state === "focus" ? 1 : 0.6;
  halo.scale.setScalar(r * (state === "focus" ? 7 : 5));
  if (ring) ring.material.opacity = state === "faded" ? 0.15 : 0.7;
}

// Shared canvas textures: a radial glow and a thin ring. three.js re-uploads one if a removed node disposed it.
const textures: Partial<Record<"glow" | "ring", THREE.CanvasTexture>> = {};
function texture(kind: "glow" | "ring"): THREE.CanvasTexture {
  if (textures[kind]) return textures[kind];
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  if (kind === "glow") {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    // At rest the sphere's edge sits at 0.4 of this radius, so the falloff has to happen outside it.
    [[0, 1], [0.3, 0.85], [0.42, 0.5], [0.6, 0.16], [0.8, 0.04], [1, 0]].forEach(([at, a]) => g.addColorStop(at, `rgba(255,255,255,${a})`));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  } else {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.stroke();
  }
  textures[kind] = new THREE.CanvasTexture(canvas);
  textures[kind].colorSpace = THREE.SRGBColorSpace;
  return textures[kind];
}

function makeStars(): THREE.Points {
  const count = 450;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(1800 + Math.random() * 1600);
    positions.set([v.x, v.y, v.z], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: "#c9d4ff", size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false,
  }));
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}
