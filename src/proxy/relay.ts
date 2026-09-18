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
      if (!res.write(value)) {
        // A paused socket resumes with "drain" — unless the client goes away
        // first, in which case "drain" never fires and waiting for it alone
        // strands this promise and the upstream reader with it.
        const resumed = await waitForDrainOrClose(res);
        if (!resumed) return;
      }
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}

/** Resolves true when the socket drains, false when it closes or errors first. */
function waitForDrainOrClose(res: ExpressResponse): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const settle = (resumed: boolean) => () => {
      res.off("drain", onDrain);
      res.off("close", onClose);
      res.off("error", onError);
      resolve(resumed);
    };
    const onDrain = settle(true);
    const onClose = settle(false);
    const onError = settle(false);
    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
  });
}
