// Rocket parts: a launch stand, propellant tanks, a nose cone, fins, a combustion chamber,
// a nozzle, a turbopump, pipes between mounts and a flame. Round bodies are turned with the
// kit's lathe, pipes come from its tube module, and the flame is a gradient-filled plume.
import * as k from "../vendor/anatomy/kit/iso-kit.mjs";
import * as G from "../vendor/anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../vendor/anatomy/kit/tube.mjs";

const TAU = Math.PI * 2;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const plan = (cx, cy, w, d, r = 1) => ({ x: cx - w / 2, y: cy - d / 2, w, d, r });
const down = (O) => G.frameAlong(O, [0, 0, -1]);
const up = (O) => G.frameAlong(O, [0, 0, 1]);
const viewer = () => FRONT;
const FLUID = { ox: "ox", fuel: "fuel", gas: "gas" };
// The engine's camera always looks from azimuth 45°, so ports face this way to be seen.
const FRONT = [Math.SQRT1_2, Math.SQRT1_2, 0];
const toward = (r, z) => [FRONT[0] * r, FRONT[1] * r, z];

// Any six-faced solid from its eight corners, indexed corner(sx, sy, sz) with each sign ±1,
// drawn with the faces that look toward the viewer and shaded by the kit's light.
function hexahedron(corner, P, tone = "mid") {
  const V = G.viewOf(P);
  const centre = [0, 1, 2].map((i) => [-1, 1].flatMap((a) => [-1, 1].flatMap((b) => [-1, 1].map((c) => corner(a, b, c)[i]))).reduce((sum, value) => sum + value, 0) / 8);
  const shades = ["", "", "", ""];
  let top = "";
  const flat = [];
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const [a, b] = [0, 1, 2].filter((i) => i !== axis);
      const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => {
        const sgn = [0, 0, 0];
        sgn[axis] = sign;
        sgn[a] = p;
        sgn[b] = q;
        return corner(...sgn);
      });
      let normal = G.unit3(G.cross3(G.sub3(quad[1], quad[0]), G.sub3(quad[3], quad[0])));
      const mid = quad.reduce((sum, point) => G.add3(sum, point), [0, 0, 0]).map((value) => value / 4);
      if (G.dot3(normal, G.sub3(mid, centre)) < 0) normal = normal.map((value) => -value);
      if (G.dot3(normal, V) <= 1e-6) continue;
      const d = k.pathOf(quad.map((point) => k.iso(point, P)), true);
      if (normal[2] > 0.7) top += d;
      else shades[Math.min(3, G.toneOf(normal, P))] += d;
    }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) flat.push(k.iso(corner(sx, sy, sz), P));
  const outline = k.pathOf(hull(flat), true);
  return S({ fill: outline, outline, crease: "", top, shades }, { tone, crease: "none" });
}

// A box along any three axes (braces).
function slanted(centre, axes, half, P, tone = "mid") {
  return hexahedron((sx, sy, sz) => add(centre, [0, 1, 2].map((i) => axes[0][i] * half[0] * sx + axes[1][i] * half[1] * sy + axes[2][i] * half[2] * sz)), P, tone);
}

function hull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = build(sorted);
  const upper = build([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// A window down the front of a cylinder showing how full it is.
function sightWindow(O, r, z0, z1, level, P, fluid) {
  const [tx, ty] = k.towardViewer(P);
  const centre = Math.atan2(ty, tx);
  const half = 0.2;
  const edge = (angle, z) => k.iso([O[0] + Math.cos(angle) * r, O[1] + Math.sin(angle) * r, z], P);
  const strip = (za, zb) => {
    const steps = 8;
    const top = Array.from({ length: steps + 1 }, (_, i) => edge(centre - half + (2 * half * i) / steps, zb));
    const bottom = Array.from({ length: steps + 1 }, (_, i) => edge(centre + half - (2 * half * i) / steps, za));
    return k.pathOf([...top, ...bottom], true);
  };
  const surface = z0 + (z1 - z0) * Math.max(0, Math.min(1, level));
  let svg = `<path class="eg-window" d="${strip(z0, z1)}"/>`;
  if (surface > z0 + 0.3) svg += `<path class="eg-fluid-fill" data-fluid="${fluid}" d="${strip(z0, surface)}"/>`;
  return svg + L(strip(z0, z1), { tone: "lo" });
}

export const ROCKET = {
  launch_stand: {
    about: "an open steel frame on the bench that a rocket stands on: four legs, cross braces and a square deck with an opening. Mount: deck (the centre of the deck top; a combustion_chamber goes here and hangs through the opening).",
    params: { height: { default: 100, min: 50, max: 220 }, span: { default: 74, min: 40, max: 160 } },
    mounts: (v) => ({ deck: [0, 0, v.height + 4] }),
    extent: (v) => [[-v.span / 2 - 6, -v.span / 2 - 6, 0], [v.span / 2 + 6, v.span / 2 + 6, v.height + 4]],
    connector: true,
    draw(v, c) {
      const { P, at, O } = c;
      const h = v.height;
      const half = v.span / 2;
      const items = [];
      items.push({ at: [O[0], O[1], O[2] - 50], svg: S(k.slabOf(plan(O[0], O[1], 30, 30, 2), O[2], 3, P, 3, 0.5), { tone: "mid" }) + L(k.planOutline(plan(O[0], O[1], 20, 20, 1.5), O[2] + 3, P, 3), { tone: "lo" }) });
      for (const sx of [-1, 1])
        for (const sy of [-1, 1]) {
          const x = O[0] + sx * half;
          const y = O[1] + sy * half;
          const leg = S(k.slabOf(plan(x, y, 14, 14, 1.5), O[2], 3, P, 3, 0.4), { tone: "mid" }) + D(k.corners(plan(x, y, 14, 14), 2.6).map(([px, py]) => at([px, py, O[2] + 3])), { size: 0.4 }) + S(k.slabOf(plan(x, y, 6, 6, 0.8), O[2] + 3, h - 3, P, 2, 0.3), { tone: "mid" });
          items.push({ at: [x, y, O[2] + h / 2], svg: leg });
        }
      // Cross braces on the two faces toward the viewer, and on the far faces behind everything.
      for (const [axis, sign] of [["x", -1], ["y", -1], ["x", 1], ["y", 1]]) {
        const fixed = sign * half;
        for (const flip of [-1, 1]) {
          const a = axis === "x" ? [O[0] + fixed, O[1] - flip * half, O[2] + 10] : [O[0] - flip * half, O[1] + fixed, O[2] + 10];
          const b = axis === "x" ? [O[0] + fixed, O[1] + flip * half, O[2] + h - 8] : [O[0] + flip * half, O[1] + fixed, O[2] + h - 8];
          const mid = G.lerp3(a, b, 0.5);
          const along = G.unit3(G.sub3(b, a));
          const normal = axis === "x" ? [1, 0, 0] : [0, 1, 0];
          const side = G.cross3(along, normal);
          items.push({ at: add(mid, normal.map((n) => n * sign * 2)), svg: slanted(mid, [along, side, normal], [G.len3(G.sub3(b, a)) / 2, 1.2, 0.8], P) });
        }
      }
      for (const [dx, dy, w, d] of [[0, -half, v.span + 6, 6], [-half, 0, 6, v.span + 6], [0, half, v.span + 6, 6], [half, 0, 6, v.span + 6]]) {
        const bar = plan(O[0] + dx, O[1] + dy, w, d, 1);
        items.push({ at: [O[0] + dx, O[1] + dy, O[2] + h + 2], svg: S(k.slabOf(bar, O[2] + h, 4, P, 2, 0.4), { tone: "mid" }) + D([at([O[0] + dx + (w > d ? -w / 3 : 0), O[1] + dy + (w > d ? 0 : -d / 3), O[2] + h + 4]), at([O[0] + dx + (w > d ? w / 3 : 0), O[1] + dy + (w > d ? 0 : d / 3), O[2] + h + 4])], { size: 0.42 }) });
      }
      return items;
    },
  },

  combustion_chamber: {
    about: "a rocket engine's combustion chamber: a mounting plate on top and a round chamber that hangs down and narrows to a throat. Put it on launch_stand.deck. Mounts: top (for the tanks above), throat (for the nozzle), port (a side inlet for pipes).",
    params: { r: { default: 12, min: 6, max: 30 }, length: { default: 30, min: 12, max: 90 } },
    mounts: (v) => ({ top: [0, 0, 3], throat: [0, 0, -v.length], port: toward(v.r + 1.8, -v.length * 0.3) }),
    extent: (v) => [[-v.r * 1.9, -v.r * 1.9, -v.length], [v.r * 1.9, v.r * 1.9, 3]],
    draw(v, c) {
      const { P, O } = c;
      const F = down(O);
      const r = v.r;
      const L1 = v.length;
      const throat = r * 0.55;
      const profile = [[0, r], [L1 * 0.55, r], ...Array.from({ length: 8 }, (_, i) => {
        const s = L1 * 0.55 + (L1 * 0.45 * (i + 1)) / 8;
        const share = (s - L1 * 0.55) / (L1 * 0.45);
        return [s, r - (r - throat) * (0.5 - 0.5 * Math.cos(Math.PI * share)), i < 7 ? 1 : 0];
      })];
      const body = S(G.solidOf(profile, F, P, { smooth: { rows: 4 } }), { tone: "hi", inner: L([L1 * 0.2, L1 * 0.4].map((s) => G.arcOf(F, s, r, P)).join(""), { tone: "faint" }) });
      const plate = S(k.cylinder(O[0], O[1], r * 1.9, O[2], 3, P, 40, 0.5), { tone: "mid" }) + D(G.dotsOf(up(O), 3, r * 1.6, 12, P, { all: true }), { size: 0.4 });
      const port = portOf(c, r, O[2] - L1 * 0.3);
      return [
        { at: [O[0], O[1], O[2] - L1 / 2], svg: body + port },
        { at: [O[0], O[1], O[2] + 1.5], bias: 1, svg: plate },
      ];
    },
  },

  nozzle: {
    about: "a bell nozzle that flares down from the chamber's throat. Put it on combustion_chamber.throat. Mount: exit (the bottom rim, where a flame starts).",
    params: { throat: { default: 6.6, min: 3, max: 18 }, exit: { default: 24, min: 8, max: 70 }, length: { default: 46, min: 15, max: 140 } },
    mounts: (v) => ({ exit: [0, 0, -v.length] }),
    extent: (v) => [[-v.exit - 1, -v.exit - 1, -v.length - 1], [v.exit + 1, v.exit + 1, 0]],
    draw(v, c) {
      const { P, O } = c;
      const F = down(O);
      const radius = (s) => v.throat + (v.exit - v.throat) * Math.pow(Math.max(0, s) / v.length, 0.62);
      const slope = (s) => ((v.exit - v.throat) * 0.62 * Math.pow(Math.max(1e-3, s) / v.length, -0.38)) / v.length;
      const profile = Array.from({ length: 21 }, (_, i) => {
        const s = (v.length * i) / 20;
        return [s, radius(s), i && i < 20 ? 1 : 0];
      });
      const body = S(G.solidOf(profile, F, P, { smooth: { slope, rows: 4 } }), { tone: "hi", inner: L([0.4, 0.75, 0.94].map((share) => G.arcOf(F, v.length * share, radius(v.length * share), P, { slope: slope(v.length * share) })).join(""), { tone: "faint" }) });
      return [{ at: [O[0], O[1], O[2] - v.length / 2], svg: body }];
    },
  },

  flame: {
    about: "the glowing exhaust plume coming out of a nozzle, flickering; bind `length` to the thrust (0 is off). Put it on nozzle.exit and set `width` to the nozzle's exit radius.",
    params: { length: { default: 60, min: 0, max: 260 }, width: { default: 24, min: 4, max: 70 } },
    mounts: () => ({}),
    extent: () => [[0, 0, 0], [0, 0, 0]],
    connector: true,
    animated: (v) => v.length > 0.5,
    draw(v, c) {
      const { P, at, O, t, id } = c;
      if (v.length < 0.5) return [{ at: O, svg: "" }];
      const flicker = 1 + 0.05 * Math.sin(t * 31) + 0.03 * Math.sin(t * 17 + 1.3);
      const length = v.length * flicker;
      const rim = Array.from({ length: 33 }, (_, i) => at([O[0] + Math.cos((i / 32) * TAU) * v.width * 0.92, O[1] + Math.sin((i / 32) * TAU) * v.width * 0.92, O[2]]));
      const plume = (reach, waist) => {
        const tip = at([O[0], O[1], O[2] - reach]);
        const side = Array.from({ length: 13 }, (_, i) => {
          const s = i / 12;
          const r = v.width * 0.92 * (1 - s) ** 0.55 * (1 + waist * Math.sin(Math.PI * s));
          return [r, O[2] - reach * s];
        });
        const [tx, ty] = k.towardViewer(P);
        const sx = -ty;
        const sy = tx;
        const left = side.map(([r, z]) => at([O[0] - sx * r, O[1] - sy * r, z]));
        const right = side.map(([r, z]) => at([O[0] + sx * r, O[1] + sy * r, z]));
        return k.pathOf([...left, tip, ...right.reverse(), ...rim.filter((p) => p[1] >= at(O)[1] - 0.01)], true);
      };
      const top = at(O)[1];
      const bottom = at([O[0], O[1], O[2] - length])[1];
      const grad = `eg-flame-${id}`;
      const svg =
        `<defs><linearGradient id="${grad}" gradientUnits="userSpaceOnUse" x1="0" y1="${top.toFixed(1)}" x2="0" y2="${bottom.toFixed(1)}"><stop offset="0" class="eg-flame-0"/><stop offset=".35" class="eg-flame-1"/><stop offset=".75" class="eg-flame-2"/><stop offset="1" class="eg-flame-3"/></linearGradient></defs>` +
        `<path class="eg-flame-outer" fill="url(#${grad})" d="${plume(length, 0.18)}"/>` +
        `<path class="eg-flame-core" d="${plume(length * 0.42, 0.05)}"/>`;
      return [{ at: [O[0], O[1], O[2] - length / 2], svg }];
    },
  },

  propellant_tank: {
    about: "a rocket's propellant tank, a cylinder with a window showing how full it is; bind `level` (0-1); `fluid` is ox or fuel. Stack tanks with on: <part>.top (the first on combustion_chamber.top). Mounts: base (its bottom, for fins), top, port (a side outlet near the bottom, for pipes).",
    params: { r: { default: 18, min: 8, max: 45 }, h: { default: 60, min: 20, max: 200 }, level: { default: 0.8, min: 0, max: 1 }, fluid: { default: "fuel", options: ["ox", "fuel"] } },
    mounts: (v) => ({ base: [0, 0, 0], top: [0, 0, v.h], port: toward(v.r + 1.8, 7) }),
    extent: (v) => [[-v.r - 1, -v.r - 1, 0], [v.r + 1, v.r + 1, v.h]],
    draw(v, c) {
      const { P, O } = c;
      const [x, y, z] = O;
      const seams = [0.33, 0.66].map((share) => k.sideArc(x, y, v.r, z + v.h * share, P, 40)).join("");
      let svg = S(k.cylinder(x, y, v.r, z + 2, v.h - 4, P, 56), { tone: "hi", crease: "none", inner: L(seams, { tone: "faint" }) + sightWindow(O, v.r + 0.05, z + 8, z + v.h - 8, v.level, P, FLUID[v.fluid]) });
      svg = S(k.cylinder(x, y, v.r + 0.8, z, 2.4, P, 56, 0.3), { tone: "mid" }) + svg + S(k.cylinder(x, y, v.r + 0.8, z + v.h - 2.4, 2.4, P, 56, 0.3), { tone: "mid" });
      svg += portOf(c, v.r, z + 7);
      return [{ at: [x, y, z + v.h / 2], svg }];
    },
  },

  nose_cone: {
    about: "the pointed nose on top of a rocket. Put it on the top tank's top and give it the same radius `r`.",
    params: { r: { default: 18, min: 6, max: 45 }, h: { default: 40, min: 12, max: 140 } },
    mounts: (v) => ({ tip: [0, 0, v.h] }),
    extent: (v) => [[-v.r, -v.r, 0], [v.r, v.r, v.h]],
    draw(v, c) {
      const { P, O } = c;
      const F = up(O);
      const profile = [[0, v.r], ...Array.from({ length: 12 }, (_, i) => {
        const s = (v.h * (i + 1)) / 13;
        return [s, v.r * Math.sqrt(Math.max(0, 1 - (s / v.h) ** 1.6)), 1];
      }), [v.h, 0]];
      return [{ at: [O[0], O[1], O[2] + v.h / 3], svg: S(G.solidOf(profile, F, P, { smooth: { rows: 5 } }), { tone: "hi" }) }];
    },
  },

  fins: {
    about: "three or four fins around the base of a rocket body. Put them on the bottom tank's base and give `r` the tank's radius.",
    params: { r: { default: 18, min: 6, max: 45 }, count: { default: 4, min: 3, max: 4 }, span: { default: 16, min: 6, max: 50 }, h: { default: 34, min: 10, max: 90 } },
    mounts: () => ({}),
    extent: (v) => [[-v.r - v.span, -v.r - v.span, -v.h * 0.18], [v.r + v.span, v.r + v.span, v.h]],
    connector: true,
    draw(v, c) {
      const { P, O } = c;
      const n = Math.round(v.count);
      const items = [];
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * TAU + Math.PI / 4;
        const dir = [Math.cos(angle), Math.sin(angle), 0];
        const side = [-dir[1], dir[0], 0];
        // Root along the body, tip swept down and shorter: a real fin's outline.
        const fin = (along, thick, height) => {
          const reach = along < 0 ? v.r - 0.5 : v.r + v.span;
          const bottom = along < 0 ? 0 : -v.h * 0.18;
          const top = along < 0 ? v.h : v.h * 0.42;
          return add(O, [dir[0] * reach + side[0] * thick * 0.9, dir[1] * reach + side[1] * thick * 0.9, height < 0 ? bottom : top]);
        };
        // Ordered well outside the body, so the near fins paint over it and the far ones under it.
        const anchor = add(O, [dir[0] * (v.r + v.span) * 4, dir[1] * (v.r + v.span) * 4, v.h / 2]);
        items.push({ at: anchor, svg: hexahedron(fin, P, "hi") });
      }
      return items;
    },
  },

  turbopump: {
    about: "a turbopump that hangs below its mount and spins; bind `speed` (0-1). Put it on launch_stand.deck with `at` offsetting it beside the chamber. Mounts: inlet (top side), outlet (lower side), for pipes.",
    params: { r: { default: 7, min: 4, max: 18 }, length: { default: 30, min: 14, max: 70 }, speed: { default: 0, min: 0, max: 1 } },
    mounts: (v) => ({ inlet: toward(v.r + 1.8, -6), outlet: toward(v.r * 1.15 + 1.8, -v.length * 0.8) }),
    extent: (v) => [[-v.r * 1.3, -v.r * 1.3, -v.length], [v.r * 1.3, v.r * 1.3, 0]],
    animated: (v) => v.speed > 0.01,
    draw(v, c) {
      const { P, at, O, t } = c;
      const [x, y, z] = O;
      const r = v.r;
      const pump = [z - v.length * 0.5, z - 3];
      const turbine = [z - v.length, z - v.length * 0.62];
      let svg = S(k.slabOf(plan(x, y, r * 2.4, r * 1.2, 1), z - 3, 3, P, 2, 0.3), { tone: "mid" });
      svg += S(k.cylinder(x, y, r, pump[0], pump[1] - pump[0], P, 32, 0.4), { tone: "hi" });
      svg += S(k.cylinder(x, y, r * 0.45, turbine[1], pump[0] - turbine[1], P, 20), { tone: "mid", crease: "none" });
      // Blades on the turbine housing turn with the shaft.
      const phase = (t * 9 * v.speed) % (TAU / 12);
      const V = G.viewOf(P);
      const blades = [];
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * TAU + phase;
        if (Math.cos(angle) * V[0] + Math.sin(angle) * V[1] <= 0.08) continue;
        const px = x + Math.cos(angle) * r * 1.15;
        const py = y + Math.sin(angle) * r * 1.15;
        blades.push(k.segment([px, py, turbine[0]], [px, py, turbine[1]], P));
      }
      svg += S(k.cylinder(x, y, r * 1.15, turbine[0], turbine[1] - turbine[0], P, 36, 0.4), { tone: "hi", inner: L(blades.join(""), { tone: v.speed > 0.01 ? "mid" : "lo" }) });
      svg += portOf(c, r, z - 6) + portOf(c, r * 1.15, z - v.length * 0.8);
      void at;
      return [{ at: [x, y, z - v.length / 2], svg }];
    },
  },

  pipe: {
    about: "a pipe carrying propellant from one mount to another, bulging out toward the viewer; `to` names the other end as part.mount (usually a port, inlet or outlet); bind `flow` (0-1) to show propellant moving; `fluid` is ox, fuel or gas.",
    params: { to: { ref: true }, bulge: { default: 14, min: 4, max: 60 }, r: { default: 2.2, min: 1, max: 6 }, flow: { default: 0, min: 0, max: 1 }, fluid: { default: "fuel", options: ["ox", "fuel", "gas"] } },
    mounts: () => ({}),
    extent: () => [[0, 0, 0], [0, 0, 0]],
    connector: true,
    draw(v, c) {
      const { P, O, mountAt } = c;
      const end = mountAt(v.to);
      if (!end) return [{ at: O, svg: "" }];
      const out = viewer(P).map((value) => value * v.bulge);
      const a = O;
      const b = end;
      const route = G.fillet([a, add(a, out), add([b[0], b[1], a[2]], out), add(b, out), b].filter((p, i, list) => i === 0 || G.len3(G.sub3(p, list[i - 1])) > 0.5), Math.max(v.r * 2.5, 4), 10, { P, tube: v.r });
      const pieces = tubePieces(route, v.r, P, { maxLength: 400, spacing: 1.2 });
      const body = pieces.map((piece) => tubeSvg(piece, { tone: "hi" })).join("");
      const fx = Math.max(0, Math.min(1, v.flow));
      const svg = `<g class="eg-fluid" data-fluid="${FLUID[v.fluid]}" style="--fx:${fx.toFixed(2)}">${body}</g>`;
      // Ordered at the pipe's nearest point, so it paints over the bodies it runs in front of.
      const nearest = route.reduce((best, p) => (k.depthOf(p, P) > k.depthOf(best, P) ? p : best), route[0]);
      return [{ at: nearest, bias: 2, svg }];
    },
  },
};

// A small boss on a round body where a pipe connects, on the side facing the viewer.
function portOf(c, r, z) {
  const { P, O } = c;
  const dir = FRONT;
  const base = [O[0] + dir[0] * (r - 0.6), O[1] + dir[1] * (r - 0.6), z];
  const F = G.frameAlong(base, dir);
  return S(G.disc(0, 2.4, 2.8, F, P), { tone: "mid" });
}
