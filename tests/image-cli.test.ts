import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let request: Record<string, unknown> | undefined;
mock.module(new URL('../src/surfaces/index.ts', import.meta.url), { exports: { ImagesClient: class {
 async create(body: Record<string, unknown>) { request = body; return {data:[{b64_json:Buffer.from([0xff,0xd8,0xff]).toString('base64'),mime_type:'image/jpeg'}]}; }
}}});
const {imageCommand} = await import('../src/commands/image.js');
test('image action sends quality and writes jpg', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'progrok-image-')); const prior = process.cwd();
 try { process.chdir(dir); await imageCommand().parseAsync(['node','progrok','hello','--quality','medium']);
 assert.equal(request?.quality,'medium'); assert.deepEqual(readFileSync('progrok-image.jpg'),Buffer.from([0xff,0xd8,0xff]));
 } finally { process.chdir(prior); rmSync(dir,{recursive:true,force:true}); }
});
