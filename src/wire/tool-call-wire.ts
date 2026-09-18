export class ToolCallWireError extends Error {
  constructor(
    readonly code: "invalid_tool_call" | "tool_call_buffer_limit",
    message: string,
    readonly diagnostic?: {
      field?: string;
      valueType?: string;
      callIndex?: number;
    },
  ) {
    super(message);
    this.name = "ToolCallWireError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function valueType(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

export function invalid(
  field: string,
  value: unknown,
  callIndex?: number,
): ToolCallWireError {
  return new ToolCallWireError("invalid_tool_call", `invalid ${field}`, {
    field,
    valueType: valueType(value),
    ...(callIndex === undefined ? {} : { callIndex }),
  });
}

export function readOptionalString(
  value: unknown,
  field: string,
  alreadyKnown: boolean,
  callIndex?: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (alreadyKnown) return undefined;
  throw invalid(field, value, callIndex);
}

export function readIndex(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalid(field, value);
  }
  return value as number;
}

export function assertArgumentsObject(raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ToolCallWireError(
      "invalid_tool_call",
      "tool arguments were incomplete JSON",
      { field: "function.arguments", valueType: "string" },
    );
  }
  if (!isRecord(parsed)) {
    throw new ToolCallWireError(
      "invalid_tool_call",
      "tool arguments must decode to an object",
      { field: "function.arguments", valueType: valueType(parsed) },
    );
  }
}

export function readRequiredNonBlankString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw invalid(field, value);
  return value;
}
