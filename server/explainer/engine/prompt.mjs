// The describer's instructions, generated from the catalog so the model is only ever told
// about parts that exist, with their real parameter ranges.
import { catalogText } from "./catalog.mjs";
import { LIMITS } from "./describe.mjs";
import { example } from "./dist/engine-source.mjs";

export function describerInstructions() {
  return `You design one small, real piece of bench apparatus that lets a child see and test the answer to their question, and you describe it as JSON lines for a scene engine. Output only JSON lines, one operation per line, no prose, no code fences.

Order matters because the scene is built while you write: scene first, then the bench, then each part after the part it sits on. Declare a value before any derive, binding, control or readout that uses it.

Operations (words in <angle brackets> are placeholders for your own names):
{"op":"scene","title","learning_goal","model_kind":"factual|simplified|analogy","assumptions":[],"limitations":[],"stage":{"w","d","h"}}  stage is the box (world units, about 1 mm) everything fits in, with every part at its largest values (most stretch, tallest stack, steepest tilt); keep it otherwise tight.
{"op":"value","name","label","min","max","initial","integer"?,"unit"?}  or with "options":[...] instead of a range. These are the experiment's state.
{"op":"derive","name","expr","unit"?}  a formula over values and earlier derives.
{"op":"part","id","kind","on":"<part id>.<mount>","at":[x,y],"params":{"<param>":number},"bind":{"<param>":"<formula>"}}  the bench has no "on"; "at" offsets a part from its mount (on bench.top it is the floor position). "at" and "params" are plain numbers, never formulas; anything that moves goes in "bind". Use only the mounts listed for each kind.
{"op":"control","name","label","input":{"<field>":{"type":"integer|number","min","max"} | {"options":[...]}},"set":{"<value name>":"<formula using input.<field>>"}}  each key of "set" is the name of a declared value.
{"op":"touch","part","control","input":{"<field>":"<formula>"}}  what tapping that part does; there must be at least one.
{"op":"readout","text":"... {value} ... {derive:1} ..."}  the live reading, digits after the colon; keep it under 50 characters, like an instrument display.
{"op":"beat","speaker":"genie|rookie","say","cues":[{"word":n,"focus":"<part id>"} | {"word":n,"control":"<control name>","input":{"<field>":value}}]}  focus names a part, never a value.  lines the characters say, with the word at which a part is highlighted or a control runs.

Formulas: numbers, value and derive names, input.field inside controls, + - * / ^ %, comparisons, && || !, a ? b : c, 'option' strings, and min max abs sqrt sin cos atan2 floor ceil round clamp lerp; constants g and pi. Nothing else.

World: x and y are the floor, z is up, about 1 unit per millimetre. The camera looks from +x, +y and above, so faces toward +x and +y are the visible ones; put scales behind (lower y than) what they measure.

Limits: ${LIMITS.parts} parts, ${LIMITS.values} values, ${LIMITS.controls} controls, ${LIMITS.beats} beats. The built-in controls point_at, pause and reset already exist; do not declare them.

Make the physics true: the readout and every moving part come from the same formulas. Prefer few parts that each mean something. Two to four beats; cue the parts as they are named.

Parts:
${catalogText()}

Example for "Why does a heavier weight stretch a spring more?":
${example}
`;
}
