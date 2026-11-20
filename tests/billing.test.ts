import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCreditsResponse, parseLegacyBilling, decodeRemainingResets, fetchResetCoupons } from '../src/surfaces/billing.js';
import { encodeGrpcWebFrame, decodeVarint } from '../src/surfaces/grpc-web.js';
import { mockExports } from './helpers/mock-exports.js';

const credits = { config: { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-11-20T06:42:00Z', end: '2026-11-27T06:42:00Z' }, creditUsagePercent: 3, productUsage: [{ product: 'GrokBuild', usagePercent: 3 }], prepaidBalance: { val: 0 }, onDemandCap: { val: 0 }, onDemandUsed: { val: 0 }, isUnifiedBillingUser: true } };
const v = (n: number): number[] => { const a: number[] = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; a.push(b); } while (n); return a; };
const field = (n: number, b: number[]) => [...v(n * 8 + 2), ...v(b.length), ...b];
const token = (id: string, end: number) => field(10, [...field(10, [...new TextEncoder().encode(id)]), ...field(30, [...v(8), ...v(end)])]);
const frame = (payload: Uint8Array, trailer = 'grpc-status:0') => { const data = encodeGrpcWebFrame(payload); const t = encodeGrpcWebFrame(new TextEncoder().encode(trailer)); t[0] = 128; return new Uint8Array([...data, ...t]); };

test('credits and legacy response shapes', () => {
 const p = parseCreditsResponse(credits)!; assert.equal(p.usagePercent, 3); assert.equal(p.periodType, 'weekly'); assert.equal(p.periodEnd, '2026-11-27T06:42:00Z'); assert.deepEqual(p.products, [{product:'GrokBuild',usagePercent:3}]); assert.equal(p.prepaidBalanceCents, 0);
 assert.equal(parseCreditsResponse({config:{currentPeriod:{type:'USAGE_PERIOD_TYPE_MONTHLY'}}})?.usagePercent, 0);
 assert.equal(parseCreditsResponse({config:{currentPeriod:{type:'bad'}}}), null);
 assert.equal(parseLegacyBilling({config:{monthlyLimit:{val:0},used:{val:78}}})?.usedCents, 78);
});
test('coupon decoding rejects malformed and unknown messages', () => {
 const decoded = decodeRemainingResets(new Uint8Array([...token('a', 1803859200), ...token('b', 1803859200)]));
 assert.ok(Array.isArray(decoded)); assert.equal(decoded.length, 2); assert.equal(decoded[0].validityEnd, '2027-03-01T00:00:00.000Z'); assert.equal('tokenId' in decoded[0], false);
 assert.deepEqual(decodeRemainingResets(new Uint8Array()), []);
 assert.equal(decodeRemainingResets(new Uint8Array([8,1])), 'unrecognized');
 assert.equal(decodeRemainingResets(new Uint8Array(field(10, field(30,[8,1])))), 'unrecognized');
 assert.throws(() => decodeVarint(new Uint8Array([...Array(10).fill(128),0]),0));
 assert.throws(() => decodeRemainingResets(new Uint8Array([82,4,1])));
});
test('coupon transport verifies framing and status and falls back', async () => {
 let calls=0; const fetcher: typeof fetch = async () => { calls++; return calls===1 ? new Response('',{status:404}) : new Response(frame(new Uint8Array())); };
 const ok = await fetchResetCoupons({bearer:'test',fetch:fetcher}); assert.equal(ok.status,'ok'); assert.equal(calls,2); if(ok.status==='ok') assert.deepEqual(ok.coupons,[]);
 for (const bytes of [frame(new Uint8Array(),'grpc-status:16'), encodeGrpcWebFrame(new Uint8Array())]) assert.equal((await fetchResetCoupons({bearer:'test',fetch:async()=>new Response(bytes)})).status,'error');
 assert.equal((await fetchResetCoupons({bearer:'test',fetch:async()=>new Response(frame(new Uint8Array([8,1])))})).status,'unknown');
 // Live replies always carried one (empty) data frame. A reply with only the
 // trailer is a shape nobody has observed, so it is reported as unknown rather
 // than as a confirmed zero.
 const trailerOnly = encodeGrpcWebFrame(new TextEncoder().encode('grpc-status:0')); trailerOnly[0] = 128;
 const empty = await fetchResetCoupons({bearer:'test',fetch:async()=>new Response(trailerOnly)});
 assert.equal(empty.status,'unknown');
 // Two data frames is not a shape this RPC produces.
 const twice = new Uint8Array([...encodeGrpcWebFrame(new Uint8Array()), ...frame(new Uint8Array())]);
 assert.equal((await fetchResetCoupons({bearer:'test',fetch:async()=>new Response(twice)})).status,'error');
});
test('source contains no coupon redemption RPC', () => { const walk=(p:string):string[]=>readdirSync(p,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(join(p,x.name)):[join(p,x.name)]); for(const f of walk('src')) assert.equal(readFileSync(f,'utf8').includes('Redeem'+'Reset'),false,f); });

test('billing command preserves legacy JSON and handles weekly-only and failures', async () => {
 const { mock } = await import('node:test');
 mock.module(new URL('../src/auth/token-store.ts', import.meta.url), mockExports({getValidBearer:async()=> 'fake', loadTokens:()=>({accountId:'user'})}));
 const {billingCommand}=await import('../src/commands/billing.js');
 let legacyOk=true, weeklyOk=true; const logs:string[]=[];
 const legacy={config:{monthlyLimit:{val:0},used:{val:78},onDemandCap:{val:0},billingPeriodStart:'2026-11-01T00:00:00+00:00',billingPeriodEnd:'2026-12-01T00:00:00+00:00',history:[]}};
 const f=mock.method(globalThis,'fetch',async (input) => { const url=String(input); if(url.includes('GetRemainingResets'))return new Response(frame(new Uint8Array())); if(url.includes('/user'))return Response.json({email:'test@example.com'}); if(url.includes('?format=credits'))return weeklyOk?Response.json(credits):new Response('',{status:500}); return legacyOk?Response.json(legacy):new Response('',{status:500}); });
 const out=mock.method(console,'log',(s:unknown)=>{logs.push(String(s));}); const err=mock.method(console,'error',()=>{}); const exit=mock.method(process,'exit',((code?:number)=>{throw new Error(`exit ${code}`);}) as typeof process.exit);
 try {
  await billingCommand().parseAsync(['node','progrok','--json']); const a=JSON.parse(logs.pop()!); const {plan,weekly,resetCoupons,...old}=a;
  assert.deepEqual(old,{tier:'SuperGrok (0 val)',email:'test@example.com',limit:0,used:78,remaining:-78,percent:0,limitUsd:0,usedUsd:0.78,remainingUsd:-0.78,billingPeriodStart:legacy.config.billingPeriodStart,billingPeriodEnd:legacy.config.billingPeriodEnd,history:[]}); assert.equal(plan,'X Subscription (weekly pool)'); assert.equal(weekly.usagePercent,3); assert.equal(resetCoupons.status,'ok');
  await billingCommand().parseAsync(['node','progrok']); assert.match(logs.join('\n'),/Weekly:.*3%/); assert.doesNotMatch(logs.join('\n'),/Monthly:|\(0 val\)/); logs.length=0;
  legacyOk=false; await billingCommand().parseAsync(['node','progrok','--json']); const b=JSON.parse(logs.pop()!); assert.deepEqual(Object.keys(b),['email','plan','weekly','resetCoupons','legacy']); assert.equal(b.legacy,null);
  weeklyOk=false; await assert.rejects(billingCommand().parseAsync(['node','progrok','--json']),/exit 1/);
 } finally {f.mock.restore();out.mock.restore();err.mock.restore();exit.mock.restore();}
});

test('billing text keeps missing values unknown, converts reset times to UTC and names a failed weekly read', async () => {
 const { mock } = await import('node:test');
 const {billingCommand}=await import('../src/commands/billing.js');
 const legacy={config:{monthlyLimit:{val:0},used:{val:0},history:[]}};
 const partial={config:{currentPeriod:{type:'USAGE_PERIOD_TYPE_WEEKLY',end:'2026-11-27T15:42:58+09:00'},creditUsagePercent:12,prepaidBalance:{val:250}}};
 let weeklyOk=true; const logs:string[]=[];
 const f=mock.method(globalThis,'fetch',async (input) => { const url=String(input); if(url.includes('GetRemainingResets'))return new Response(frame(new Uint8Array())); if(url.includes('/user'))return Response.json({}); if(url.includes('?format=credits'))return weeklyOk?Response.json(partial):new Response('',{status:500}); return Response.json(legacy); });
 const out=mock.method(console,'log',(s:unknown)=>{logs.push(String(s));});
 try {
  await billingCommand().parseAsync(['node','progrok']); const text=logs.join('\n');
  assert.match(text,/Weekly:.*12% used \(resets 2026-11-27 06:42 UTC\)/);
  assert.match(text,/Prepaid:\s+\$2\.50/); assert.doesNotMatch(text,/on-demand cap \$0\.00/); assert.match(text,/on-demand cap unavailable/);
  logs.length=0; weeklyOk=false; await billingCommand().parseAsync(['node','progrok']);
  assert.match(logs.join('\n'),/Weekly:\s+unavailable/);
 } finally { f.mock.restore(); out.mock.restore(); }
});

test('coupon lookup tries the new path first and falls back on 404 or UNIMPLEMENTED only', async () => {
 const seen:string[]=[];
 const reply=(first:Response)=>async (input:string|URL|Request)=>{ seen.push(String(input)); return seen.length===1?first:new Response(frame(new Uint8Array())); };
 for (const first of [new Response('',{status:404}), new Response(frame(new Uint8Array(),'grpc-status:12'))]) {
  seen.length=0; const result=await fetchResetCoupons({bearer:'test',fetch:reply(first) as typeof fetch});
  assert.equal(result.status,'ok'); assert.deepEqual(seen.map((url)=>url.split('/').at(-2)),['grok_api_v2.GrokBuildBilling','prod_mc_billing.ConsumerUiSvc']);
 }
 seen.length=0; const denied=await fetchResetCoupons({bearer:'test',fetch:reply(new Response(frame(new Uint8Array(),'grpc-status:7'))) as typeof fetch});
 assert.equal(denied.status,'error'); assert.equal(seen.length,1);
 const conflicting=new Uint8Array([...frame(new Uint8Array()), ...(()=>{const t=encodeGrpcWebFrame(new TextEncoder().encode('grpc-status:5')); t[0]=128; return t;})()]);
 assert.equal((await fetchResetCoupons({bearer:'test',fetch:async()=>new Response(conflicting)})).status,'error');
});
