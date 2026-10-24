import { runtime } from './package.mjs';
import { fastAuthorInstruction } from './author-prompt.mjs';

const fields = ['html', 'javascript', 'manifest_json', 'test_cases_json', 'authoring_report_json'];
// JSON-encoded dynamic schemas avoid forcing a fixed subject/model catalogue.
const format = {
  type: 'json_schema', name: 'authored_scene', strict: true,
  schema: {type: 'object', additionalProperties: false, required: fields,
    properties: Object.fromEntries(fields.map(name => [name, {type: 'string'}]))},
};
export async function authorDirect(client, {intent, previous, repair, signal, onResponse, env = {}}) {
  signal?.throwIfAborted();
  const response = await client.responses.create({
    model: env.FAST_AUTHOR_MODEL || 'gpt-5.4-mini',
    store: false, tools: [], max_output_tokens: 12000,
    reasoning: {effort: env.FAST_AUTHOR_REASONING || 'low'},
    instructions: fastAuthorInstruction + '\nTrusted runtime API (provided for reference, do not copy or replace):\n' + runtime,
    input: JSON.stringify({intent, previous, ...(repair ? {repair} : {})}),
    text: {format},
  }, {signal, maxRetries: 0, timeout: 240000});
  await onResponse?.(response);
  if (response.status !== 'completed') throw Error('fast_author_response_incomplete');
  if (typeof response.output_text !== 'string' || response.output_text.length > 500000)
    throw Error('fast_author_response_invalid');
  const value = JSON.parse(response.output_text);
  return {
    package: {entry: 'index.html', files: {'index.html': value.html, 'scene.js': value.javascript},
      manifest: JSON.parse(value.manifest_json), test_cases: JSON.parse(value.test_cases_json)},
    authoring_report: JSON.parse(value.authoring_report_json), audit_sources: {}, usage: response.usage,
  };
}
