import { Command } from "commander";
import { getValidBearer, loadTokens } from "../auth/token-store.js";
import {
  fetchLegacyBilling,
  fetchResetCoupons,
  fetchWeeklyCredits,
  type LegacyBilling,
  type ResetCouponsResult,
  type WeeklyCredits,
} from "../surfaces/billing.js";
import { log } from "../utils/logger.js";

const USER_URL = "https://cli-chat-proxy.grok.com/v1/user";

/** Kept exactly as 3.0.0 computed it: the 3.0.0 JSON "tier" key must not change. */
function tierFromLimit(val: number): string {
  if (val >= 150_000) return "SuperGrok Heavy";
  if (val >= 15_000) return "SuperGrok";
  return `SuperGrok (${val} val)`;
}

/** The corrected plan label, reported under the new "plan" key. */
function planLabel(weekly: WeeklyCredits | null, legacy: LegacyBilling | null): string {
  if (weekly && (!legacy || legacy.limitCents === 0)) return "X Subscription (weekly pool)";
  return legacy ? tierFromLimit(legacy.limitCents) : "unknown";
}

function userIdFromToken(token: string): string {
  try {
    const payload: unknown = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    const sub = (payload as { sub?: unknown } | null)?.sub;
    return typeof sub === "string" ? sub : "";
  } catch {
    return "";
  }
}

async function readEmail(bearer: string): Promise<string | null> {
  try {
    const response = await fetch(USER_URL, {
      headers: { Authorization: `Bearer ${bearer}` },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const user = (await response.json()) as { email?: unknown };
    return typeof user.email === "string" ? user.email : null;
  } catch {
    return null;
  }
}

function settled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function printText(
  email: string | null,
  plan: string,
  weekly: WeeklyCredits | null,
  legacy: LegacyBilling | null,
  coupons: ResetCouponsResult,
): void {
  log.info(`Plan:      ${plan}`);
  if (email) log.info(`Account:   ${email}`);
  if (weekly) {
    const resets = weekly.periodEnd
      ? ` (resets ${weekly.periodEnd.slice(0, 16).replace("T", " ")} UTC)`
      : "";
    const label = weekly.periodType === "weekly" ? "Weekly:   " : "Monthly:  ";
    log.info(`${label} ${weekly.usagePercent}% used${resets}`);
    for (const product of weekly.products) log.info(`  ${product.product} ${product.usagePercent}%`);
    if (weekly.prepaidBalanceCents !== undefined || weekly.onDemandCapCents !== undefined) {
      log.info(`Prepaid:   ${usd(weekly.prepaidBalanceCents ?? 0)} · on-demand cap ${usd(weekly.onDemandCapCents ?? 0)}`);
    }
  }
  // A unified (weekly pool) account reports a 0 monthly limit; that line would only mislead.
  if (legacy && legacy.limitCents > 0) {
    log.info(`Monthly:   ${usd(legacy.usedCents)} / ${usd(legacy.limitCents)}`);
  }
  if (coupons.status === "ok") {
    const count = coupons.coupons.length;
    const expiries = coupons.coupons.flatMap((coupon) => (coupon.validityEnd ? [coupon.validityEnd] : [])).sort();
    const next = expiries.length > 0 ? `; next expires ${expiries[0].slice(0, 10)}` : "";
    log.info(`Resets:    ${count} reset coupon${count === 1 ? "" : "s"} available${next}`);
  } else if (coupons.status === "unknown") {
    log.info("Resets:    unknown (unrecognized response; not shown as zero)");
  } else {
    log.info(`Resets:    unavailable (${coupons.reason})`);
  }
}

export function billingCommand(): Command {
  return new Command("billing")
    .description("Show weekly usage, billing and reset coupons (read-only)")
    .option("--json", "Output raw JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const bearer = await getValidBearer();
        const userId = loadTokens()?.accountId || userIdFromToken(bearer);
        const [weeklyResult, legacyResult, couponResult, emailResult] = await Promise.allSettled([
          fetchWeeklyCredits({ bearer, userId }),
          fetchLegacyBilling({ bearer }),
          fetchResetCoupons({ bearer }),
          readEmail(bearer),
        ]);
        const weekly = settled(weeklyResult);
        const legacy = settled(legacyResult);
        const resetCoupons: ResetCouponsResult =
          settled(couponResult) ?? { status: "error", reason: "Reset request failed" };
        const email = settled(emailResult);

        if (!weekly && !legacy) {
          log.error("Failed to fetch billing data.");
          process.exit(1);
        }
        const plan = planLabel(weekly, legacy);

        if (opts.json) {
          if (!legacy) {
            // New in 3.1.0: 3.0.0 exited 1 here, so this shape has no older consumers.
            console.log(JSON.stringify({ email, plan, weekly, resetCoupons, legacy: null }, null, 2));
            return;
          }
          // Every 3.0.0 key keeps its value and type; plan, weekly and resetCoupons are added.
          const limit = legacy.limitCents;
          const used = legacy.usedCents;
          const remaining = limit - used;
          console.log(JSON.stringify({
            tier: tierFromLimit(limit),
            email,
            limit,
            used,
            remaining,
            percent: limit > 0 ? Math.round((used / limit) * 100) : 0,
            limitUsd: limit / 100,
            usedUsd: used / 100,
            remainingUsd: remaining / 100,
            billingPeriodStart: legacy.periodStart,
            billingPeriodEnd: legacy.periodEnd,
            history: legacy.history ?? [],
            plan,
            weekly,
            resetCoupons,
          }, null, 2));
          return;
        }

        printText(email, plan, weekly, legacy, resetCoupons);
      } catch (err) {
        log.error((err as Error).message);
        process.exit(1);
      }
    });
}
