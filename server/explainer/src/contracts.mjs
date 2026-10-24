import { compile } from "./schema-validator.mjs";
// Compatibility for existing package/browser consumers; this performs no code generation.
export const ajv = { compile };
export const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const id = {
  type: "string",
  minLength: 1,
  maxLength: 100,
  pattern: "^[a-zA-Z0-9_-]+$",
};
export const revision = { type: "integer", minimum: 0 };
export const intentSchema = object({
  learning_goal: { type: "string", minLength: 8, maxLength: 1200 },
  concept: { type: "string", minLength: 2, maxLength: 500 },
  interaction: { type: "string", minLength: 8, maxLength: 1600 },
  representation: {
    type: "string",
    enum: ["isometric", "mathematical", "language", "timeline", "other"],
  },
  model_kind: { type: "string", enum: ["factual", "simplified", "analogy"] },
  assumptions: {
    type: "array",
    maxItems: 12,
    items: { type: "string", maxLength: 500 },
  },
  limitations: {
    type: "array",
    maxItems: 12,
    items: { type: "string", maxLength: 500 },
  },
});
const sceneRef = {
  scene_id: id,
  scene_version: { type: "integer", minimum: 1 },
};
export const toolSchemas = {
  create_explainer: object({ intent: intentSchema }),
  revise_explainer: object({ ...sceneRef, intent: intentSchema }),
  control_explainer: object({
    ...sceneRef,
    expected_state_revision: revision,
    name: { type: "string", pattern: "^[a-z][a-z0-9_]{0,47}$" },
    input: { type: "object" },
  }),
  get_explainer_state: object({}),
  get_generation_status: object({ job_id: id }),
  cancel_generation: object({ job_id: id }),
};
export const toolEnvelope = object({
  request_id: id,
  name: { enum: Object.keys(toolSchemas) },
  arguments: { type: "object" },
});
export const turnSchema = object(
  {
    request_id: id,
    text: { type: "string", minLength: 1, maxLength: 4000 },
    heard: {
      type: "array",
      maxItems: 12,
      items: object({
        speaker: { enum: ["genius", "rookie", "child"] },
        text: { type: "string", maxLength: 700 },
      }),
    },
  },
  ["request_id", "text"],
);
export const eventSchema = object(
  {
    session_id: id,
    scene_id: id,
    scene_version: { type: "integer", minimum: 1 },
    event_id: id,
    kind: {
      enum: [
        "ready",
        "action_applied",
        "action_rejected",
        "state_changed",
        "interaction_completed",
        "runtime_error",
      ],
    },
    state_revision: revision,
    state: { type: "object" },
    request_id: id,
    error: { type: "string", maxLength: 500 },
  },
  [
    "session_id",
    "scene_id",
    "scene_version",
    "event_id",
    "kind",
    "state_revision",
    "state",
  ],
);
export function assertSchema(schema, value) {
  const validate = ajv.compile(schema);
  if (!validate(value))
    throw Object.assign(new Error("Invalid request schema"), {
      status: 400,
      code: "invalid_schema",
      details: validate.errors,
    });
  return value;
}
export function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}
// Deliberately limited schema dialect, identically supported in the browser runtime.
export function checkDialect(schema, depth = 0) {
  if (
    depth > 8 ||
    !schema ||
    typeof schema !== "object" ||
    Array.isArray(schema)
  )
    throw new Error("Invalid schema depth");
  const allowed = [
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "enum",
    "description",
  ];
  for (const key of Object.keys(schema))
    if (!allowed.includes(key))
      throw new Error(`Unsupported schema keyword: ${key}`);
  if (
    ![
      "object",
      "array",
      "number",
      "integer",
      "string",
      "boolean",
      "null",
    ].includes(schema.type)
  )
    throw new Error("Schema requires explicit type");
  if (schema.type === "object") {
    if (schema.additionalProperties !== false)
      throw new Error("Objects must prohibit additionalProperties");
    for (const child of Object.values(schema.properties || {}))
      checkDialect(child, depth + 1);
  }
  if (schema.type === "array") {
    if (!Number.isInteger(schema.maxItems) || schema.maxItems > 100)
      throw new Error("Arrays require maxItems <= 100");
    checkDialect(schema.items, depth + 1);
  }
  if (
    schema.type === "string" &&
    (!Number.isInteger(schema.maxLength) || schema.maxLength > 2000)
  )
    throw new Error("Strings require maxLength <= 2000");
  if (
    ["number", "integer"].includes(schema.type) &&
    (!Number.isFinite(schema.minimum) || !Number.isFinite(schema.maximum))
  )
    throw new Error("Numeric values require bounds");
  for (const key of ["minimum", "maximum"])
    if (schema[key] !== undefined && !Number.isFinite(schema[key]))
      throw Error("Invalid schema bound: " + key);
  if (schema.description !== undefined && typeof schema.description !== "string")
    throw Error("Invalid schema description");
  if (schema.required !== undefined && (!Array.isArray(schema.required) ||
      schema.required.some(x => typeof x !== "string") || new Set(schema.required).size !== schema.required.length))
    throw Error("Invalid schema required");
  if (schema.properties !== undefined && (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)))
    throw Error("Invalid schema properties");
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length))
    throw Error("Invalid schema enum");
  for (const key of ["minLength", "maxLength", "minItems", "maxItems"])
    if (schema[key] !== undefined && (!Number.isInteger(schema[key]) || schema[key] < 0))
      throw Error("Invalid schema bound: " + key);
  if ((schema.minimum !== undefined && schema.maximum !== undefined && schema.minimum > schema.maximum) ||
      (schema.minItems !== undefined && schema.maxItems !== undefined && schema.minItems > schema.maxItems) ||
      (schema.minLength !== undefined && schema.maxLength !== undefined && schema.minLength > schema.maxLength))
    throw Error("Invalid schema bounds");
}
