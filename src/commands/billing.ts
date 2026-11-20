import { Command } from 'commander';
import { getValidBearer, loadTokens } from '../auth/token-store.js';
import { fetchWeeklyCredits, fetchLegacyBilling, fetchResetCoupons } from '../surfaces/billing.js';
import { log } from '../utils/logger.js';
const USER_URL = 'https://cli-chat-proxy.grok.com/v1/user';
function tierFromLimit(val:number):string { if(val>=150_000)return 'SuperGrok Heavy'; if(val>=15_000)return 'SuperGrok'; return `SuperGrok (${val} val)`; }
function userIdFromToken(token:string):string { try { const v:unknown=JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); return v && typeof v==='object' && 'sub' in v && typeof v.sub==='string' ? v.sub : ''; } catch { return ''; } }
export function billingCommand():Command {
 return new Command('billing').description('Show subscription billing and usage').option('--json','Output raw JSON').action(async (opts:{json?:boolean})=>{
  try {
   const bearer=await getValidBearer(), userId=loadTokens()?.accountId || userIdFromToken(bearer);
   const [wr,lr,cr,ur]=await Promise.allSettled([fetchWeeklyCredits({bearer,userId}),fetchLegacyBilling({bearer}),fetchResetCoupons({bearer}),fetch(USER_URL,{headers:{Authorization:`Bearer ${bearer}`},redirect:'error',signal:AbortSignal.timeout(8000)})]);
   const weekly=wr.status==='fulfilled'?wr.value:null, legacy=lr.status==='fulfilled'?lr.value:null;
   const resetCoupons=cr.status==='fulfilled'?cr.value:{status:'error' as const,reason:'Reset request failed'};
   let email:string|null=null;
   if(ur.status==='fulfilled' && ur.value.ok) { try { const u=await ur.value.json() as {email?:string}; email=u.email??null; } catch {} }
   if(!legacy && !weekly) { log.error('Failed to fetch billing data.'); process.exit(1); }
   const plan=weekly && (!legacy || legacy.limitCents===0) ? 'X Subscription (weekly pool)' : tierFromLimit(legacy!.limitCents);
   if(opts.json) {
    if(!legacy) console.log(JSON.stringify({email,plan,weekly,resetCoupons,legacy:null},null,2));
    else { const limit=legacy.limitCents, used=legacy.usedCents, remaining=limit-used, percent=limit>0?Math.round(used/limit*100):0;
      console.log(JSON.stringify({tier:tierFromLimit(limit),email,limit,used,remaining,percent,limitUsd:limit/100,usedUsd:used/100,remainingUsd:remaining/100,billingPeriodStart:legacy.periodStart,billingPeriodEnd:legacy.periodEnd,history:legacy.history??[],plan,weekly,resetCoupons},null,2)); }
    return;
   }
   log.info(`Plan:      ${legacy?.limitCents === 0 && !weekly ? 'X Subscription' : plan}`); if(email) log.info(`Account:   ${email}`);
   if(weekly) { const reset=weekly.periodEnd ? ` (resets ${weekly.periodEnd.slice(0,16).replace('T',' ')} UTC)` : ''; log.info(`${weekly.periodType==='weekly'?'Weekly':'Monthly'}:    ${weekly.usagePercent}% used${reset}`); for(const p of weekly.products) log.info(`  ${p.product} ${p.usagePercent}%`); if(weekly.prepaidBalanceCents!==undefined || weekly.onDemandCapCents!==undefined) log.info(`Prepaid:   $${((weekly.prepaidBalanceCents??0)/100).toFixed(2)} · on-demand cap $${((weekly.onDemandCapCents??0)/100).toFixed(2)}`); }
   if(legacy && legacy.limitCents>0) log.info(`Monthly:   $${(legacy.usedCents/100).toFixed(2)} / $${(legacy.limitCents/100).toFixed(2)}`);
   if(resetCoupons.status==='ok') { const dates=resetCoupons.coupons.flatMap(c=>c.validityEnd?[c.validityEnd]:[]).sort(); const count=resetCoupons.coupons.length; log.info(`Resets:    ${count} coupon${count===1?'':'s'}${dates.length?`; next expires ${dates[0].slice(0,10)}`:' available'}`); } else log.info(`Resets:    ${resetCoupons.status}`);
  } catch(err) { log.error((err as Error).message); process.exit(1); }
 });
}
