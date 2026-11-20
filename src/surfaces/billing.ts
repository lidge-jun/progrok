import {
  decodeGrpcWebResponse,
  decodeVarint,
  encodeGrpcWebFrame,
  readLengthDelimited,
} from "./grpc-web.js";

// Grok subscription quota, read with the stored xAI OAuth session.
//
// Weekly usage comes from the JSON billing endpoint the Grok CLI uses
// (?format=credits); the legacy monthly pool is read for compatibility with
// the 3.0.0 billing output. Reset coupons are listed over gRPC-web. This module
// only reads: redeeming a coupon is irreversible and deliberately not offered.
// Response shapes were confirmed live on 2026-11-21; see
// devlog/_plan/261121_grok_media_voice_quota/001_live_evidence.md.

export const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing";
/** New location first; the older ConsumerUiSvc path is the fallback. */
export const GROK_RESET_ENDPOINTS = [
  "https://grok.com/grok_api_v2.GrokBuildBilling/GetRemainingResets",
  "https://grok.com/prod_mc_billing.ConsumerUiSvc/GetRemainingResets",
] as const;
const GROK_CLIENT_VERSION = "1.0.46";
const REQUEST_TIMEOUT_MS = 8_000;
const GRPC_UNIMPLEMENTED = 12;

export interface WeeklyCredits {
  usagePercent: number;
  periodType: "weekly" | "monthly";
  periodStart?: string;
  periodEnd?: string;
  products: { product: string; usagePercent: number }[];
  prepaidBalanceCents?: number;
  onDemandCapCents?: number;
  onDemandUsedCents?: number;
  unifiedBilling?: boolean;
}

export interface LegacyBilling {
  limitCents: number;
  usedCents: number;
  periodStart?: string;
  periodEnd?: string;
  history?: unknown[];
}

/** The coupon token id is dropped on purpose: nothing here can spend it. */
export interface ResetCoupon {
  validityStart?: string;
  validityEnd?: string;
}

export type ResetCouponsResult =
  | { status: "ok"; coupons: ResetCoupon[]; endpoint: string }
  | { status: "unknown"; endpoint: string; reason: "unrecognized_payload" }
  | { status: "error"; reason: string };

type FetchFn = typeof globalThis.fetch;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Billing amounts arrive as {val: <cents>}. */
function cents(value: unknown): number | undefined {
  return finite(record(value).val);
}

/**
 * Parse the ?format=credits envelope. Returns null unless the current period is
 * a weekly or monthly usage period. A missing percent is the proto3 default, 0.
 */
export function parseCreditsResponse(value: unknown): WeeklyCredits | null {
  const config = record(record(value).config);
  const period = record(config.currentPeriod);
  const periodType =
    period.type === "USAGE_PERIOD_TYPE_WEEKLY" ? "weekly"
    : period.type === "USAGE_PERIOD_TYPE_MONTHLY" ? "monthly"
    : null;
  if (!periodType) return null;
  if (config.creditUsagePercent !== undefined && finite(config.creditUsagePercent) === undefined) {
    return null;
  }
  const products = Array.isArray(config.productUsage)
    ? config.productUsage.flatMap((entry) => {
        const item = record(entry);
        const product = text(item.product);
        const usagePercent = item.usagePercent === undefined ? 0 : finite(item.usagePercent);
        return product !== undefined && usagePercent !== undefined ? [{ product, usagePercent }] : [];
      })
    : [];
  return {
    usagePercent: finite(config.creditUsagePercent) ?? 0,
    periodType,
    periodStart: text(period.start),
    periodEnd: text(period.end),
    products,
    prepaidBalanceCents: cents(config.prepaidBalance),
    onDemandCapCents: cents(config.onDemandCap),
    onDemandUsedCents: cents(config.onDemandUsed),
    unifiedBilling: typeof config.isUnifiedBillingUser === "boolean" ? config.isUnifiedBillingUser : undefined,
  };
}

/** Parse the legacy monthly billing envelope that 3.0.0 reported. */
export function parseLegacyBilling(value: unknown): LegacyBilling | null {
  const config = record(record(value).config);
  const limitCents = cents(config.monthlyLimit);
  const usedCents = cents(config.used);
  if (limitCents === undefined || usedCents === undefined) return null;
  return {
    limitCents,
    usedCents,
    periodStart: text(config.billingPeriodStart),
    periodEnd: text(config.billingPeriodEnd),
    history: Array.isArray(config.history) ? config.history : [],
  };
}

type FieldVisitor = (field: number, wireType: number, value: number | Uint8Array) => void;

/** Walk one protobuf message, skipping fixed-width fields and refusing unknown wire types. */
function eachField(bytes: Uint8Array, visit: FieldVisitor): void {
  let offset = 0;
  while (offset < bytes.length) {
    const tag = decodeVarint(bytes, offset);
    offset += tag.bytesRead;
    const field = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    if (field === 0) throw new Error("Invalid protobuf field number");
    if (wireType === 0) {
      const value = decodeVarint(bytes, offset);
      offset += value.bytesRead;
      visit(field, wireType, value.value);
    } else if (wireType === 2) {
      const { start, end } = readLengthDelimited(bytes, offset);
      offset = end;
      visit(field, wireType, bytes.subarray(start, end));
    } else if (wireType === 1 || wireType === 5) {
      const width = wireType === 1 ? 8 : 4;
      if (width > bytes.length - offset) throw new Error("Truncated protobuf field");
      offset += width;
    } else {
      throw new Error("Unsupported protobuf wire type");
    }
  }
}

/** google.protobuf.Timestamp: field 1 holds the seconds. */
function decodeTimestamp(bytes: Uint8Array): string | undefined {
  let seconds = 0;
  eachField(bytes, (field, wireType, value) => {
    if (field === 1 && wireType === 0) seconds = value as number;
  });
  if (!seconds) return undefined;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid protobuf timestamp");
  return date.toISOString();
}

/**
 * Decode GetRemainingResets: field 10 repeats {10: token id, 20: valid from, 30: valid until}.
 * An empty payload is a confirmed zero. A non-empty payload with no coupon in it,
 * or a coupon without a token id, is a layout this build does not know; it is
 * reported as "unrecognized" and never as zero coupons.
 */
export function decodeRemainingResets(payload: Uint8Array): ResetCoupon[] | "unrecognized" {
  const coupons: ResetCoupon[] = [];
  let malformed = false;
  eachField(payload, (field, wireType, value) => {
    if (field !== 10 || wireType !== 2) return;
    let tokenId = "";
    let validityStart: string | undefined;
    let validityEnd: string | undefined;
    eachField(value as Uint8Array, (inner, innerWire, innerValue) => {
      if (innerWire !== 2) return;
      const bytes = innerValue as Uint8Array;
      if (inner === 10) tokenId = new TextDecoder().decode(bytes);
      else if (inner === 20) validityStart = decodeTimestamp(bytes);
      else if (inner === 30) validityEnd = decodeTimestamp(bytes);
    });
    if (!tokenId) {
      malformed = true;
      return;
    }
    coupons.push({
      ...(validityStart ? { validityStart } : {}),
      ...(validityEnd ? { validityEnd } : {}),
    });
  });
  return malformed || (payload.length > 0 && coupons.length === 0) ? "unrecognized" : coupons;
}

export async function fetchWeeklyCredits(deps: {
  bearer: string;
  userId: string;
  fetch?: FetchFn;
}): Promise<WeeklyCredits | null> {
  if (!deps.userId) return null;
  const response = await (deps.fetch ?? fetch)(`${GROK_BILLING_URL}?format=credits`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${deps.bearer}`,
      "x-xai-token-auth": "xai-grok-cli",
      "x-authenticateresponse": "authenticate-response",
      "x-userid": deps.userId,
      "x-grok-client-version": GROK_CLIENT_VERSION,
    },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return response.ok ? parseCreditsResponse(await response.json()) : null;
}

export async function fetchLegacyBilling(deps: {
  bearer: string;
  fetch?: FetchFn;
}): Promise<LegacyBilling | null> {
  const response = await (deps.fetch ?? fetch)(GROK_BILLING_URL, {
    headers: { Accept: "application/json", Authorization: `Bearer ${deps.bearer}` },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return response.ok ? parseLegacyBilling(await response.json()) : null;
}

/** Read-only coupon listing. An unconfirmed gRPC status is an error, never zero coupons. */
export async function fetchResetCoupons(deps: {
  bearer: string;
  fetch?: FetchFn;
}): Promise<ResetCouponsResult> {
  try {
    for (const endpoint of GROK_RESET_ENDPOINTS) {
      const response = await (deps.fetch ?? fetch)(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${deps.bearer}`,
          "content-type": "application/grpc-web+proto",
          "x-grpc-web": "1",
          "x-xai-token-auth": "xai-grok-cli",
        },
        body: encodeGrpcWebFrame(new Uint8Array()),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 404) continue;
      if (!response.ok) return { status: "error", reason: `HTTP ${response.status}` };

      const decoded = decodeGrpcWebResponse(new Uint8Array(await response.arrayBuffer()));
      const first = decoded.statusValues[0];
      const consistent = first !== undefined && decoded.statusValues.every((value) =>
        /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && value === first);
      if (!decoded.framingComplete || !consistent) {
        return { status: "error", reason: "Unconfirmed gRPC status" };
      }
      const status = Number(first);
      if (status === GRPC_UNIMPLEMENTED) continue;
      if (status !== 0) return { status: "error", reason: `gRPC status ${status}` };
      // Live replies carry exactly one data frame (empty when there are no coupons).
      // No frame at all has never been observed, so it is not taken as zero.
      if (decoded.messages.length === 0) return { status: "unknown", endpoint, reason: "unrecognized_payload" };
      if (decoded.messages.length > 1) return { status: "error", reason: "Unexpected gRPC message count" };

      const coupons = decodeRemainingResets(decoded.messages[0]);
      if (coupons === "unrecognized") return { status: "unknown", endpoint, reason: "unrecognized_payload" };
      return { status: "ok", coupons, endpoint };
    }
    return { status: "error", reason: "No supported reset endpoint" };
  } catch (error) {
    return { status: "error", reason: error instanceof Error ? error.message : "Reset request failed" };
  }
}
