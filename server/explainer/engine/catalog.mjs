// The part catalog. Every kind is a small, real piece of bench apparatus built from the
// Anatomy kit's own solids, ticks and seams, so a scene assembled from a description
// keeps the kit's look without the model writing geometry. A kind declares:
//   about     one line for the describer prompt
//   params    { name: { default, min, max } | { default, options } }; numeric params can be bound
//   mounts    (v) => { name: [x, y, z] } attachment points relative to the part's origin
//   extent    (v) => [[x0, y0, z0], [x1, y1, z1]] relative bounds, for checks and hit areas
//   draw      (v, c) => [{ at, bias, svg }] painted by depth of `at`, then by bias
import * as k from "../vendor/anatomy/kit/iso-kit.mjs";
import * as G from "../vendor/anatomy/kit/lathe.mjs";
import { ROCKET } from "./catalog-rocket.mjs";

const TAU = Math.PI * 2;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const plan = (cx, cy, w, d, r = 1) => ({ x: cx - w / 2, y: cy - d / 2, w, d, r });

// A box along any three axes, shaded by the kit's light, for tilted parts like a plank.
function orientedBox(centre, axes, half, P, { tone = "hi", lit = false } = {}) {
  const V = G.viewOf(P);
  const corner = (sx, sy, sz) => add(centre, [0, 1, 2].map((i) => axes[0][i] * half[0] * sx + axes[1][i] * half[1] * sy + axes[2][i] * half[2] * sz));
  const faces = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const normal = axes[axis].map((value) => value * sign);
      if (G.dot3(normal, V) <= 1e-6) continue;
      const [a, b] = [0, 1, 2].filter((i) => i !== axis);
      const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => {
        const s = [0, 0, 0];
        s[axis] = sign;
        s[a] = p;
        s[b] = q;
        return k.iso(corner(...s), P);
      });
      faces.push({ normal, d: k.pathOf(quad, true) });
    }
  }
  const all = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) all.push(k.iso(corner(sx, sy, sz), P));
  const hull = hullOf(all);
  const shades = ["", "", "", ""];
  let top = "";
  for (const face of faces) {
    if (face.normal[2] > 0.7) top += face.d;
    else shades[Math.min(3, G.toneOf(face.normal, P))] += face.d;
  }
  const outline = k.pathOf(hull, true);
  return S({ fill: outline, outline, crease: "", top, shades }, { tone, lit, crease: "none" });
}

function hullOf(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// A vertical helix split into the runs that face away and toward the viewer.
function helix(O, radius, z0, z1, turns, P, offset = [0, 0]) {
  const V = G.viewOf(P);
  const count = Math.max(8, Math.round(turns * 28));
  const runs = { back: [], front: [] };
  let run = [];
  let near = null;
  for (let index = 0; index <= count; index++) {
    const share = index / count;
    const angle = share * turns * TAU + Math.PI / 2;
    const point = [O[0] + offset[0] + radius * Math.cos(angle), O[1] + offset[1] + radius * Math.sin(angle), O[2] + z0 + (z1 - z0) * share];
    const facing = Math.cos(angle) * V[0] + Math.sin(angle) * V[1] > 0;
    const flat = k.iso(point, P);
    if (near === null) near = facing;
    if (facing !== near) {
      run.push(flat);
      runs[near ? "front" : "back"].push(k.pathOf(run));
      run = [flat];
      near = facing;
      continue;
    }
    run.push(flat);
  }
  if (run.length > 1) runs[near ? "front" : "back"].push(k.pathOf(run));
  const start = [O[0] + offset[0], O[1] + offset[1] + radius, O[2] + z0];
  const end = [O[0] + offset[0] + radius * Math.cos(turns * TAU + Math.PI / 2), O[1] + offset[1] + radius * Math.sin(turns * TAU + Math.PI / 2), O[2] + z1];
  return { back: runs.back.join(""), front: runs.front.join(""), start, end };
}

const DIRECTIONS = { x: [1, 0], "-x": [-1, 0], y: [0, 1], "-y": [0, -1] };

export const CATALOG = {
  bench: {
    about: "the base every scene stands on: a plate on feet with a groove, corner screws and a ruler strip. Mount: top (use `at` for x, y).",
    params: { w: { default: 260, min: 120, max: 420 }, d: { default: 150, min: 80, max: 260 } },
    mounts: () => ({ top: [0, 0, 0] }),
    extent: (v) => [[-v.w / 2, -v.d / 2, -17], [v.w / 2, v.d / 2, 0]],
    draw(v, c) {
      const { P, at, O } = c;
      const base = plan(O[0], O[1], v.w, v.d, 8);
      const out = [`<path class="iso-halo" d="${k.haloOf(base, O[2] - 17, 12, P)}"/>`];
      const feet = k.corners(base, 22).sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
      for (const [x, y] of feet) {
        out.push(S(k.cylinder(x, y, 7, O[2] - 17, 1.6, P, 28), { tone: "lo" }));
        out.push(S(k.cylinder(x, y, 5.4, O[2] - 15.4, 3.4, P, 28), { tone: "mid" }));
      }
      out.push(S(k.slabOf(base, O[2] - 12, 12, P, 8, 1.6), { tone: "mid" }));
      out.push(L(k.planOutline(k.insetPlan(base, 5), O[2], P), { tone: "lo" }));
      const screws = k.corners(base, 10);
      out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, O[2], P, 16)).join(""), { tone: "lo" }));
      out.push(D(screws.map(([x, y]) => at([x, y, O[2]])), { size: 0.5 }));
      const strip = { x: base.x + 18, y: base.y + base.d - 14, w: base.w - 36, d: 6, r: 1 };
      out.push(S(k.slabOf(strip, O[2], 0.6, P, 3), { tone: "lo", crease: "none" }));
      const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, O[2] + 0.6, [1.8, 3.4], P);
      out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
      out.push(D([at([strip.x + 2, strip.y + 3, O[2] + 0.6]), at([strip.x + strip.w - 2, strip.y + 3, O[2] + 0.6])], { size: 0.45 }));
      return [{ at: [O[0], O[1], O[2] - 1000], svg: out.join("") }];
    },
  },

  post: {
    about: "an upright rod on a screwed base block, for hanging or holding things up. Mount: top.",
    params: { height: { default: 200, min: 40, max: 320 }, r: { default: 3.6, min: 2.4, max: 8 } },
    mounts: (v) => ({ top: [0, 0, v.height] }),
    extent: (v) => [[-13, -13, 0], [13, 13, v.height + 2]],
    draw(v, c) {
      const { P, at, O } = c;
      const [x, y, z] = O;
      const block = plan(x, y, 26, 26, 3);
      const out = [];
      out.push(S(k.slabOf(block, z, 8, P, 4, 0.7), { tone: "mid" }));
      const screws = k.corners(block, 5);
      out.push(L(screws.map(([sx, sy]) => k.ring(sx, sy, 1.8, z + 8, P, 14)).join(""), { tone: "lo" }));
      out.push(D(screws.map(([sx, sy]) => at([sx, sy, z + 8])), { size: 0.45 }));
      out.push(S(k.cylinder(x, y, v.r + 2.2, z + 8, 4, P, 28, 0.4), { tone: "mid" }));
      out.push(S(k.cylinder(x, y, v.r, z + 12, v.height - 12, P, 28), { tone: "mid", crease: "none" }));
      out.push(L([0.35, 0.7].map((share) => k.sideArc(x, y, v.r, z + 12 + (v.height - 12) * share, P, 16)).join(""), { tone: "faint" }));
      out.push(S(k.cylinder(x, y, v.r + 0.6, z + v.height - 1.6, 1.6, P, 28), { tone: "mid" }));
      return [{ at: [x, y, z + v.height / 2], svg: out.join("") }];
    },
  },

  arm: {
    about: "a horizontal bar clamped to the top of a post, with an eyelet under its tip. Put it on post.top. Mount: tip (under the eyelet).",
    params: { length: { default: 90, min: 30, max: 200 }, toward: { default: "x", options: ["x", "-x", "y", "-y"] } },
    mounts: (v) => {
      const [dx, dy] = DIRECTIONS[v.toward];
      return { tip: [dx * (v.length - 6), dy * (v.length - 6), -19] };
    },
    extent: (v) => {
      const [dx, dy] = DIRECTIONS[v.toward];
      const xs = [-8, 8, dx * v.length], ys = [-8, 8, dy * v.length];
      return [[Math.min(...xs), Math.min(...ys), -19], [Math.max(...xs), Math.max(...ys), 2]];
    },
    draw(v, c) {
      const { P, at, O } = c;
      const [dx, dy] = DIRECTIONS[v.toward];
      const out = [];
      const clamp = plan(O[0], O[1], 16, 16, 2.5);
      out.push(S(k.slabOf(clamp, O[2] - 16, 16, P, 4, 0.6), { tone: "mid" }));
      out.push(D([at([O[0], O[1], O[2]])], { size: 0.55, tone: "hi" }));
      const from = 8;
      const along = v.length - from;
      const cx = O[0] + dx * (from + along / 2);
      const cy = O[1] + dy * (from + along / 2);
      const bar = dx ? plan(cx, O[1], along, 8, 2) : plan(O[0], cy, 8, along, 2);
      out.push(S(k.slabOf(bar, O[2] - 13, 7, P, 4, 0.5), { tone: "mid" }));
      out.push(D([0.25, 0.75].map((share) => at([O[0] + dx * (from + along * share), O[1] + dy * (from + along * share), O[2] - 6])), { size: 0.45 }));
      const tip = [O[0] + dx * (v.length - 6), O[1] + dy * (v.length - 6)];
      out.push(S(k.cylinder(tip[0], tip[1], 2.6, O[2] - 19, 6, P, 20), { tone: "mid" }));
      const knob = [O[0] - dy * 11, O[1] + dx * 11];
      out.push(S(k.slabOf(plan(O[0] - dy * 9, O[1] + dx * 9, dx ? 2.6 : 3, dx ? 3 : 2.6, 0.6), O[2] - 10, 4, P, 2), { tone: "mid", crease: "none" }));
      out.push(S(k.cylinder(knob[0], knob[1], 2.8, O[2] - 11, 6, P, 20), { tone: "mid" }));
      out.push(L(k.knurl(knob[0], knob[1], 2.8, O[2] - 11, O[2] - 5, 18, P), { tone: "lo" }));
      return [{ at: [O[0] + dx * v.length * 0.5, O[1] + dy * v.length * 0.5, O[2] - 6], svg: out.join("") }];
    },
  },

  spring: {
    about: "a coil spring hanging down from its mount; bind `stretch` to show it extending, `count` (1-3) for springs side by side. Mount: end (the bottom hook).",
    params: {
      rest: { default: 44, min: 12, max: 160 },
      stretch: { default: 0, min: 0, max: 220 },
      turns: { default: 11, min: 3, max: 30 },
      radius: { default: 5.5, min: 2.5, max: 12 },
      count: { default: 1, min: 1, max: 3 },
    },
    mounts: (v) => ({ end: [0, 0, -(v.rest + v.stretch + (Math.round(v.count) > 1 ? 6 : 0))] }),
    extent: (v) => {
      const n = Math.round(v.count);
      const spread = (n - 1) * (v.radius * 2 + 5) / 2 + v.radius + 2;
      return [[-spread, -v.radius - 1, -(v.rest + v.stretch + 6)], [spread, v.radius + 1, 0]];
    },
    draw(v, c) {
      const { P, at, O } = c;
      const n = Math.round(v.count);
      const length = v.rest + v.stretch;
      const pitch = v.radius * 2 + 5;
      // Side by side across the line of sight, so several springs never hide each other.
      const [tx, ty] = k.towardViewer(P);
      const side = [-ty, tx, 0];
      const offsets = Array.from({ length: n }, (_, index) => [side[0] * (index - (n - 1) / 2) * pitch, side[1] * (index - (n - 1) / 2) * pitch]);
      const yoke = n > 1 ? 3 : 0;
      const items = [];
      if (n > 1) {
        const width = (n - 1) * pitch + 8;
        const bar = (z) => orientedBox(add(O, [0, 0, z]), [side, [tx, ty, 0], [0, 0, 1]], [width / 2, 2.5, yoke / 2], P, { tone: "mid" });
        items.push({ at: add(O, [0, 0, -1]), bias: 0.6, svg: bar(-yoke / 2) + D([at(O)], { size: 0.55, tone: "hi" }) });
        items.push({ at: add(O, [0, 0, -length - yoke]), bias: 0.6, svg: bar(-length - yoke * 1.5) + D([at([O[0], O[1], O[2] - length - yoke * 2])], { size: 0.55, tone: "hi" }) });
      }
      for (const offset of offsets) {
        const coil = helix(O, v.radius, -yoke - 3, -yoke - length + 3, v.turns, P, offset);
        const top = [O[0] + offset[0], O[1] + offset[1], O[2] - yoke];
        const bottom = [O[0] + offset[0], O[1] + offset[1], O[2] - yoke - length];
        const leads = k.pathOf([at(top), at([top[0], top[1], top[2] - 1.5]), at(coil.start)]) + k.pathOf([at(coil.end), at([bottom[0], bottom[1], bottom[2] + 1.5]), at(bottom)]);
        const mid = add(top, [0, 0, -length / 2]);
        items.push({ at: mid, bias: -0.5, svg: L(coil.back, { tone: "mid", className: "eg-wire" }) });
        items.push({ at: mid, bias: 0.5, svg: L(coil.front, { tone: "hi", className: "eg-wire" }) + L(leads, { tone: "hi", className: "eg-wire" }) + D([at(top), at(bottom)], { size: 0.8, tone: "hi" }) });
      }
      return items;
    },
  },

  mass_hanger: {
    about: "a hook, stem and base for slotted masses; bind `count` to the number of discs stacked on it. Mounts: top (the hook), side (edge of the base, for a pointer).",
    params: {
      count: { default: 1, min: 0, max: 10 },
      slots: { default: 5, min: 1, max: 10 },
      radius: { default: 11, min: 6, max: 20 },
      thickness: { default: 4.6, min: 2.5, max: 9 },
    },
    mounts: (v) => {
      const base = hangerBase(v);
      return { top: [0, 0, 0], side: [v.radius, 0, base + 1.5], base: [0, 0, base] };
    },
    extent: (v) => [[-v.radius, -v.radius, hangerBase(v)], [v.radius, v.radius, 0]],
    draw(v, c) {
      const { P, at, O } = c;
      const base = O[2] + hangerBase(v);
      const count = Math.max(0, Math.min(Math.round(v.slots), Math.round(v.count)));
      const out = [];
      out.push(S(k.cylinder(O[0], O[1], v.radius, base, 3, P, 40, 0.5), { tone: "mid" }));
      let top = base + 3;
      for (let index = 0; index < count; index++) {
        const h = v.thickness - 0.4;
        const slot = k.lineOnTop([O[0] + 1.6, O[1]], [O[0] + v.radius - 0.1, O[1]], top + h, P);
        out.push(S(k.cylinder(O[0], O[1], v.radius - 0.4, top, h, P, 40, 0.4), { tone: index % 2 ? "mid" : "hi", inner: L(slot, { tone: "lo" }) }));
        top += v.thickness;
      }
      out.push(S(k.cylinder(O[0], O[1], 1.4, top, O[2] - 4 - top, P, 16), { tone: "hi", crease: "none" }));
      out.push(S(k.cylinder(O[0], O[1], 2.2, O[2] - 4, 4, P, 20), { tone: "mid" }));
      return [{ at: [O[0], O[1], base + 2], svg: out.join("") }];
    },
  },

  ruler: {
    about: "an upright scale on a foot, read from a pointer in front of it. Its face looks toward +y, so place it behind (smaller y than) what it measures. `zero` is the height of its 0 mark above the bench; numbers count downward by default.",
    params: { height: { default: 160, min: 40, max: 300 }, zero: { default: 140, min: 0, max: 300 }, width: { default: 14, min: 8, max: 24 }, upward: { default: 0, min: 0, max: 1 } },
    mounts: (v) => ({ face: [0, 1.5, 0], top: [0, 0, v.height] }),
    extent: (v) => [[-15, -8, 0], [15, 1.5, v.height]],
    draw(v, c) {
      const { P, at, O } = c;
      const [x, y, z] = O;
      const out = [];
      const foot = plan(x, y, 30, 16, 2);
      out.push(S(k.slabOf(foot, z, 5, P, 3, 0.5), { tone: "mid" }));
      out.push(D([at([x - 11, y, z + 5]), at([x + 11, y, z + 5])], { size: 0.45 }));
      const board = { x: x - v.width / 2, y: y - 1.5, w: v.width, d: 3, r: 0.4 };
      const face = y + 1.5;
      const left = board.x;
      const ticks = [];
      const major = [];
      const labels = [];
      for (let mark = 0; mark <= 300; mark += 5) {
        const h = v.upward ? v.zero + mark : v.zero - mark;
        if (h < 8 || h > v.height - 3) continue;
        const big = mark % 10 === 0;
        const length = big ? v.width * 0.42 : v.width * 0.24;
        (big ? major : ticks).push(k.segment([left, face, z + h], [left + length, face, z + h], P));
        if (mark % 20 === 0) labels.push(k.faceTextSvg(k.sideMatrix([left + v.width * 0.68, face], z + h + 1.6, P, "left"), String(mark), { size: 4.4, tone: "mid", anchor: "middle" }));
      }
      // Long ticks end on a margin rule that runs the full height of the face.
      const rule = k.segment([left + v.width * 0.42, face, z + 5], [left + v.width * 0.42, face, z + v.height], P);
      out.push(S(k.slabOf(board, z + 5, v.height - 5, P, 2, 0.3), { tone: "mid", inner: L(ticks.join(""), { tone: "lo" }) + L(major.join("") + rule, { tone: "mid" }) }));
      out.push(labels.join(""));
      return [{ at: [x, y, z + v.height / 2], svg: out.join("") }];
    },
  },

  pointer: {
    about: "a thin needle fixed to its mount, reaching out by (dx, dy, dz) to touch a scale. Usually on mass_hanger.side, reaching toward -y to a ruler face.",
    params: { dx: { default: 0, min: -200, max: 200 }, dy: { default: -30, min: -200, max: 200 }, dz: { default: 0, min: -100, max: 100 } },
    mounts: (v) => ({ tip: [v.dx, v.dy, v.dz] }),
    extent: (v) => [[Math.min(0, v.dx) - 0.4, Math.min(0, v.dy) - 0.4, Math.min(0, v.dz) - 0.4], [Math.max(0, v.dx) + 0.4, Math.max(0, v.dy) + 0.4, Math.max(0, v.dz) + 0.4]],
    draw(v, c) {
      const { P, O } = c;
      const vector = [v.dx, v.dy, v.dz];
      const length = Math.hypot(...vector) || 1;
      const a = vector.map((value) => value / length);
      const side = G.unit3(Math.abs(a[2]) > 0.9 ? [1, 0, 0] : G.cross3([0, 0, 1], a));
      const up = G.cross3(a, side);
      const centre = add(O, vector.map((value) => value / 2));
      return [{ at: centre, svg: orientedBox(centre, [a, side, up], [length / 2, 1.4, 0.5], P, { tone: "hi", lit: true }) }];
    },
  },

  block: {
    about: "a solid box with a grooved top and corner screws: a cart, a brick, a weight, a housing. Mount: top.",
    params: { w: { default: 40, min: 6, max: 200 }, d: { default: 30, min: 6, max: 200 }, h: { default: 20, min: 3, max: 200 }, raised: { default: 1, min: 0, max: 1 } },
    mounts: (v) => ({ top: [0, 0, v.h] }),
    extent: (v) => [[-v.w / 2, -v.d / 2, 0], [v.w / 2, v.d / 2, v.h]],
    draw(v, c) {
      const { P, at, O } = c;
      const box = plan(O[0], O[1], v.w, v.d, Math.min(3, v.w / 6, v.d / 6));
      const top = O[2] + v.h;
      const inset = Math.min(4, v.w / 6, v.d / 6);
      let svg = S(k.slabOf(box, O[2], v.h, P, 4, 0.6), { tone: v.raised ? "hi" : "mid" });
      if (v.w > 14 && v.d > 14) {
        svg += L(k.planOutline(k.insetPlan(box, inset), top, P, 4), { tone: "faint" });
        const screws = k.corners(box, inset / 2 + 0.6);
        svg += D(screws.map(([x, y]) => at([x, y, top])), { size: 0.42 });
      }
      return [{ at: [O[0], O[1], O[2] + v.h / 2], svg }];
    },
  },

  dial: {
    about: "a round gauge lying flat with ticks and a needle; bind `fraction` (0-1) to what it reads. Put it on a block top.",
    params: { r: { default: 18, min: 8, max: 40 }, fraction: { default: 0, min: 0, max: 1 }, span: { default: 270, min: 90, max: 330 } },
    mounts: () => ({}),
    extent: (v) => [[-v.r, -v.r, 0], [v.r, v.r, 7]],
    draw(v, c) {
      const { P, at, O } = c;
      const [x, y, z] = O;
      const top = z + 7;
      const span = (v.span * Math.PI) / 180;
      const from = -span / 2;
      const ticks = k.radialTicks(x, y, v.r - 2.6, 20, 5, top, [1.8, 3.4], P, from, span);
      const angle = from + span * Math.max(0, Math.min(1, v.fraction));
      const tip = [x + Math.sin(angle) * (v.r - 4.4), y - Math.cos(angle) * (v.r - 4.4), top];
      const tail = [x - Math.sin(angle) * 3, y + Math.cos(angle) * 3, top];
      let svg = S(k.cylinder(x, y, v.r, z, 7, P, 56, 0.6), { tone: "hi", crease: "lo" });
      svg += L(k.ring(x, y, v.r - 2.6, top, P, 56), { tone: "lo" });
      svg += L(ticks.minor, { tone: "lo" }) + L(ticks.major, { tone: "mid" });
      svg += L(k.pathOf([at(tail), at(tip)]), { tone: "lit", className: "eg-needle", free: true });
      svg += D([at([x, y, top])], { size: 0.9, tone: "hi" });
      return [{ at: [x, y, z + 3], svg }];
    },
  },

  tank: {
    about: "a closed cylinder with a sight glass on its front showing a liquid level; bind `level` (0-1). Mount: top.",
    params: { r: { default: 22, min: 8, max: 60 }, h: { default: 70, min: 20, max: 200 }, level: { default: 0.5, min: 0, max: 1 } },
    mounts: (v) => ({ top: [0, 0, v.h + 3] }),
    extent: (v) => [[-v.r - 6, -v.r - 6, 0], [v.r + 6, v.r + 6, v.h + 3]],
    draw(v, c) {
      const { P, at, O } = c;
      const [x, y, z] = O;
      const [tx, ty] = k.towardViewer(P);
      const gx = x + tx * (v.r + 3.4);
      const gy = y + ty * (v.r + 3.4);
      const low = z + 8;
      const high = z + v.h - 8;
      const items = [];
      const body = S(k.cylinder(x, y, v.r, z, v.h, P, 56), { tone: "mid", crease: "none", inner: L([0.33, 0.66].map((s) => k.sideArc(x, y, v.r, z + v.h * s, P, 32)).join(""), { tone: "faint" }) });
      const lid = S(k.cylinder(x, y, v.r + 1.2, z + v.h, 3, P, 56, 0.5), { tone: "mid" }) + D(G.dotsOf(G.frameAlong([x, y, z], [0, 0, 1]), v.h + 3, v.r - 1.6, 12, P, { all: true }), { size: 0.4 });
      items.push({ at: [x, y, z + v.h / 2], svg: body + lid });
      const level = low + (high - low) * Math.max(0, Math.min(1, v.level));
      let glass = "";
      for (const h of [low - 3, high]) glass += S(k.slabOf(plan(x + tx * (v.r + 1.6), y + ty * (v.r + 1.6), 6, 6, 1), h, 3, P, 2), { tone: "mid" });
      glass += S(k.cylinder(gx, gy, 2.2, low, high - low, P, 16), { tone: "faint", flat: true, crease: "none" });
      if (level > low + 0.2) glass += S(k.cylinder(gx, gy, 1.5, low, level - low, P, 16), { tone: "hi", className: "eg-liquid", crease: "none" });
      items.push({ at: [gx, gy, z + v.h / 2], bias: 0.2, svg: glass });
      return items;
    },
  },

  lever: {
    about: "a plank balanced on a fulcrum, running along x; bind `angle` (degrees, + tips the +x end down) and `left` / `right` for the number of blocks it stacks on each end itself. Nothing mounts on a lever.",
    params: { length: { default: 180, min: 60, max: 360 }, height: { default: 34, min: 14, max: 90 }, angle: { default: 0, min: -30, max: 30 }, left: { default: 0, min: 0, max: 6 }, right: { default: 0, min: 0, max: 6 } },
    mounts: (v) => ({ pivot: [0, 0, v.height] }),
    extent: (v) => {
      const tilt = (Math.abs(v.angle) * Math.PI) / 180;
      const stack = Math.max(Math.round(v.left), Math.round(v.right)) * 12.2;
      return [[-v.length / 2, -14, 0], [v.length / 2, 14, v.height + 5.8 + Math.sin(tilt) * (v.length / 2) + stack + 6]];
    },
    draw(v, c) {
      const { P, O } = c;
      const [x, y, z] = O;
      const items = [];
      const ring = [[x - 16, y - 12], [x + 16, y - 12], [x + 16, y + 12], [x - 16, y + 12]];
      items.push({ at: [x, y, z + 2], bias: -1, svg: S(k.extrude(ring, z, 4, P, { bevel: 0.4 }), { tone: "mid" }) });
      items.push({ at: [x, y, z + v.height / 2], bias: -0.8, svg: S(k.slabOf(plan(x, y, 8, 20, 1.5), z + 4, v.height - 6, P, 3, 0.4), { tone: "mid" }) });
      const F = G.frameAlong([x, y - 12, z + v.height], [0, 1, 0]);
      items.push({ at: [x, y, z + v.height], bias: -0.5, svg: S(G.disc(0, 24, 3, F, P), { tone: "hi" }) });
      const t = (-v.angle * Math.PI) / 180;
      const along = [Math.cos(t), 0, Math.sin(t)];
      const up = [-Math.sin(t), 0, Math.cos(t)];
      const centre = [x, y, z + v.height + 3.2];
      items.push({ at: centre, svg: orientedBox(centre, [along, [0, 1, 0], up], [v.length / 2, 12, 2.6], P, { tone: "hi" }) });
      for (const [side, count] of [[-1, Math.round(v.left)], [1, Math.round(v.right)]]) {
        for (let index = 0; index < count; index++) {
          const reach = side * (v.length / 2 - 16);
          const lift = 2.6 + 6 + index * 12.2;
          const at = add(centre, [along[0] * reach + up[0] * lift, 0, along[2] * reach + up[2] * lift]);
          // Ordered with the plank, not by their own depth: they sit on it at either end.
          items.push({ at: centre, bias: 1 + index + (side > 0 ? 0.5 : 0), svg: orientedBox(at, [along, [0, 1, 0], up], [10, 10, 6], P, { tone: index % 2 ? "mid" : "hi" }) });
        }
      }
      return items;
    },
  },

  lamp: {
    about: "a bulb in a holder on a small base; bind `glow` (0-1) for how brightly it shines.",
    params: { r: { default: 8, min: 4, max: 18 }, glow: { default: 0, min: 0, max: 1 } },
    mounts: () => ({}),
    extent: (v) => [[-v.r - 4, -v.r - 4, 0], [v.r + 4, v.r + 4, 11 + v.r * 2]],
    draw(v, c) {
      const { P, at, O } = c;
      const [x, y, z] = O;
      let svg = S(k.cylinder(x, y, v.r + 4, z, 4, P, 32, 0.5), { tone: "mid" });
      svg += S(k.cylinder(x, y, v.r * 0.55, z + 4, 6, P, 24), { tone: "mid" });
      svg += L(k.knurl(x, y, v.r * 0.55, z + 4, z + 10, 16, P), { tone: "lo" });
      const centre = [x, y, z + 10 + v.r * 0.9];
      const glow = Math.max(0, Math.min(1, v.glow));
      const [cx, cy] = at(centre);
      const reach = v.r * G.scaleOf(P) * 3.2;
      svg += `<circle class="eg-glow" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${reach.toFixed(1)}" opacity="${(glow * 0.9).toFixed(2)}"/>`;
      svg += S(G.sphereOf(centre, v.r, P), { tone: "hi", className: glow > 0.02 ? "eg-bulb" : "", lit: glow > 0.5 });
      return [{ at: [x, y, z + 6], svg }];
    },
  },
};

Object.assign(CATALOG, ROCKET);
// Every part can be lifted off its mount, so a description can make something rise or drop.
for (const kind of Object.values(CATALOG)) kind.params.lift = { default: 0, min: -120, max: 400 };

const hangerBase = (v) => -(4 + 10 + Math.round(v.slots) * v.thickness + 3);

// A compact listing of the catalog for the describer's prompt.
export function catalogText() {
  return Object.entries(CATALOG)
    .map(([kind, part]) => {
      const params = Object.entries(part.params)
        .filter(([name]) => name !== "lift")
        .map(([name, spec]) => (spec.ref ? `${name}: "<part>.<mount>"` : spec.options ? `${name}: ${spec.options.join("|")} (${spec.default})` : `${name}: ${spec.min}..${spec.max} (${spec.default})`))
        .join(", ");
      const defaults = Object.fromEntries(Object.entries(part.params).map(([name, spec]) => [name, spec.default]));
      const mounts = Object.keys(part.mounts(defaults));
      return `- ${kind}: ${part.about}\n  params ${params}\n  mounts ${mounts.length ? mounts.join(", ") : "(none: nothing can be put on it)"}`;
    })
    .join("\n") + "\n- every part also has `lift` (-120..400, 0): how far the part has risen; everything mounted on it rises with it, so bind it once, on the lowest part of what moves (a rocket leaving its stand: its combustion_chamber).";
}
