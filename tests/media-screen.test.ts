import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MediaController, type MediaElements } from '../src/web/client/media.js';
class Element extends EventTarget {
 value = ''; textContent = ''; hidden = false; disabled = false; options: Element[] = []; children: Element[] = []; fields: Record<string, Element> = {};
 constructor(value = '') { super(); this.value = value; }
 replaceChildren(...children: Element[]) { this.children = children; this.options = children; this.value = children[0]?.value ?? ''; }
 querySelector(selector: string) { return this.fields[selector] ?? null; }
 querySelectorAll() { return []; }
 removeAttribute(_name: string) {} append(...children: Element[]) { this.children.push(...children); }
 setAttribute() {}
}
test('media form follows model capabilities and shows one percent', async () => {
 const kind = new Element('video'), model = new Element(), form = new Element(), resolution = new Element('480p'), hd = new Element('1080p'), status = new Element(), progress = new Element(), submit = new Element();
 resolution.fields['option[value="1080p"]'] = hd; form.fields['#video-resolution'] = resolution;
 form.fields['#video-duration'] = new Element('5'); form.fields['#video-aspect'] = new Element('16:9');
 const elements = {kind,model,form,status,progress,submit,prompt:new Element('hello'),results:new Element()} as unknown as MediaElements;
 const originalOption = globalThis.Option;
 Object.defineProperty(globalThis, 'Option', { value: function(_label: string, value: string) { return new Element(value); }, configurable: true });
 let sent: Record<string, unknown>[] = [];
 const fetcher = mock.method(globalThis,'fetch',async (_url, init) => { if (init?.method === 'POST') {sent.push(JSON.parse(String(init.body))); return Response.json({request_id:'r'}); } return Response.json({status:'pending',progress:1}); });
 const originalWindow = globalThis.window;
 Object.defineProperty(globalThis,'window',{value:{setTimeout,clearTimeout}, configurable:true});
 try {
  const c = new MediaController(elements,[{id:'grok-imagine-video'},{id:'grok-imagine-video-1.5'}] as never); c.init();
  assert.equal(hd.disabled,true);
  model.value='grok-imagine-video-1.5'; model.dispatchEvent(new Event('change')); assert.equal(hd.disabled,false);
  resolution.value='1080p'; form.dispatchEvent(new Event('submit',{cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve)); assert.equal(sent[0].resolution,'1080p'); assert.match(status.textContent,/1%/);
  model.value='grok-imagine-video'; model.dispatchEvent(new Event('change')); assert.equal(hd.disabled,true); assert.equal(resolution.value,'720p');
  form.dispatchEvent(new Event('submit',{cancelable:true})); await new Promise(resolve=>setImmediate(resolve)); assert.equal(sent[1].resolution,'720p');
  // A model this build has no rules for is left to the server, as the CLI does.
  model.value='grok-imagine-video-2'; model.dispatchEvent(new Event('change')); assert.equal(hd.disabled,false);
  // Abort outstanding polls so the test does not leave timers running.
  kind.dispatchEvent(new Event('change'));
 } finally { fetcher.mock.restore(); Object.defineProperty(globalThis,'Option',{value:originalOption,configurable:true}); Object.defineProperty(globalThis,'window',{value:originalWindow,configurable:true}); }
});
