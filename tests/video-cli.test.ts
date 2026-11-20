import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockExports } from './helpers/mock-exports.js';
const calls: Record<string, unknown>[] = [];
let pending = false;
mock.module(new URL('../src/surfaces/index.ts', import.meta.url), mockExports({ VideosClient: class {
 async start(_kind: string, body: Record<string,unknown>) { calls.push(body); return {requestId:'test'}; }
 async poll() { if (pending) { pending = false; return {status:'pending',progress:1,raw:{}}; } return {status:'done',progress:100,raw:{},video:{url:'https://example.invalid/video',duration:5}}; }
}}));
const {videoCommand} = await import('../src/commands/video.js');
test('video generation action sends 1.5 text, references and pinned frames', async () => {
 for (const args of [ ['prompt'], ['prompt',...Array(8).fill(['--ref','file_id:x']).flat()], ['--keyframe','file_id:x@2','--last-frame','file_id:y'] ]) {
  await videoCommand().parseAsync(['node','progrok',...args,'--model','grok-imagine-video-1.5','--json']);
 }
 assert.equal(calls.length,3); assert.equal(calls[0].image,undefined);
 assert.equal((calls[1].reference_images as unknown[]).length,8);
 assert.deepEqual(calls[2].keyframes,[{image:{file_id:'x'},timestamp_s:2}]);
 assert.deepEqual(calls[2].last_frame,{file_id:'y'});
});

test('pending progress 1 renders as 1 percent', async () => {
 pending = true; const writes: string[] = [];
 const timer = mock.method(globalThis, 'setTimeout', ((callback: () => void) => { queueMicrotask(callback); return 0; }) as typeof setTimeout);
 const output = mock.method(process.stdout, 'write', ((value: string | Uint8Array) => { writes.push(String(value)); return true; }) as typeof process.stdout.write);
 const fetcher = mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1])));
 const {mkdtempSync,rmSync} = await import('node:fs'); const {tmpdir} = await import('node:os'); const {join} = await import('node:path'); const dir=mkdtempSync(join(tmpdir(),'video-cli-'));
 try {
  // Done result includes a video for the normal non-JSON output path.
  await videoCommand().parseAsync(['node','progrok','hello','--output',join(dir,'out.mp4')]);
  assert.match(writes.join(''), /1%/); assert.doesNotMatch(writes.join(''), /10000%|100%/);
 } finally { timer.mock.restore(); output.mock.restore(); fetcher.mock.restore(); rmSync(dir,{recursive:true,force:true}); }
});
