import { once } from "node:events";
import type { Response as ExpressResponse } from "express";

export const HOP_BY_HOP_HEADERS = new Set([
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
]);

function connectionHeaders(value: string | string[] | undefined): Set<string> {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return new Set(
    values
      .flatMap((entry) => entry.split(","))
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function filterRequestHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const connectionSpecific = connectionHeaders(headers.connection);
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(lower) ||
      connectionSpecific.has(lower) ||
      value === undefined
    ) {
      continue;
    }
    output[key] = Array.isArray(value) ? (value[0] ?? "") : value;
  }
  return output;
}

export function copyUpstreamHeaders(
  upstream: Response,
  res: ExpressResponse,
): void {
  const connectionSpecific = connectionHeaders(
    upstream.headers.get("connection") ?? undefined,
  );
  for (const [key, value] of upstream.headers) {
    const lower = key.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(lower) ||
      connectionSpecific.has(lower) ||
      lower === "content-length" ||
      lower === "content-encoding"
    ) {
      continue;
    }
    res.setHeader(key, value);
  }
}

export async function relayUpstreamResponse(
  upstream: Response,
  res: ExpressResponse,
): Promise<void> {
  res.status(upstream.status);
  copyUpstreamHeaders(upstream, res);
  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await once(res, "drain");
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}
