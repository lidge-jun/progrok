import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockExports } from './helpers/mock-exports.js';
let request: Record<string, unknown> | undefined;
let items: unknown[] = [{b64_json:Buffer.from([0xff,0xd8,0xff]).toString('base64'),mime_type:'image/jpeg'}];
mock.module(new URL('../src/surfaces/index.ts', import.meta.url), mockExports({ ImagesClient: class {
 async create(body: Record<string, unknown>) { request = body; return {data:items}; }
}}));
const {imageCommand} = await import('../src/commands/image.js');
test('image action sends quality and writes jpg', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'progrok-image-')); const prior = process.cwd();
 try { process.chdir(dir); await imageCommand().parseAsync(['node','progrok','hello','--quality','medium']);
 assert.equal(request?.quality,'medium'); assert.deepEqual(readFileSync('progrok-image.jpg'),Buffer.from([0xff,0xd8,0xff]));
 } finally { process.chdir(prior); rmSync(dir,{recursive:true,force:true}); }
});
test('image --output keeps one file per image when n > 1', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'progrok-image-')); const prior = process.cwd();
 const one = Buffer.from([0xff,0xd8,0x01]); const two = Buffer.from([0xff,0xd8,0x02]);
 items = [one, two].map((bytes) => ({b64_json:bytes.toString('base64'),mime_type:'image/jpeg'}));
 try { process.chdir(dir); await imageCommand().parseAsync(['node','progrok','hello','--n','2','--output','out.jpg']);
 assert.deepEqual(readFileSync('out-1.jpg'),one); assert.deepEqual(readFileSync('out-2.jpg'),two);
 } finally { process.chdir(prior); rmSync(dir,{recursive:true,force:true}); }
});
