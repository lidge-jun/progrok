import { AdapterError } from "../core/errors.js";
import type { AdapterEvent, AdapterUsage } from "../core/events.js";
import {
  decodeServerSentEvents,
  SseDecodeError,
  type DecodeSseOptions,
} from "./sse.js";
import {
  ToolCallAssembler,
  ToolCallWireError,
  type ToolCallAssemblerOptions,
} from "./tool-calls.js";

export interface ReduceChatStreamOptions
  extends DecodeSseOptions, ToolCallAssemblerOptions {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueType(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

function invalidWire(field: string, value: unknown): AdapterEvent {
  return {
    type: "error",
    code: "invalid_wire_shape",
    message: "invalid Chat SSE wire shape",
    retryable: false,
    diagnostic: { field, valueType: valueType(value) },
  };
}

function invalidShape(field: string, value: unknown): AdapterError {
  return new AdapterError("invalid_wire_shape", "invalid Chat SSE wire shape", {
    diagnostic: { field, valueType: valueType(value) },
  });
}

function safeUpstreamMessage(error: unknown): string {
  if (typeof error === "string" && error.length > 0) return error.slice(0, 512);
  if (isRecord(error) && typeof error.message === "string" && error.message.length > 0) {
    return error.message.slice(0, 512);
  }
  return "xAI upstream returned an error";
}

function tokenCount(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw invalidShape(`usage.${key}`, value);
    }
    return value as number;
  }
  return undefined;
}

function parseUsage(value: unknown): AdapterUsage | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw invalidShape("usage", value);
  const inputTokens = tokenCount(value, "prompt_tokens", "input_tokens");
  const outputTokens = tokenCount(value, "completion_tokens", "output_tokens");
  const totalTokens = tokenCount(value, "total_tokens");
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    raw: { ...value },
  };
}

function mapWireError(error: unknown): AdapterEvent {
  if (error instanceof SseDecodeError) {
    return { type: "error", code: error.code, message: error.message, retryable: false };
  }
  if (error instanceof ToolCallWireError) {
    return {
      type: "error",
      code: error.code,
      message: error.message,
      retryable: false,
      ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}),
    };
  }
  if (error instanceof AdapterError) {
    return {
      type: "error",
      code: error.code,
      message: error.message,
      retryable: false,
      ...(error.options.status === undefined ? {} : { status: error.options.status }),
      ...(error.options.diagnostic ? { diagnostic: error.options.diagnostic } : {}),
    };
  }
  return {
    type: "error",
    code: "invalid_wire_shape",
    message: "invalid Chat SSE wire shape",
    retryable: false,
    diagnostic: { valueType: valueType(error) },
  };
}

export async function* reduceChatStream(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  options: ReduceChatStreamOptions = {},
): AsyncGenerator<AdapterEvent> {
  const tools = new ToolCallAssembler({ maxBytes: options.maxBytes });
  let terminal = false;
  let finishReason: string | undefined;
  let usage: AdapterUsage | undefined;

  const done = (): AdapterEvent => ({
    type: "done",
    protocol: "chat",
    ...(finishReason ? { finishReason } : {}),
    ...(usage ? { usage } : {}),
  });

  try {
    for await (const frame of decodeServerSentEvents(source, options)) {
      if (terminal) return;
      const payload = frame.data.trim();
      if (payload === "[DONE]") {
        for (const event of tools.flush()) yield event;
        terminal = true;
        yield done();
        return;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(payload);
      } catch {
        terminal = true;
        yield {
          type: "error",
          code: "malformed_sse_json",
          message: "malformed Chat SSE data",
          retryable: false,
        };
        return;
      }
      if (!isRecord(raw)) {
        terminal = true;
        yield invalidWire("payload", raw);
        return;
      }
      if (raw.error !== undefined && raw.error !== null) {
        terminal = true;
        yield {
          type: "error",
          code: "upstream_error",
          message: safeUpstreamMessage(raw.error),
          retryable: false,
        };
        return;
      }

      usage = parseUsage(raw.usage) ?? usage;
      if (raw.choices === undefined) continue;
      if (!Array.isArray(raw.choices) || !isRecord(raw.choices[0])) {
        terminal = true;
        yield invalidWire("choices", raw.choices);
        return;
      }

      const choice = raw.choices[0];
      if (choice.delta !== undefined && choice.delta !== null && !isRecord(choice.delta)) {
        throw invalidShape("choices[0].delta", choice.delta);
      }
      if (isRecord(choice.delta)) {
        const content = choice.delta.content;
        if (content !== undefined && content !== null && typeof content !== "string") {
          throw invalidShape("choices[0].delta.content", content);
        }
        if (typeof content === "string" && content.length > 0) {
          yield { type: "text_delta", text: content };
        }

        const reasoning = choice.delta.reasoning_content;
        if (reasoning !== undefined && reasoning !== null && typeof reasoning !== "string") {
          throw invalidShape("choices[0].delta.reasoning_content", reasoning);
        }
        if (typeof reasoning === "string" && reasoning.length > 0) {
          yield { type: "reasoning_delta", text: reasoning };
        }

        tools.ingestChat(choice.delta.tool_calls);
        if (choice.delta.tool_calls !== undefined && choice.delta.tool_calls !== null) {
          yield { type: "heartbeat" };
        }
      }

      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        if (typeof choice.finish_reason !== "string" || choice.finish_reason.length === 0) {
          terminal = true;
          yield invalidWire("choices[0].finish_reason", choice.finish_reason);
          return;
        }
        finishReason = choice.finish_reason;
        for (const event of tools.flush()) yield event;
        terminal = true;
        yield done();
        return;
      }
    }
  } catch (error) {
    terminal = true;
    yield mapWireError(error);
    return;
  } finally {
    tools.clear();
  }

  if (!terminal) {
    yield {
      type: "error",
      code: "stream_truncated",
      message: "Chat SSE ended without finish_reason or [DONE]",
      retryable: false,
    };
  }
}
