import { useEffect, useRef } from "react";

/* The landing hero's backdrop: a live sketch of what a search does. Two seeds (white diamonds) and the papers
 * they lead to, clustered by theme in the map's colours. Solid lines are citations, dashed ones similar
 * content. Papers drift, gather toward the pointer the way a query gathers results, and carry a depth that
 * sets size, brightness, glow and parallax together, so the field reads as a volume rather than confetti.
 *
 * Adapted from Axiom's CorpusField. The rules it keeps: the canvas never takes a click (the pointer is tracked
 * on the band), the loop stops when the tab is hidden or the band scrolls away, reduced motion gets one settled
 * frame instead of an animation, and anything the browser lacks (no 2D context, no observers) means nothing is
 * drawn rather than an error. */

// Below this the hero is one column and every node would sit under text; the static SVG takes over (app.css).
const MIN_WIDTH = 1080;
const CONTENT_MAX = 1200;        // .hero-inner's max-width, so clusters line up with the grid at any width
const CONTENT_PAD = 32;

// Positions are fractions of the content box (x) and the band's height (y); spread is a fraction of its width.
const SEEDS = [
  { label: "S1", fx: 0.64, fy: 0.42 },
  { label: "S2", fx: 0.88, fy: 0.6 },
];
// Theme colours as RGB, from the sticker palette (--t0…--t5). `seed` is the seed whose citations these are.
// The themes overlap on purpose: one body of literature with a few centres reads better than separate islands.
const THEMES = [
  { rgb: "42, 157, 153", fx: 0.6, fy: 0.24, spread: 0.085, seed: 0 },   // teal
  { rgb: "221, 91, 0", fx: 0.7, fy: 0.72, spread: 0.08, seed: 0 },      // orange
  { rgb: "214, 182, 246", fx: 0.77, fy: 0.46, spread: 0.06, seed: 0 },  // purple, between the two seeds
  { rgb: "98, 174, 240", fx: 0.84, fy: 0.24, spread: 0.08, seed: 1 },   // sky
  { rgb: "255, 100, 200", fx: 0.98, fy: 0.42, spread: 0.065, seed: 1 }, // pink
  { rgb: "26, 174, 57", fx: 0.92, fy: 0.82, spread: 0.07, seed: 1 },    // green
];

const HUB = 0.74;                // depth above which a paper glows
const MIN_SEPARATION = 48;       // closer than this, papers push apart: without it each cluster collapses to a knot
const LINK = 80;                 // papers closer than this are drawn linked
const POINTER_RADIUS = 160;
const CITED_PER_SEED = 7;

interface Paper {
  x: number; y: number; vx: number; vy: number;
  homeX: number; homeY: number;
  r: number;
  depth: number;                 // 0 = far and faint, 1 = a foreground hub
  theme: number;
  phase: number;                 // so the breathing isn't in unison
}

export function SeedField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.("2d");
    const band = canvas?.parentElement;
    if (!canvas || !ctx || !band) return;
    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0, height = 0, frame = 0;
    let papers: Paper[] = [];
    let seeds: { x: number; y: number; label: string }[] = [];
    let cited: number[][] = [];  // per seed, indexes into papers
    let running = false, visible = true, rafId = 0;
    const pointer = { x: -9999, y: -9999, active: false };
    const tilt = { x: 0, y: 0 };  // eased pointer offset from the band's centre, for parallax

    function seed() {
      const rect = band!.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);   // 3x costs 2.25x the fill for nothing visible
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      papers = []; seeds = []; cited = [];
      if (width < MIN_WIDTH) return;

      const cw = Math.min(width, CONTENT_MAX) - 2 * CONTENT_PAD;
      const left = (width - cw) / 2;
      const at = (fx: number, fy: number) => ({ x: left + fx * cw, y: fy * height });
      seeds = SEEDS.map((s) => ({ ...at(s.fx, s.fy), label: s.label }));

      const total = width < 1300 ? 56 : 70;
      papers = Array.from({ length: total }, (_, i) => {
        const theme = i % THEMES.length;
        const home = at(THEMES[theme].fx, THEMES[theme].fy);
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * cw * THEMES[theme].spread;   // sqrt: an even disc, not a clump
        // Squared, so most papers sit back and a few come forward; linear reads as a flat haze.
        const depth = Math.random() ** 2;
        return {
          x: home.x + Math.cos(angle) * radius, y: home.y + Math.sin(angle) * radius,
          vx: (Math.random() - 0.5) * (0.1 + depth * 0.22), vy: (Math.random() - 0.5) * (0.1 + depth * 0.22),
          homeX: home.x, homeY: home.y, r: 1.3 + depth * 7.5, depth, theme, phase: Math.random() * Math.PI * 2,
        };
      });
      papers.sort((a, b) => a.depth - b.depth);   // painter's order, once: depth never changes

      // Each seed cites a fixed handful of its themes' papers, the nearer (larger) ones first, so its lines
      // don't flicker between neighbours as the papers drift.
      cited = SEEDS.map((_, s) => papers.map((p, i) => [p, i] as const)
        .filter(([p]) => THEMES[p.theme].seed === s)
        .sort(([a], [b]) => b.depth - a.depth).slice(0, CITED_PER_SEED).map(([, i]) => i));
    }

    function step(draw = true) {
      for (const p of papers) {
        p.x += p.vx; p.y += p.vy;
        // A weak spring home keeps the themes legible forever instead of smearing into noise.
        p.vx += (p.homeX - p.x) * 0.00024;
        p.vy += (p.homeY - p.y) * 0.00024;
        if (pointer.active) {
          const dx = pointer.x - p.x, dy = pointer.y - p.y, dist = Math.hypot(dx, dy);
          if (dist < POINTER_RADIUS && dist > 1) {
            // Foreground papers swing further: the depth shows in the motion, not only in the size.
            const pull = (1 - dist / POINTER_RADIUS) * 0.04 * (0.35 + p.depth);
            p.vx += (dx / dist) * pull;
            p.vy += (dy / dist) * pull;
          }
        }
        for (const s of seeds) {   // the seeds hold their ground; papers keep clear of the diamonds
          const dx = p.x - s.x, dy = p.y - s.y, dist = Math.hypot(dx, dy);
          if (dist < 30 && dist > 0.01) { p.vx += (dx / dist) * 0.05; p.vy += (dy / dist) * 0.05; }
        }
        p.vx = Math.max(-0.9, Math.min(0.9, p.vx * 0.992));
        p.vy = Math.max(-0.9, Math.min(0.9, p.vy * 0.992));
      }
      for (let i = 0; i < papers.length; i++) {
        for (let j = i + 1; j < papers.length; j++) {
          const a = papers[i], b = papers[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          if (dx > MIN_SEPARATION || dx < -MIN_SEPARATION || dy > MIN_SEPARATION || dy < -MIN_SEPARATION) continue;
          const dist = Math.hypot(dx, dy);
          if (dist >= MIN_SEPARATION || dist < 0.01) continue;
          const push = (1 - dist / MIN_SEPARATION) * 0.02;
          a.vx += (dx / dist) * push; a.vy += (dy / dist) * push;
          b.vx -= (dx / dist) * push; b.vy -= (dy / dist) * push;
        }
      }
      if (draw) paint();
      frame++;
    }

    function paint() {
      ctx!.clearRect(0, 0, width, height);
      if (!papers.length) return;
      // Parallax: the near layer shifts with the pointer, the far one against it.
      const goal = pointer.active ? { x: (pointer.x - width / 2) / width, y: (pointer.y - height / 2) / height } : { x: 0, y: 0 };
      tilt.x += (goal.x - tilt.x) * 0.05;
      tilt.y += (goal.y - tilt.y) * 0.05;
      const sx = (p: Paper) => p.x + tilt.x * 26 * (p.depth - 0.4);
      const sy = (p: Paper) => p.y + tilt.y * 18 * (p.depth - 0.4);
      const seedAt = (s: { x: number; y: number }) => ({ x: s.x + tilt.x * 14, y: s.y + tilt.y * 10 });

      // The two seeds are similar, not citing: dashed, like the map's legend.
      const [s1, s2] = seeds.map(seedAt);
      ctx!.setLineDash([4, 6]);
      ctx!.strokeStyle = "rgba(255, 255, 255, 0.4)";
      ctx!.lineWidth = 1.2;
      ctx!.beginPath(); ctx!.moveTo(s1.x, s1.y); ctx!.lineTo(s2.x, s2.y); ctx!.stroke();

      for (let i = 0; i < papers.length; i++) {
        const a = papers[i];
        for (let j = i + 1; j < papers.length; j++) {
          const b = papers[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          if (dx > LINK || dx < -LINK || dy > LINK || dy < -LINK) continue;
          const dist = Math.hypot(dx, dy);
          if (dist > LINK) continue;
          const closeness = 1 - dist / LINK;
          const depth = Math.max(a.depth, b.depth);   // a line is as near as its nearer end
          if (a.theme === b.theme) {
            ctx!.setLineDash([]);
            ctx!.strokeStyle = `rgba(${THEMES[a.theme].rgb}, ${closeness * (0.16 + depth * 0.6)})`;
            ctx!.lineWidth = 0.5 + depth * 1.6;
          } else {
            if ((i * 31 + j * 17) % 3 !== 0) continue;   // similarity across themes is the rarer link
            ctx!.setLineDash([3, 5]);
            ctx!.strokeStyle = `rgba(255, 255, 255, ${closeness * (0.1 + depth * 0.3)})`;
            ctx!.lineWidth = 0.5 + depth;
          }
          ctx!.beginPath(); ctx!.moveTo(sx(a), sy(a)); ctx!.lineTo(sx(b), sy(b)); ctx!.stroke();
        }
      }

      ctx!.setLineDash([]);
      seeds.forEach((s, k) => {
        const at = seedAt(s);
        for (const i of cited[k]) {
          const p = papers[i];
          ctx!.strokeStyle = `rgba(255, 255, 255, ${0.12 + p.depth * 0.3})`;
          ctx!.lineWidth = 0.6 + p.depth * 1.1;
          ctx!.beginPath(); ctx!.moveTo(at.x, at.y); ctx!.lineTo(sx(p), sy(p)); ctx!.stroke();
        }
      });

      for (const p of papers) {
        const x = sx(p), y = sy(p);
        const breath = reduceMotion ? 0 : Math.sin(frame * 0.014 + p.phase) * 0.18;
        const near = pointer.active ? Math.max(0, 1 - Math.hypot(pointer.x - x, pointer.y - y) / POINTER_RADIUS) : 0;
        const radius = p.r * (1 + breath * p.depth * 0.5 + near * p.depth * 0.6);
        const alpha = Math.min(1, 0.28 + p.depth * 0.7 + near * 0.25);
        const rgb = THEMES[p.theme].rgb;
        const glow = Math.max(near, p.depth > HUB ? (p.depth - HUB) / (1 - HUB) : 0);
        if (glow > 0.02) {
          // A radial gradient, not a translucent disc: a disc has a hard rim that reads as a second circle.
          const halo = radius * (3 + glow * 2.2);
          const g = ctx!.createRadialGradient(x, y, radius * 0.6, x, y, halo);
          g.addColorStop(0, `rgba(${rgb}, ${0.26 * glow})`);
          g.addColorStop(0.55, `rgba(${rgb}, ${0.08 * glow})`);
          g.addColorStop(1, `rgba(${rgb}, 0)`);
          ctx!.fillStyle = g;
          ctx!.beginPath(); ctx!.arc(x, y, halo, 0, Math.PI * 2); ctx!.fill();
        }
        ctx!.fillStyle = `rgba(${rgb}, ${alpha})`;
        ctx!.beginPath(); ctx!.arc(x, y, radius, 0, Math.PI * 2); ctx!.fill();
        if (p.depth > HUB) {   // a soft highlight turns the biggest discs into lit spheres
          ctx!.fillStyle = `rgba(255, 255, 255, ${0.35 * glow})`;
          ctx!.beginPath(); ctx!.arc(x - radius * 0.25, y - radius * 0.25, radius * 0.42, 0, Math.PI * 2); ctx!.fill();
        }
      }

      ctx!.fillStyle = "#fff";
      ctx!.font = "700 13px Inter, -apple-system, system-ui, sans-serif";
      for (const s of seeds) {
        const { x, y } = seedAt(s);
        ctx!.beginPath();
        ctx!.moveTo(x, y - 12); ctx!.lineTo(x + 12, y); ctx!.lineTo(x, y + 12); ctx!.lineTo(x - 12, y);
        ctx!.closePath(); ctx!.fill();
        ctx!.fillText(s.label, x + 16, y + 20);
      }
    }

    function loop() {
      if (!running) return;
      step();
      rafId = window.requestAnimationFrame(loop);
    }
    function start() {
      if (running || reduceMotion || !visible || !papers.length) return;
      running = true;
      rafId = window.requestAnimationFrame(loop);
    }
    function stop() {
      running = false;
      if (rafId) window.cancelAnimationFrame(rafId);
    }

    function onPointerMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.active = true;
      if (reduceMotion) paint();   // static, but the pointer still lights up what it is near
    }
    function onPointerLeave() {
      pointer.active = false;
      if (reduceMotion) paint();
    }
    function onVisibility() {
      visible = !document.hidden;
      if (visible) start(); else stop();
    }

    seed();
    // Settle before the first paint: under reduced motion this one frame is the whole picture.
    for (let i = 0; i < (reduceMotion ? 260 : 90); i++) step(false);
    paint();
    if (typeof window.requestAnimationFrame === "function") start();

    band.addEventListener("pointermove", onPointerMove);
    band.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);

    let resizeTimer = 0;
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {   // debounced: a drag-resize would reseed on every pixel
        seed();
        paint();
        if (papers.length) start(); else stop();   // the resize may have crossed MIN_WIDTH either way
      }, 150);
    }) : undefined;
    resize?.observe(band);

    const seen = typeof IntersectionObserver === "function" ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && !document.hidden;
      if (visible) start(); else stop();
    }) : undefined;
    seen?.observe(canvas);

    return () => {
      stop();
      window.clearTimeout(resizeTimer);
      band.removeEventListener("pointermove", onPointerMove);
      band.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      resize?.disconnect();
      seen?.disconnect();
    };
  }, []);

  // Decorative: the legend under the hero says the same in text.
  return <canvas ref={canvasRef} className="seed-field" aria-hidden="true" />;
}
