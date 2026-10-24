export function json(value, status = 200) {
  return Response.json(value, {status, headers: {'Cache-Control': 'no-store'}});
}
export function fail(code, status = 400) {
  throw Object.assign(new Error(code), {code, status});
}
export function errorResponse(error) {
  // TEMPORARY diagnostic: unexpected errors are otherwise swallowed into service_error.
  if (!error?.status) console.error('service_error', error?.name, error?.message, error?.stack);
  return json({error: error.status ? error.code : 'service_error'}, error.status || 500);
}
export async function readJSON(request, limit = 16384) {
  if (Number(request.headers.get('content-length')) > limit) fail('body_limit', 413);
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) fail('body_limit', 413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes) || '{}'); }
    catch {fail('invalid_json');}
  } finally {try {await reader.cancel();} catch {} reader.releaseLock();}
}
export const bearer = request => /^Bearer ([^ ]+)$/.exec(request.headers.get('authorization') || '')?.[1] || '';
export function emptyBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) fail('invalid_schema');
}
