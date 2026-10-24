// Preserve shared package references while keeping stored values plain JSON.
// This avoids repeating a large scene in jobs, active state and replay responses.
export function encodeState(root) {
  const seen = new Map(), nodes = [];
  function encode(value) {
    if (value === undefined) return null;
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return { ref: seen.get(value) };
    const id = nodes.length; seen.set(value, id); nodes.push(null);
    nodes[id] = Array.isArray(value)
      ? { array: value.map(encode) }
      : { object: Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).map(([key,v]) => [key,encode(v)])) };
    return { ref: id };
  }
  const reference = encode(root);
  return JSON.stringify({ version: 1, root: reference, nodes });
}
export function decodeState(text) {
  const data = JSON.parse(text);
  if (data.version !== 1 || !Array.isArray(data.nodes)) throw Error('invalid_state');
  const objects = data.nodes.map(node => Array.isArray(node.array) ? [] : {});
  function decode(value) {
    if (value === null || typeof value !== 'object') return value;
    if (!Number.isSafeInteger(value.ref) || value.ref < 0 || value.ref >= objects.length) throw Error('invalid_state_reference');
    return objects[value.ref];
  }
  data.nodes.forEach((node,index) => {
    if (Array.isArray(node.array)) objects[index].push(...node.array.map(decode));
    else if (node.object && typeof node.object === 'object') {
      for (const [key,value] of Object.entries(node.object)) {
        if (['__proto__','constructor','prototype'].includes(key)) Object.defineProperty(objects[index],key,{value:decode(value),enumerable:true,writable:true});
        else objects[index][key] = decode(value);
      }
    } else throw Error('invalid_state_node');
  });
  return decode(data.root);
}
