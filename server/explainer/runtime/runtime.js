/* Trusted shared reducer/bridge runtime. Generated scenes call ExplainerScene.register once. */
(() => {
  "use strict";
  let identity = null,
    spec = null,
    state = null,
    revision = 0,
    paused = false;
  const seen = new Set();
  let serial = 0;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  function valid(s, v) {
    if (s.enum && !s.enum.some((x) => JSON.stringify(x) === JSON.stringify(v)))
      return false;
    if (s.type === "object") {
      if (!v || typeof v !== "object" || Array.isArray(v)) return false;
      if ((s.required || []).some((k) => !Object.hasOwn(v, k))) return false;
      return Object.keys(v).every(
        (k) =>
          Object.hasOwn(s.properties || {}, k) && valid(s.properties[k], v[k]),
      );
    }
    if (s.type === "array")
      return (
        Array.isArray(v) &&
        v.length >= (s.minItems || 0) &&
        v.length <= s.maxItems &&
        v.every((x) => valid(s.items, x))
      );
    if (s.type === "string")
      return (
        typeof v === "string" &&
        v.length >= (s.minLength || 0) &&
        v.length <= s.maxLength
      );
    if (s.type === "number" || s.type === "integer")
      return (
        Number.isFinite(v) &&
        (s.type !== "integer" || Number.isInteger(v)) &&
        v >= s.minimum &&
        v <= s.maximum
      );
    return s.type === "null" ? v === null : typeof v === s.type;
  }
  function emit(kind, request_id, error) {
    if (!identity) return;
    const message = {
      ...identity,
      event_id:
        identity.scene_id + "_" + identity.scene_version + "_" + ++serial,
      kind,
      state_revision: revision,
      state: clone(state),
      ...(request_id ? { request_id } : {}),
      ...(error ? { error: String(error).slice(0, 300) } : {}),
    };
    window.webkit?.messageHandlers?.explainer?.postMessage(message);
    window.dispatchEvent(
      new CustomEvent("explainer-event", { detail: message }),
    );
  }
  function render() {
    spec.render(clone(state), {
      paused,
      reduced_motion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  }
  function apply(command) {
    const rid = command?.request_id;
    try {
      if (!spec || !identity) throw Error("not_ready");
      if (
        !command ||
        command.session_id !== identity.session_id ||
        command.scene_id !== identity.scene_id ||
        command.scene_version !== identity.scene_version
      )
        throw Error("stale_scene");
      if (typeof rid !== "string" || !rid || seen.has(rid))
        throw Error("duplicate_request");
      if (seen.size >= 10000) throw Error("session_action_limit");
      seen.add(rid);
      if (command.expected_state_revision !== revision)
        throw Error("stale_state");
      const control = spec.controls.find((c) => c.name === command.name);
      if (!control || !valid(control.input_schema, command.input))
        throw Error("invalid_control_input");
      const next = spec.reduce(
        clone(state),
        command.name,
        clone(command.input),
      );
      if (!valid(spec.state_schema, next)) throw Error("invalid_model_state");
      if (command.name === "pause" && next.paused !== command.input.paused)
        throw Error("pause_state_mismatch");
      if (command.name === "reset" && next.paused !== false)
        throw Error("reset_pause_mismatch");
      if (spec.invariants(clone(next)) !== true)
        throw Error("model_invariant_failed");
      const previous = state,
        previousPaused = paused;
      state = next;
      paused = next.paused;
      try {
        render();
      } catch (error) {
        state = previous;
        paused = previousPaused;
        throw error;
      }
      revision++;
      seen.add(rid);
      emit("action_applied", rid);
      emit("state_changed", rid);
      if (spec.completed?.(clone(state), {name: command.name, source: rid.startsWith("touch_") ? "touch" : "command"})) emit("interaction_completed", rid);
    } catch (error) {
      emit("action_rejected", rid, error.message);
    }
  }
  window.explainerBootstrap = (value) => {
    if (identity) return;
    if (
      !value ||
      typeof value.session_id !== "string" ||
      typeof value.scene_id !== "string" ||
      !Number.isInteger(value.scene_version)
    )
      return;
    identity = Object.freeze({ ...value });
    if (spec) emit("ready");
  };
  window.explainerCommand = apply;
  window.ExplainerScene = Object.freeze({
    register(value) {
      if (spec) throw Error("already_registered");
      spec = value;
      state = clone(spec.initial_state);
      if (state.paused !== false) throw Error("initial_pause_state");
      if (
        !valid(spec.state_schema, state) ||
        spec.invariants(clone(state)) !== true
      )
        throw Error("invalid_initial_state");
      render();
      if (identity) emit("ready");
    },
    act(name, input) {
      apply({
        ...identity,
        request_id: "touch_" + Date.now() + "_" + ++serial,
        expected_state_revision: revision,
        name,
        input,
      });
    },
    contract() {
      return clone({
        controls: spec.controls,
        state_schema: spec.state_schema,
      });
    },
    snapshot() {
      return { state: clone(state), state_revision: revision };
    },
    pause(value = true) {
      paused = !!value;
      render();
    },
    isPaused() {
      return (
        paused ||
        document.hidden ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    },
  });
  window.addEventListener("error", (event) =>
    emit("runtime_error", null, event.message),
  );
  window.addEventListener("unhandledrejection", () =>
    emit("runtime_error", null, "unhandled_rejection"),
  );
  document.addEventListener("visibilitychange", () => {
    if (spec) render();
  });
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
    "change",
    () => {
      if (spec) render();
    },
  );
})();
