import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
const calls: Record<string, unknown>[] = [];
mock.module(new URL('../src/surfaces/index.ts', import.meta.url), { exports: { VideosClient: class {
 async start(_kind: string, body: Record<string,unknown>) { calls.push(body); return {requestId:'test'}; }
 async poll() { return {status:'done',progress:100,raw:{}}; }
}}});
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
