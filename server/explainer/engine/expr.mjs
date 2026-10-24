// Formulas in a scene description come from a model, so they are parsed here, never
// evaluated as JavaScript. The grammar is arithmetic, comparisons, `&&`, `||`, `!`,
// `a ? b : c`, names (with dotted `input.x`), 'quoted' option names and a short list of pure functions.
const FUNCTIONS = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  sqrt: (x) => Math.sqrt(Math.max(0, x)),
  sin: Math.sin,
  cos: Math.cos,
  atan2: Math.atan2,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
  lerp: (a, b, t) => a + (b - a) * t,
};
const CONSTANTS = { pi: Math.PI, g: 9.81 };
const MAX_LENGTH = 400;
const MAX_NODES = 200;

function tokenize(text) {
  if (typeof text !== "string" || !text.length || text.length > MAX_LENGTH) throw Error("formula_length");
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)|(\*\*|&&|\|\||==|!=|<=|>=|[-+*/%^()<>!?:,])|'([A-Za-z0-9_ -]{0,48})')/y;
  let at = 0;
  while (at < text.length) {
    if (/\s/.test(text[at])) {
      at++;
      continue;
    }
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    if (!match) throw Error(`formula_token:${text.slice(at, at + 8)}`);
    at = pattern.lastIndex;
    if (match[1]) tokens.push({ type: "num", value: Number(match[1]) });
    else if (match[2]) tokens.push({ type: "name", value: match[2] });
    else if (match[3]) tokens.push({ type: "op", value: match[3] === "**" ? "^" : match[3] });
    else tokens.push({ type: "str", value: match[4] });
  }
  return tokens;
}

const BINARY = [["||"], ["&&"], ["==", "!="], ["<", ">", "<=", ">="], ["+", "-"], ["*", "/", "%"]];

export function parse(text) {
  const tokens = tokenize(text);
  let at = 0;
  let nodes = 0;
  const node = (value) => {
    if (++nodes > MAX_NODES) throw Error("formula_size");
    return value;
  };
  const peek = (value) => tokens[at] && tokens[at].type === "op" && tokens[at].value === value;
  const expect = (value) => {
    if (!peek(value)) throw Error(`formula_expected:${value}`);
    at++;
  };
  const ternary = () => {
    const test = binary(0);
    if (!peek("?")) return test;
    at++;
    const yes = ternary();
    expect(":");
    return node({ kind: "if", test, yes, no: ternary() });
  };
  const binary = (level) => {
    if (level === BINARY.length) return power();
    let left = binary(level + 1);
    while (tokens[at] && tokens[at].type === "op" && BINARY[level].includes(tokens[at].value)) {
      const op = tokens[at++].value;
      left = node({ kind: "bin", op, left, right: binary(level + 1) });
    }
    return left;
  };
  const power = () => {
    const base = unary();
    if (!peek("^")) return base;
    at++;
    return node({ kind: "bin", op: "^", left: base, right: power() });
  };
  const unary = () => {
    if (peek("-") || peek("!") || peek("+")) {
      const op = tokens[at++].value;
      return node({ kind: "un", op, value: unary() });
    }
    return atom();
  };
  const atom = () => {
    const token = tokens[at++];
    if (!token) throw Error("formula_end");
    if (token.type === "num") return node({ kind: "num", value: token.value });
    if (token.type === "str") return node({ kind: "str", value: token.value });
    if (token.type === "op" && token.value === "(") {
      const inner = ternary();
      expect(")");
      return inner;
    }
    if (token.type === "name") {
      if (peek("(")) {
        if (!Object.hasOwn(FUNCTIONS, token.value)) throw Error(`formula_function:${token.value}`);
        at++;
        const args = [];
        if (!peek(")")) {
          args.push(ternary());
          while (peek(",")) {
            at++;
            args.push(ternary());
          }
        }
        expect(")");
        return node({ kind: "call", name: token.value, args });
      }
      return node({ kind: "name", name: token.value });
    }
    throw Error(`formula_unexpected:${token.value}`);
  };
  const tree = ternary();
  if (at !== tokens.length) throw Error("formula_trailing");
  return tree;
}

// Every name a formula reads, so a description can be checked before anything runs.
export function namesOf(tree, out = new Set()) {
  if (tree.kind === "name") out.add(tree.name);
  for (const key of ["left", "right", "value", "test", "yes", "no"]) if (tree[key] && typeof tree[key] === "object") namesOf(tree[key], out);
  for (const arg of tree.args ?? []) namesOf(arg, out);
  return out;
}

export function evaluate(tree, scope) {
  switch (tree.kind) {
    case "num":
    case "str":
      return tree.value;
    case "name": {
      if (Object.hasOwn(scope, tree.name)) return scope[tree.name];
      if (Object.hasOwn(CONSTANTS, tree.name)) return CONSTANTS[tree.name];
      throw Error(`formula_name:${tree.name}`);
    }
    case "un": {
      const value = evaluate(tree.value, scope);
      return tree.op === "-" ? -value : tree.op === "!" ? (value ? 0 : 1) : +value;
    }
    case "if":
      return evaluate(tree.test, scope) ? evaluate(tree.yes, scope) : evaluate(tree.no, scope);
    case "call":
      return FUNCTIONS[tree.name](...tree.args.map((arg) => evaluate(arg, scope)));
    case "bin": {
      const a = evaluate(tree.left, scope);
      if (tree.op === "&&") return a ? evaluate(tree.right, scope) : a;
      if (tree.op === "||") return a ? a : evaluate(tree.right, scope);
      const b = evaluate(tree.right, scope);
      switch (tree.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return b === 0 ? 0 : a / b;
        case "%": return b === 0 ? 0 : a % b;
        case "^": return a ** b;
        case "<": return a < b ? 1 : 0;
        case ">": return a > b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0;
        case ">=": return a >= b ? 1 : 0;
        case "==": return a === b ? 1 : 0;
        case "!=": return a !== b ? 1 : 0;
      }
    }
  }
  throw Error("formula_kind");
}

export const KNOWN_NAMES = Object.keys(CONSTANTS);
