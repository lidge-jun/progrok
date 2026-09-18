import { randomUUID } from "node:crypto";
import type { UpstreamAuthKind } from "./base-url.js";

const FILTERED_INCOMING_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "authorization",
  "x-xai-token-auth",
]);

export interface GrokTraceContext {
  requestId?: string;
  conversationId?: string;
  sessionId?: string;
  agentId?: string;
  turnIndex?: number;
  modelOverride?: string;
  transientRetry?: boolean;
}

export interface BuildUpstreamHeadersInput {
  incoming?: Headers | Record<string, string | string[] | undefined>;
  auth: { kind: UpstreamAuthKind; bearer: string };
  trace?: GrokTraceContext;
  clientVersion: string;
}

function toHeaders(
  incoming: BuildUpstreamHeadersInput["incoming"],
): Headers {
  if (incoming instanceof Headers) return incoming;
  const result = new Headers();
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (value === undefined) continue;
    result.set(key, Array.isArray(value) ? (value[0] ?? "") : value);
  }
  return result;
}

export function buildUpstreamHeaders(
  input: BuildUpstreamHeadersInput,
): Headers {
  const result = new Headers();
  for (const [key, value] of toHeaders(input.incoming)) {
    const lower = key.toLowerCase();
    if (
      !FILTERED_INCOMING_HEADERS.has(lower) &&
      !lower.startsWith("x-grok-")
    ) {
      result.set(key, value);
    }
  }

  result.set("Authorization", `Bearer ${input.auth.bearer}`);
  if (input.auth.kind === "oauth") {
    result.set("X-XAI-Token-Auth", "xai-grok-cli");
  }
  result.set("x-grok-client-identifier", "progrok");
  result.set("x-grok-client-version", input.clientVersion);
  result.set("x-grok-req-id", input.trace?.requestId ?? randomUUID());
  if (input.trace?.conversationId) {
    result.set("x-grok-conv-id", input.trace.conversationId);
  }
  if (input.trace?.sessionId) {
    result.set("x-grok-session-id", input.trace.sessionId);
  }
  if (input.trace?.agentId) {
    result.set("x-grok-agent-id", input.trace.agentId);
  }
  if (input.trace?.turnIndex !== undefined) {
    result.set("x-grok-turn-idx", String(input.trace.turnIndex));
  }
  if (input.trace?.modelOverride) {
    result.set("x-grok-model-override", input.trace.modelOverride);
  }
  if (input.trace?.transientRetry) {
    result.set("x-grok-transient-retry", "true");
  }
  return result;
}
