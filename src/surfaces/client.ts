import type { XaiTransport } from "../transport/fetch.js";

const MAX_ERROR_BODY_CHARS = 4_096;

export type JsonObject = Record<string, unknown>;
export type Decoder<T> = (wire: unknown) => T;

export class XaiSurfaceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "XaiSurfaceError";
  }
}

export function expectObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonObject;
}

export function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

async function readError(response: Response): Promise<XaiSurfaceError> {
  const text = (await response.text()).slice(0, MAX_ERROR_BODY_CHARS);
  let code: string | undefined;
  let message = text || `xAI returned HTTP ${response.status}`;
  try {
    const root = expectObject(JSON.parse(text), "error response");
    const error = expectObject(root.error, "error response.error");
    if (typeof error.code === "string") code = error.code;
    if (typeof error.message === "string") message = error.message;
  } catch {
    // The bounded raw text remains the safe fallback.
  }
  return new XaiSurfaceError(response.status, code, message);
}

export async function requestJson<T>(
  transport: XaiTransport,
  path: string,
  init: RequestInit,
  decode: Decoder<T>,
): Promise<T> {
  const response = await transport.fetch({
    pathWithQuery: path,
    method: init.method ?? "GET",
    headers: new Headers(init.headers),
    body: init.body,
    signal: init.signal ?? undefined,
  });
  if (!response.ok) throw await readError(response);
  const wire: unknown = await response.json();
  return decode(wire);
}

export async function requestBytes(
  transport: XaiTransport,
  path: string,
  init: RequestInit = {},
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const response = await transport.fetch({
    pathWithQuery: path,
    method: init.method ?? "GET",
    headers: new Headers(init.headers),
    body: init.body,
    signal: init.signal ?? undefined,
  });
  if (!response.ok) throw await readError(response);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
  };
}

export async function requestVoid(
  transport: XaiTransport,
  path: string,
  init: RequestInit,
): Promise<void> {
  const response = await transport.fetch({
    pathWithQuery: path,
    method: init.method ?? "GET",
    headers: new Headers(init.headers),
    body: init.body,
    signal: init.signal ?? undefined,
  });
  if (!response.ok) throw await readError(response);
  await response.body?.cancel();
}

export function jsonBody(
  value: unknown,
): Pick<RequestInit, "headers" | "body"> {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}
