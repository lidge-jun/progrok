export type AdapterErrorCode =
  | "invalid_utf8"
  | "sse_buffer_limit"
  | "malformed_sse_json"
  | "invalid_wire_shape"
  | "invalid_tool_call"
  | "tool_call_buffer_limit"
  | "stream_truncated"
  | "upstream_error";

export interface SafeErrorDiagnostic {
  field?: string;
  valueType?: string;
  callIndex?: number;
}

export interface AdapterErrorDetail {
  code: AdapterErrorCode;
  message: string;
  status?: number;
  retryable: false;
  diagnostic?: SafeErrorDiagnostic;
}

export class AdapterError extends Error {
  readonly retryable = false as const;

  constructor(
    readonly code: AdapterErrorCode,
    message: string,
    readonly options: {
      status?: number;
      diagnostic?: SafeErrorDiagnostic;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AdapterError";
  }
}

export function toSafeErrorDetail(
  error: unknown,
  fallback: Pick<AdapterErrorDetail, "code" | "message">,
): AdapterErrorDetail {
  if (!(error instanceof AdapterError)) {
    return {
      ...fallback,
      retryable: false,
      diagnostic: {
        valueType:
          error === null ? "null" : Array.isArray(error) ? "array" : typeof error,
      },
    };
  }

  return {
    code: error.code,
    message: error.message.slice(0, 512),
    retryable: false,
    ...(error.options.status !== undefined ? { status: error.options.status } : {}),
    ...(error.options.diagnostic ? { diagnostic: error.options.diagnostic } : {}),
  };
}
