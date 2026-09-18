import { createVoiceHttpClient, expectRecord, expectString, jsonBody } from "./http.js";
import type { EphemeralClientSecret } from "./protocol.js";

function decodeClientSecret(wire: unknown): EphemeralClientSecret {
  const value = expectRecord(wire, "client secret");
  if (!Number.isInteger(value.expires_at)) throw new TypeError("expires_at must be integer epoch seconds");
  return { value: expectString(value, "value"), expires_at: value.expires_at as number };
}

export function mintClientSecret(opts?: { session?: unknown }): Promise<EphemeralClientSecret> {
  return createVoiceHttpClient().requestJson("/v1/realtime/client_secrets", { method: "POST", ...jsonBody(opts ?? {}) }, decodeClientSecret);
}
