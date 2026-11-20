import { decodeGrpcWebResponse, decodeVarint, encodeGrpcWebFrame, readLengthDelimited } from './grpc-web.js';
export const GROK_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing';
export const GROK_RESET_ENDPOINTS = ['https://grok.com/grok_api_v2.GrokBuildBilling/GetRemainingResets','https://grok.com/prod_mc_billing.ConsumerUiSvc/GetRemainingResets'] as const;
export interface WeeklyCredits { usagePercent: number; periodType: 'weekly'|'monthly'; periodStart?: string; periodEnd?: string; products: {product:string;usagePercent:number}[]; prepaidBalanceCents?:number; onDemandCapCents?:number; onDemandUsedCents?:number; unifiedBilling?:boolean }
export interface LegacyBilling { limitCents:number; usedCents:number; periodStart?:string; periodEnd?:string; history?:unknown[] }
export interface ResetCoupon { validityStart?:string; validityEnd?:string }
const obj = (v:unknown): Record<string,unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
const num = (v:unknown): number|undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v:unknown): string|undefined => typeof v === 'string' ? v : undefined;
const cents = (v:unknown) => num(obj(v).val);
export function parseCreditsResponse(value:unknown): WeeklyCredits|null {
 const c=obj(obj(value).config), p=obj(c.currentPeriod), type=p.type === 'USAGE_PERIOD_TYPE_WEEKLY' ? 'weekly' : p.type === 'USAGE_PERIOD_TYPE_MONTHLY' ? 'monthly' : null;
 if (!type || (c.creditUsagePercent !== undefined && num(c.creditUsagePercent) === undefined)) return null;
 const products = Array.isArray(c.productUsage) ? c.productUsage.flatMap(x => { const y=obj(x), product=str(y.product), usagePercent=y.usagePercent === undefined ? 0 : num(y.usagePercent); return product !== undefined && usagePercent !== undefined ? [{product,usagePercent}] : []; }) : [];
 return { usagePercent:num(c.creditUsagePercent) ?? 0, periodType:type, periodStart:str(p.start), periodEnd:str(p.end), products, prepaidBalanceCents:cents(c.prepaidBalance), onDemandCapCents:cents(c.onDemandCap), onDemandUsedCents:cents(c.onDemandUsed), unifiedBilling:typeof c.isUnifiedBillingUser === 'boolean' ? c.isUnifiedBillingUser : undefined };
}
export function parseLegacyBilling(value:unknown): LegacyBilling|null {
 const c=obj(obj(value).config), limitCents=cents(c.monthlyLimit), usedCents=cents(c.used); if(limitCents === undefined || usedCents === undefined) return null;
 return {limitCents,usedCents,periodStart:str(c.billingPeriodStart),periodEnd:str(c.billingPeriodEnd),history:Array.isArray(c.history)?c.history:[]};
}
function fields(bytes:Uint8Array, cb:(n:number,wire:number,v:number|Uint8Array)=>void):void {
 let offset=0; while(offset<bytes.length) { const tag=decodeVarint(bytes,offset); offset+=tag.bytesRead; const n=Math.floor(tag.value/8), wire=tag.value%8; if(!n) throw new Error('Invalid protobuf field');
 if(wire===0) { const v=decodeVarint(bytes,offset); offset+=v.bytesRead; cb(n,wire,v.value); }
 else if(wire===2) { const {start,end}=readLengthDelimited(bytes,offset); offset=end; cb(n,wire,bytes.subarray(start,end)); }
 else if(wire===1 || wire===5) { const len=wire===1?8:4; if(len>bytes.length-offset) throw new Error('Truncated protobuf field'); offset+=len; }
 else throw new Error('Unsupported protobuf wire type'); }
}
function timestamp(bytes:Uint8Array):string|undefined { let seconds=0; fields(bytes,(n,w,v)=>{if(n===1 && w===0) seconds=v as number;}); if(!seconds) return undefined; const d=new Date(seconds*1000); if(!Number.isFinite(d.getTime())) throw new Error('Invalid timestamp'); return d.toISOString(); }
export function decodeRemainingResets(payload:Uint8Array):ResetCoupon[]|'unrecognized' {
 const result:ResetCoupon[]=[]; let bad=false;
 fields(payload,(n,w,v)=>{if(n!==10 || w!==2) return; let id='', validityStart:string|undefined, validityEnd:string|undefined;
 fields(v as Uint8Array,(i,wire,x)=>{if(wire!==2)return; if(i===10) id=new TextDecoder().decode(x as Uint8Array); if(i===20) validityStart=timestamp(x as Uint8Array); if(i===30) validityEnd=timestamp(x as Uint8Array);});
 if(!id) bad=true; else result.push({...(validityStart?{validityStart}:{}),...(validityEnd?{validityEnd}:{})}); });
 return bad || (payload.length>0 && result.length===0) ? 'unrecognized' : result;
}
type Deps = {bearer:string; userId:string; fetch?:typeof fetch};
export async function fetchWeeklyCredits(deps:Deps):Promise<WeeklyCredits|null> { if(!deps.userId) return null; const r=await (deps.fetch??fetch)(GROK_BILLING_URL+'?format=credits',{headers:{Accept:'application/json',Authorization:`Bearer ${deps.bearer}`,'x-xai-token-auth':'xai-grok-cli','x-authenticateresponse':'authenticate-response','x-userid':deps.userId,'x-grok-client-version':'1.0.46'},redirect:'error',signal:AbortSignal.timeout(8000)}); return r.ok?parseCreditsResponse(await r.json()):null; }
export async function fetchLegacyBilling(deps:{bearer:string;fetch?:typeof fetch}):Promise<LegacyBilling|null> { const r=await (deps.fetch??fetch)(GROK_BILLING_URL,{headers:{Accept:'application/json',Authorization:`Bearer ${deps.bearer}`},redirect:'error',signal:AbortSignal.timeout(8000)}); return r.ok?parseLegacyBilling(await r.json()):null; }
export async function fetchResetCoupons(deps:{bearer:string;fetch?:typeof fetch}):Promise<{status:'ok';coupons:ResetCoupon[];endpoint:string}|{status:'unknown';endpoint:string;reason:'unrecognized_payload'}|{status:'error';reason:string}> {
 try { for(const endpoint of GROK_RESET_ENDPOINTS) { const r=await (deps.fetch??fetch)(endpoint,{method:'POST',headers:{Authorization:`Bearer ${deps.bearer}`,'content-type':'application/grpc-web+proto','x-grpc-web':'1','x-xai-token-auth':'xai-grok-cli'},body:encodeGrpcWebFrame(new Uint8Array()),redirect:'error',signal:AbortSignal.timeout(8000)});
 if(r.status===404) continue; if(!r.ok) return {status:'error',reason:`HTTP ${r.status}`};
 const d=decodeGrpcWebResponse(new Uint8Array(await r.arrayBuffer())), first=d.statusValues[0];
 if(!d.framingComplete || first===undefined || d.statusValues.some(s=>!/^\d+$/.test(s)||!Number.isSafeInteger(Number(s))||s!==first)) return {status:'error',reason:'Unconfirmed gRPC status'};
 if(Number(first)===12) continue; if(Number(first)!==0) return {status:'error',reason:`gRPC status ${first}`};
 if(d.messages.length!==1) return {status:'error',reason:'Unexpected gRPC message count'};
 const coupons=decodeRemainingResets(d.messages[0]); if(coupons==='unrecognized') return {status:'unknown',endpoint,reason:'unrecognized_payload'}; return {status:'ok',coupons,endpoint}; }
 return {status:'error',reason:'No supported reset endpoint'}; } catch(e) {return {status:'error',reason:e instanceof Error?e.message:'Reset request failed'};}
}
