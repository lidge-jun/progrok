export type ProxyRouteDecision =
  | { kind: "native-chat"; json: Record<string, unknown> }
  | { kind: "native-responses"; json: Record<string, unknown> }
  | { kind: "json-relay"; json: Record<string, unknown> }
  | { kind: "opaque-relay" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

export function decideProxyRoute(input: {
  method: string;
  relPath: string;
  contentType?: string;
  body: Buffer;
}): ProxyRouteDecision {
  if (input.method.toUpperCase() !== "POST") {
    return { kind: "opaque-relay" };
  }
  if (input.relPath !== "/chat/completions" && input.relPath !== "/responses") {
    return { kind: "opaque-relay" };
  }
  if (!isJsonContentType(input.contentType)) {
    return { kind: "opaque-relay" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body.toString("utf8"));
  } catch {
    return { kind: "opaque-relay" };
  }
  if (!isRecord(parsed)) return { kind: "opaque-relay" };
  if (parsed.stream !== true) return { kind: "json-relay", json: parsed };

  return input.relPath === "/responses"
    ? { kind: "native-responses", json: parsed }
    : { kind: "native-chat", json: parsed };
}
