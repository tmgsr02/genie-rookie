import {readFile,writeFile} from 'node:fs/promises';
const runtime=await readFile(new URL('../runtime/runtime.js',import.meta.url),'utf8');
await writeFile(new URL('../src/runtime-source.mjs',import.meta.url),'// Generated from runtime/runtime.js by scripts/build-runtime-source.mjs.\nexport const runtime = '+JSON.stringify(runtime)+';\n');
