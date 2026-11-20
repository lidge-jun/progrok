import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoGenerationRequest as build, parseKeyframe } from '../src/commands/video-request.js';
import { videoRulesFor, normalizeVideoProgress } from '../src/utils/video-rules.js';
const base = {model:'grok-imagine-video-1.5', prompt:'hello', duration: 5, durationField:'duration' as const, aspect:'16:9', resolution:'480p', refs:[] as string[], voices:[] as string[], keyframes:[] as {input:string; timestampS:number}[]};
const ref = (v:string) => ({file_id:v});
const make = (v:Partial<typeof base> & {image?:string;lastFrame?:string}) => build({...base,...v},ref);
test('video model limits, frames, voices, and progress', () => {
 assert.equal(make({}).image, undefined);
 assert.equal((make({refs:Array(14).fill('x')}).reference_images as unknown[]).length,14);
 assert.throws(()=>make({refs:Array(15).fill('x')}),/14/);
 assert.throws(()=>make({model:'grok-imagine-video',refs:Array(8).fill('x')}),/7/);
 assert.throws(()=>make({model:'grok-imagine-video-1.5-lite',refs:['x']}),/--ref/);
 assert.deepEqual(make({voices:['eve','leo']}).reference_audios,[{voice_id:'eve'},{voice_id:'leo'}]);
 for(const model of ['grok-imagine-video','grok-imagine-video-1.5-lite']) assert.throws(()=>make({model,voices:['eve']}),/--voice/);
 assert.throws(()=>make({voices:Array(4).fill('eve')}),/3/);
 assert.deepEqual(parseKeyframe('a@b.png@2.5'),{input:'a@b.png',timestampS:2.5});
 for(const model of ['grok-imagine-video','grok-imagine-video-1.5-lite']) assert.throws(()=>make({model,lastFrame:'x'}),/--last-frame/);
 for(const t of [0,5]) assert.throws(()=>make({keyframes:[{input:'x',timestampS:t}]}),/keyframe/);
 // xAI snaps keyframes to a 1/3 s grid and rejects two that land in the same slot.
 assert.throws(()=>make({keyframes:[{input:'x',timestampS:1},{input:'y',timestampS:1.1}]}),/1\/3/);
 assert.equal((make({keyframes:[{input:'x',timestampS:1},{input:'y',timestampS:1.2}]}).keyframes as unknown[]).length,2);
 assert.throws(()=>make({keyframes:Array(5).fill({input:'x',timestampS:1})}),/4/);
 for(const extra of [{refs:['x']},{lastFrame:'x'},{keyframes:[{input:'x',timestampS:1}]}]) assert.throws(()=>make({...extra,resolution:'1080p'}),/720p/);
 for(const model of ['grok-imagine-video-1.5','grok-imagine-video-1.5-lite']) { assert.equal(make({model,resolution:'1080p'}).resolution,'1080p'); assert.equal(make({model,resolution:'1080p',image:'x'}).resolution,'1080p'); }
 assert.throws(()=>make({model:'grok-imagine-video',resolution:'1080p'}));
 assert.equal(make({duration:15,refs:['x']}).duration,15);
 assert.throws(()=>make({model:'grok-imagine-video',duration:11,refs:['x']}),/10/);
 assert.ok(make({image:'x',refs:['y']}).image);
 assert.throws(()=>make({model:'grok-imagine-video',image:'x',refs:['y']}),/--image/);
 assert.ok(make({prompt:'',image:'x'})); assert.ok(make({prompt:'',lastFrame:'x'})); assert.throws(()=>make({prompt:''}),/prompt/);
 assert.equal(videoRulesFor('grok-imagine-video-1.5-preview'),videoRulesFor(base.model)); assert.equal(videoRulesFor('unknown'),undefined);
 assert.ok(make({model:'unknown',refs:Array(20).fill('x'),resolution:'1080p'}));
 assert.deepEqual([0,1,50,100,140,-3].map(normalizeVideoProgress),[0,1,50,100,100,0]);
});
