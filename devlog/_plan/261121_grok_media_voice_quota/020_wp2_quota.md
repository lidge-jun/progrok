# 020 — wp2 quota visibility in `progrok billing`

Modeled on OpenCodex origin/dev (read with `git show`):
src/providers/quota/vendor-probes-oauth.ts (`parseXaiCreditsResponse`, `fetchXaiWeeklyCredits`),
src/grok/reset-coupons.ts and src/grok/grpc-web.ts (decoder hardening: varint ≤10 bytes,
bounds-checked lengths, confirmed grpc-status). Redemption is deliberately not ported.

## 1. NEW `src/surfaces/grpc-web.ts`

`encodeGrpcWebFrame(message: Uint8Array)`, `decodeGrpcWebResponse(bytes)` → {messages, statusValues, statusMessage, framingComplete},
`decodeVarint` with the 10-byte and safe-integer limits, `readLengthDelimited`.

## 2. NEW `src/surfaces/billing.ts`

```ts
export const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing";
export const GROK_RESET_ENDPOINTS = [
  "https://grok.com/grok_api_v2.GrokBuildBilling/GetRemainingResets",
  "https://grok.com/prod_mc_billing.ConsumerUiSvc/GetRemainingResets",
] as const;
export interface WeeklyCredits { usagePercent: number; periodType: "weekly" | "monthly";
  periodStart?: string; periodEnd?: string; products: { product: string; usagePercent: number }[];
  prepaidBalanceCents?: number; onDemandCapCents?: number; onDemandUsedCents?: number; unifiedBilling?: boolean }
export function parseCreditsResponse(value: unknown): WeeklyCredits | null; // null unless config.currentPeriod.type is USAGE_PERIOD_TYPE_WEEKLY|MONTHLY; missing percent = 0 (proto3)
export interface LegacyBilling { limitCents: number; usedCents: number; periodStart?: string; periodEnd?: string }
export function parseLegacyBilling(value: unknown): LegacyBilling | null;
export interface ResetCoupon { validityStart?: string; validityEnd?: string } // token id deliberately dropped
export function decodeRemainingResets(payload: Uint8Array): ResetCoupon[] | "unrecognized";
// field 10 repeated {10 id, 20 start ts, 30 end ts}. An EMPTY payload is a confirmed zero.
// A NON-EMPTY payload that yields no field-10 token, or a field-10 entry without a token id,
// returns "unrecognized": reported as status "unknown", never as 0 coupons.
export async function fetchWeeklyCredits(deps: {bearer: string; userId: string; fetch?: typeof fetch}): Promise<WeeklyCredits | null>;
export async function fetchLegacyBilling(deps): Promise<LegacyBilling | null>;
export async function fetchResetCoupons(deps): Promise<
  | { status: "ok"; coupons: ResetCoupon[]; endpoint: string }
  | { status: "unknown"; endpoint: string; reason: "unrecognized_payload" }
  | { status: "error"; reason: string }>;
```

Headers for credits: `Accept: application/json`, `Authorization`, `x-xai-token-auth: xai-grok-cli`,
`x-authenticateresponse: authenticate-response`, `x-userid: <JWT sub>`, `x-grok-client-version`.
Coupons: POST 5-byte empty frame, `content-type: application/grpc-web+proto`, `x-grpc-web: 1`,
`x-xai-token-auth: xai-grok-cli`; on HTTP 404 or grpc-status 12 try the next endpoint;
missing/inconsistent status → error, never "0 coupons". `redirect: "error"` and an 8 s timeout on every call.
The user id comes from the stored token's `accountId` or the access-token JWT `sub`.

## 3. MODIFY `src/commands/billing.ts`

Fetch weekly credits, legacy billing and coupons in parallel (allSettled). Text output:

```
Account:   <email>
Weekly:    3% used (resets 2026-11-27 06:42 UTC)
  GrokBuild 3%
Prepaid:   $0.00 · on-demand cap $0.00
Monthly:   (only when the legacy monthlyLimit > 0) $x / $y
Resets:    0 coupons available   |  2 coupons; next expires 2027-03-01
```

`--json` is additive over the 3.0.0 shape.

- Case A, legacy endpoint succeeds (the only case 3.0.0 could print): every 3.0.0 key keeps its exact
  value and type, computed by the unchanged code path, `tierFromLimit` included (a 0 limit still yields
  "SuperGrok (0 val)" in `tier`). New keys only: `plan` (string: the corrected label, "X Subscription
  (weekly pool)" when weekly credits exist and the legacy limit is 0, else the `tierFromLimit` label),
  `weekly: WeeklyCredits | null` and `resetCoupons`.
- Case B, legacy fails and weekly succeeds: new in 3.1.0 (3.0.0 exited 1 here, so no consumer has seen it).
  Output is `{ email, plan, weekly, resetCoupons, legacy: null }` without the 3.0.0 keys, and the CHANGELOG
  documents it. Exit 0.
- Case C, both fail: exit 1 as before.

Text output uses `plan`, never prints "(0 val)", and omits the monthly line when the legacy limit is 0.
`command-manifest.ts`: summary "Read weekly usage, billing and reset coupons." (mutatesRemote false).

## 4. Tests first (`tests/billing.test.ts`, NEW)

- parseCreditsResponse on the live-shaped fixture → 3%, weekly, end 2026-11-27, products GrokBuild 3, prepaid 0.
- percent omitted → 0; wrong period type → null.
- decodeRemainingResets: two tokens built with a test encoder → validity dates, no token id field; overlong varint and
  truncated length throw; empty payload → []; a non-empty payload with only unknown fields → "unrecognized"; a field-10
  entry without an inner token id → "unrecognized"; fetchResetCoupons maps "unrecognized" to status "unknown".
- Case A: against a legacy fixture, every 3.0.0 key has the same value and type as the 3.0.0 code computes (assert deep-equal on the 3.0.0 subset, including tier "SuperGrok (0 val)" for limit 0); new keys plan/weekly/resetCoupons present. Case B: legacy 500 + weekly ok → exit 0 and the documented shape. Case C: both fail → exit 1.
- fetchResetCoupons: first endpoint 404 → second used; grpc-status 16 → error; missing trailer → error; empty data → ok, 0.
- billing action with mocked fetch: legacy limit 0 → no monthly line and no "(0 val)"; weekly line printed.
- source scan: no "RedeemReset" string anywhere under src/.

