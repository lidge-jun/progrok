import { createXaiTransport, type XaiTransport } from "../transport/fetch.js";

const MAX_ERROR_BODY_BYTES = 64 * 1024;

export type VoiceErrorCode =
  | "voice_auth_required" | "voice_forbidden" | "voice_not_found"
  | "voice_validation_error" | "voice_rate_limited" | "voice_upstream_error"
  | "voice_invalid_response";

export class VoiceHttpError extends Error {
  constructor(readonly code: VoiceErrorCode, readonly status: number | undefined, message: string, readonly retryAfter?: string) {
    super(message);
    this.name = "VoiceHttpError";
  }
}
export interface VoiceClientOptions { transport?: XaiTransport }
export interface VoiceHttpClient {
  request(path: string, init?: RequestInit): Promise<Response>;
  requestJson<T>(path: string, init: RequestInit, decode: (wire: unknown) => T): Promise<T>;
  requestBytes(path: string, init?: RequestInit): Promise<{ bytes: Uint8Array; contentType: string }>;
}

function statusCode(status: number): VoiceErrorCode {
  if (status === 401) return "voice_auth_required";
  if (status === 403) return "voice_forbidden";
  if (status === 404) return "voice_not_found";
  if (status === 400 || status === 415 || status === 422) return "voice_validation_error";
  if (status === 429) return "voice_rate_limited";
  return "voice_upstream_error";
}

async function throwForStatus(response: Response): Promise<never> {
  const reader = response.body?.getReader();
  let read = 0;
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      if (read > MAX_ERROR_BODY_BYTES) { await reader.cancel(); break; }
    }
  } catch { /* HTTP status is authoritative. */ }
  throw new VoiceHttpError(statusCode(response.status), response.status, `xAI Voice request failed with HTTP ${response.status}`, response.headers.get("retry-after") ?? undefined);
}

export function createVoiceHttpClient(options: VoiceClientOptions = {}): VoiceHttpClient {
  const transport = options.transport ?? createXaiTransport();
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const response = await transport.fetch({ pathWithQuery: path, method: init.method ?? "GET", headers: new Headers(init.headers), body: init.body, signal: init.signal ?? undefined });
    if (!response.ok) await throwForStatus(response);
    return response;
  };
  return {
    request,
    async requestJson<T>(
      path: string,
      init: RequestInit,
      decode: (wire: unknown) => T,
    ): Promise<T> {
      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      const response = await request(path, { ...init, headers });
      let wire: unknown;
      try { wire = await response.json(); }
      catch { throw new VoiceHttpError("voice_invalid_response", response.status, "xAI Voice returned invalid JSON"); }
      try { return decode(wire); }
      catch (cause) {
        if (cause instanceof VoiceHttpError) throw cause;
        throw new VoiceHttpError("voice_invalid_response", response.status, "xAI Voice response shape was invalid");
      }
    },
    async requestBytes(path, init = {}) {
      const response = await request(path, init);
      return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
    },
  };
}
export function expectRecord(wire: unknown, label: string): Record<string, unknown> {
  if (!wire || typeof wire !== "object" || Array.isArray(wire)) throw new VoiceHttpError("voice_invalid_response", undefined, `${label} must be an object`);
  return wire as Record<string, unknown>;
}
export function expectString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new VoiceHttpError("voice_invalid_response", undefined, `${key} must be a string`);
  return value;
}
export function jsonBody(value: unknown): Pick<RequestInit, "headers" | "body"> {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) };
}
