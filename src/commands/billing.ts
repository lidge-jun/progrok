import { Command } from "commander";
import { getValidBearer } from "../auth/token-store.js";
import { log } from "../utils/logger.js";

const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing";
const USER_URL = "https://cli-chat-proxy.grok.com/v1/user";

interface BillingConfig {
  monthlyLimit: { val: number };
  used: { val: number };
  onDemandCap: { val: number };
  billingPeriodStart: string;
  billingPeriodEnd: string;
  history: Array<{
    billingCycle: { year: number; month: number };
    includedUsed: { val: number };
    onDemandUsed: { val: number };
    totalUsed: { val: number };
  }>;
}

function tierFromLimit(val: number): string {
  if (val >= 150_000) return "SuperGrok Heavy";
  if (val >= 15_000) return "SuperGrok";
  return `SuperGrok (${val} val)`;
}

export function billingCommand(): Command {
  return new Command("billing")
    .description("Show subscription billing and usage")
    .option("--json", "Output raw JSON")
    .action(async (opts: { json?: boolean }) => {
      const token = await getValidBearer();
      const headers = { Authorization: `Bearer ${token}` };

      const [billingRes, userRes] = await Promise.allSettled([
        fetch(BILLING_URL, {
          headers,
          signal: AbortSignal.timeout(8000),
        }),
        fetch(USER_URL, {
          headers,
          signal: AbortSignal.timeout(5000),
        }),
      ]);

      if (billingRes.status !== "fulfilled" || !billingRes.value.ok) {
        log.error("Failed to fetch billing data.");
        process.exit(1);
      }

      const billing = (
        (await billingRes.value.json()) as { config: BillingConfig }
      ).config;
      const limit = billing.monthlyLimit.val;
      const used = billing.used.val;
      const remaining = limit - used;
      const percent = limit > 0 ? Math.round((used / limit) * 100) : 0;
      const tier = tierFromLimit(limit);

      let email: string | null = null;
      if (userRes.status === "fulfilled" && userRes.value.ok) {
        const user = (await userRes.value.json()) as { email?: string };
        email = user.email ?? null;
      }

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              tier,
              email,
              limit,
              used,
              remaining,
              percent,
              limitUsd: limit / 100,
              usedUsd: used / 100,
              remainingUsd: remaining / 100,
              billingPeriodStart: billing.billingPeriodStart,
              billingPeriodEnd: billing.billingPeriodEnd,
              history: billing.history,
            },
            null,
            2,
          ),
        );
        return;
      }

      log.info(`Plan:      ${tier}`);
      if (email) log.info(`Account:   ${email}`);
      log.info(
        `Period:    ${billing.billingPeriodStart.slice(0, 10)} → ${billing.billingPeriodEnd.slice(0, 10)}`,
      );
      log.info(`Limit:     $${(limit / 100).toFixed(2)}`);
      log.info(`Used:      $${(used / 100).toFixed(2)} (${percent}%)`);
      log.info(`Remaining: $${(remaining / 100).toFixed(2)}`);
    });
}
