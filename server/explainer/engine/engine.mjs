// The in-page compiler. It turns a growing description into live SVG: each part is built
// from the catalog as its op arrives, numbers ease toward their targets on a damped
// spring, and only parts whose resolved values changed are rebuilt on a frame.
import * as k from "../vendor/anatomy/kit/iso-kit.mjs";
import { CATALOG } from "./catalog.mjs";
import { createDescription, applyOp, initialState, scopeOf, resolve, layout, readoutOf, boxesOf, stageOf, mountResolver } from "./describe.mjs";

const W = 600;
const H = 520;
const SPRING = { stiffness: 120, damping: 11 };
// Labels come from the description, so they are escaped before they reach markup.
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function createEngine(root, { onTouch = () => {}, onError = () => {}, fig = "Fig 1", stagger = 0 } = {}) {
  const desc = createDescription();
  root.innerHTML =
    `<figure class="iso-figure eg"><div class="iso-plate"><div class="iso-plate-corners" aria-hidden="true">` +
    `<span class="iso-plate-corner" data-corner="fig">${fig}</span><span class="iso-plate-corner" data-corner="title" data-title></span>` +
    `<span class="iso-plate-corner" data-corner="readout" data-readout></span></div>` +
    `<svg class="iso-svg eg-svg" viewBox="0 0 ${W} ${H}" role="img"><defs><radialGradient id="eg-glow-fill"><stop offset="0" class="eg-glow-0"/><stop offset=".45" class="eg-glow-1"/><stop offset="1" class="eg-glow-2"/></radialGradient></defs><g class="eg-items"></g><g class="eg-hits"></g></svg>` +
    `</div></figure>`;
  const svg = root.querySelector("svg");
  const itemsLayer = svg.querySelector(".eg-items");
  const hitsLayer = svg.querySelector(".eg-hits");
  const title = root.querySelector("[data-title]");
  const readout = root.querySelector("[data-readout]");

  let P = null;
  let target = null;
  const shown = new Map();
  const nodes = new Map();
  const signatures = new Map();
  let paused = false;
  let reduced = false;
  let frame = 0;
  let last = 0;
  let clock = 0;
  let animating = false;
  const pendingArrivals = new Map();
  let arrivals = 0;

  const at = (point) => k.iso(point, P);
  let framed = null;

  // Fit the camera to the stage, and widen it once if a new part needs more room.
  function frame_() {
    if (!desc.scene) return;
    const { w, d, h } = stageOf(desc);
    if (framed && w <= framed.w && d <= framed.d && h <= framed.h) return;
    framed = { w, d, h };
    P = k.fitProjection(k.boxCorners({ x: -w / 2, y: -d / 2, w, d }, -18, h), W, H, { pad: 10, azimuth: 45 });
    signatures.clear();
  }

  function ensureState() {
    if (!target) target = initialState(desc);
    for (const value of desc.values.values()) {
      if (!Object.hasOwn(target, value.name)) target[value.name] = value.initial;
      if (!value.options && !shown.has(value.name)) shown.set(value.name, { x: target[value.name], v: 0 });
    }
  }

  function shownState() {
    const state = { ...target };
    for (const [name, spring] of shown) if (desc.values.has(name) && !desc.values.get(name).options) state[name] = spring.x;
    return state;
  }

  function feed(op) {
    const note = applyOp(desc, op);
    if (note.kind === "scene") {
      title.textContent = desc.scene.title;
      svg.setAttribute("aria-label", desc.scene.learning_goal);
    }
    if (note.kind === "part" && !note.replaced) pendingArrivals.set(note.id, stagger * arrivals++);
    frame_();
    if (note.kind === "remove") dropPart(note.id);
    if (note.kind === "value" && target && !desc.values.get(note.name).options) {
      const value = desc.values.get(note.name);
      if (!Object.hasOwn(target, note.name)) target[note.name] = value.initial;
      target[note.name] = Math.min(value.max, Math.max(value.min, target[note.name]));
    }
    ensureState();
    if (!desc.values.has("focus") && target.focus !== "none" && !desc.parts.has(target.focus)) target.focus = "none";
    kick();
    return note;
  }

  function dropPart(id) {
    for (const node of nodes.get(id) ?? []) node.remove();
    nodes.delete(id);
    signatures.delete(id);
  }

  function drawPart(part, entry, arriving, mountAt) {
    const items = CATALOG[part.kind].draw(entry.v, { P, at, O: entry.origin, k, t: clock, id: part.id, mountAt });
    const old = nodes.get(part.id) ?? [];
    const fresh = items.map((item, index) => {
      const node = old[index] ?? document.createElementNS("http://www.w3.org/2000/svg", "g");
      node.classList.add("eg-it");
      node.dataset.part = part.id;
      node.dataset.key = String(k.depthOf(item.at, P) + (item.bias ?? 0) * 0.01 + (index * 1e-4));
      node.innerHTML = item.svg;
      if (arriving !== undefined) {
        node.classList.add("eg-arrive");
        node.addEventListener("animationend", () => node.classList.remove("eg-arrive"), { once: true });
        if (arriving) node.style.setProperty("--eg-delay", `${arriving}ms`);
      }
      return node;
    });
    for (const node of old.slice(items.length)) node.remove();
    nodes.set(part.id, fresh);
  }

  function order() {
    const all = [...nodes.values()].flat().sort((a, b) => Number(a.dataset.key) - Number(b.dataset.key));
    let index = 0;
    for (const node of all) {
      if (itemsLayer.children[index] !== node) itemsLayer.insertBefore(node, itemsLayer.children[index] ?? null);
      index++;
    }
  }

  function hits(state) {
    const boxes = boxesOf(desc, state);
    const markup = [];
    for (const touch of desc.touches.values()) {
      const box = boxes.get(touch.part);
      if (!box) continue;
      const corners = [];
      for (const x of [box[0][0], box[1][0]]) for (const y of [box[0][1], box[1][1]]) for (const z of [box[0][2], box[1][2]]) corners.push(at([x, y, z]));
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      const pad = 6;
      const [x0, y0, x1, y1] = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
      const label = desc.controls.get(touch.control)?.label ?? "Try it";
      markup.push(`<rect class="eg-hit" data-action="${touch.control}" data-part="${touch.part}" role="button" tabindex="0" aria-label="${escape(label)}" x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(y1 - y0).toFixed(1)}" rx="10"/>`);
    }
    const text = markup.join("");
    if (hitsLayer.dataset.markup !== text) {
      hitsLayer.innerHTML = text;
      hitsLayer.dataset.markup = text;
    }
  }

  function paint() {
    if (!P || !target) return;
    const state = shownState();
    let scope;
    try {
      scope = scopeOf(desc, state);
    } catch (error) {
      onError(error);
      return;
    }
    const values = new Map();
    for (const part of desc.parts.values()) values.set(part.id, resolve(desc, part, state, scope));
    const placed = layout(desc, state, (part) => values.get(part.id));
    const mountAt = mountResolver(desc, placed);
    let changed = false;
    animating = false;
    for (const part of desc.parts.values()) {
      const entry = placed.get(part.id);
      // Animated parts (a flame, a spinning pump) redraw every frame while motion is allowed.
      const live = !reduced && !paused && !!CATALOG[part.kind].animated?.(entry.v);
      if (live) animating = true;
      const ends = Object.entries(CATALOG[part.kind].params).filter(([, spec]) => spec.ref).map(([name]) => mountAt(entry.v[name]));
      const signature = JSON.stringify([part.kind, entry.origin.map((n) => Math.round(n * 20)), Object.values(entry.v).map((n) => (typeof n === "number" ? Math.round(n * 200) : n)), ends, live ? Math.round(clock * 30) : 0]);
      if (signatures.get(part.id) === signature) continue;
      signatures.set(part.id, signature);
      drawPart(part, entry, pendingArrivals.get(part.id), mountAt);
      pendingArrivals.delete(part.id);
      changed = true;
    }
    for (const id of nodes.keys()) if (!desc.parts.has(id)) dropPart(id);
    if (changed) order();
    for (const [id, list] of nodes) {
      const on = target.focus === id;
      const dim = target.focus !== "none" && !on && desc.parts.get(id)?.kind !== "bench";
      for (const node of list) {
        node.toggleAttribute("data-on", on);
        node.toggleAttribute("data-dim", dim);
      }
    }
    hits(target);
    const text = readoutOf(desc, target);
    if (readout.textContent !== text) readout.textContent = text;
  }

  function step(dt) {
    let moving = false;
    for (const [name, spring] of shown) {
      const value = desc.values.get(name);
      if (!value || value.options) continue;
      const goal = target[name];
      if (reduced || paused) {
        if (reduced) {
          spring.x = goal;
          spring.v = 0;
        }
        continue;
      }
      for (let index = 0; index < 4; index++) {
        const h = dt / 4;
        spring.v += ((goal - spring.x) * SPRING.stiffness - spring.v * SPRING.damping) * h;
        spring.x += spring.v * h;
      }
      if (Math.abs(goal - spring.x) < 1e-3 * (value.max - value.min) && Math.abs(spring.v) < 1e-3 * (value.max - value.min)) {
        spring.x = goal;
        spring.v = 0;
      } else moving = true;
    }
    return moving;
  }

  function tick(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    if (!paused && !reduced) clock += dt;
    const moving = step(dt);
    paint();
    frame = moving || (animating && !document.hidden) ? requestAnimationFrame(tick) : 0;
    if (!frame) last = 0;
  }

  function kick() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  hitsLayer.addEventListener("click", (event) => {
    const hit = event.target.closest?.("[data-part]");
    if (hit) onTouch(hit.dataset.part);
  });
  hitsLayer.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const hit = event.target.closest?.("[data-part]");
    if (!hit) return;
    event.preventDefault();
    onTouch(hit.dataset.part);
  });

  return {
    desc,
    feed,
    get state() {
      return { ...target };
    },
    // Show a state: numbers glide there unless motion is reduced.
    show(state, options = {}) {
      paused = !!options.paused;
      reduced = !!options.reduced_motion;
      target = { ...state };
      ensureState();
      if (reduced) step(0);
      paint();
      kick();
    },
    paintNow: paint,
  };
}
