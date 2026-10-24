import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
const pkg = require.resolve(`@openai/codex-linux-${process.arch}/package.json`);
const binary = join(dirname(pkg), 'vendor', `${arch}-unknown-linux-musl`, 'bin', 'codex');
await mkdir('/work/job', {recursive:true});
await mkdir('/work/home', {recursive:true});
const ca = await readFile('/etc/ssl/certs/ca-certificates.crt', 'utf8');
if (!ca.includes('BEGIN CERTIFICATE')) throw Error('missing_system_ca_certificates');
await writeFile('/work/job/check.cjs', `
const fs=require('node:fs'), net=require('node:net');
const anatomy=fs.readFileSync('/app/vendor/anatomy/SKILL.md','utf8').includes('name: anatomy');
fs.writeFileSync('/work/job/allowed.txt','ok');
let outside=false;try{fs.writeFileSync('/work/outside.txt','bad')}catch(e){outside=['EROFS','EACCES','EPERM'].includes(e.code)}
if(!outside||!anatomy)throw Error('filesystem_boundary_failed');
const socket=net.connect({host:'1.1.1.1',port:443});
socket.setTimeout(3000);
socket.on('connect',()=>{socket.destroy();throw Error('tool_network_not_blocked')});
socket.on('timeout',()=>{socket.destroy();throw Error('network_boundary_inconclusive')});
socket.on('error',e=>{if(!['ENETUNREACH','EACCES','EPERM'].includes(e.code))throw e;fs.writeFileSync('/work/job/result.json',JSON.stringify({system_ca:true,anatomy_readable:anatomy,workspace_write:true,outside_write_blocked:outside,tool_network_blocked:true}))});
`);
const {stdout} = await promisify(execFile)(binary, [
  'sandbox', '--permission-profile', 'worker_check',
  '-c', 'permissions.worker_check.filesystem={":root"="read","/work/job"="write","/tmp"="write"}',
  '-c', 'permissions.worker_check.network.enabled=false',
  '-C', '/work/job', '--', process.execPath, '/work/job/check.cjs',
], {env:{PATH:process.env.PATH,HOME:'/work/home',TMPDIR:'/tmp'},timeout:20000});
process.stdout.write(await readFile('/work/job/result.json', 'utf8'));
