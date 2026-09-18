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

export interface ReduceResponsesStreamOptions
  extends DecodeSseOptions, ToolCallAssemblerOptions {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueType(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

function invalidShape(field: string, value?: unknown): AdapterError {
  return new AdapterError("invalid_wire_shape", "invalid Responses SSE wire shape", {
    diagnostic: { field, valueType: valueType(value) },
  });
}

function invalidWire(field: string, value: unknown): AdapterEvent {
  return {
    type: "error",
    code: "invalid_wire_shape",
    message: "invalid Responses SSE wire shape",
    retryable: false,
    diagnostic: { field, valueType: valueType(value) },
  };
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
  const inputTokens = tokenCount(value, "input_tokens", "prompt_tokens");
  const outputTokens = tokenCount(value, "output_tokens", "completion_tokens");
  const totalTokens = tokenCount(value, "total_tokens");
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    raw: { ...value },
  };
}

function eventItemId(raw: Record<string, unknown>): { itemId?: string } {
  if (raw.item_id === undefined || raw.item_id === null) return {};
  if (typeof raw.item_id !== "string" || raw.item_id.length === 0) {
    throw invalidShape("item_id", raw.item_id);
  }
  return { itemId: raw.item_id };
}

function outputIndex(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidShape("output_index", value);
  }
  return value as number;
}

function safeUpstreamMessage(raw: Record<string, unknown>): string {
  const candidates: unknown[] = [raw.error];
  if (isRecord(raw.response)) candidates.push(raw.response.error);
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate.slice(0, 512);
    }
    if (isRecord(candidate) && typeof candidate.message === "string" && candidate.message.length > 0) {
      return candidate.message.slice(0, 512);
    }
  }
  return "xAI upstream returned an error";
}

function incompleteEvent(raw: Record<string, unknown>): AdapterEvent {
  if (!isRecord(raw.response)) throw invalidShape("response", raw.response);
  if (!isRecord(raw.response.incomplete_details)) {
    throw invalidShape("response.incomplete_details", raw.response.incomplete_details);
  }
  const reason = raw.response.incomplete_details.reason;
  if (typeof reason !== "string" || reason.length === 0) {
    throw invalidShape("response.incomplete_details.reason", reason);
  }
  const usage = parseUsage(raw.response.usage);
  if (
    raw.response.id !== undefined &&
    (typeof raw.response.id !== "string" || raw.response.id.length === 0)
  ) {
    throw invalidShape("response.id", raw.response.id);
  }
  return {
    type: "incomplete",
    protocol: "responses",
    reason,
    ...(typeof raw.response.id === "string" ? { responseId: raw.response.id } : {}),
    ...(usage ? { usage } : {}),
  };
}

function upstreamErrorEvent(raw: Record<string, unknown>): AdapterEvent {
  return {
    type: "error",
    code: "upstream_error",
    message: safeUpstreamMessage(raw),
    retryable: false,
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
    message: "invalid Responses SSE wire shape",
    retryable: false,
    diagnostic: { valueType: valueType(error) },
  };
}

export async function* reduceResponsesStream(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  options: ReduceResponsesStreamOptions = {},
): AsyncGenerator<AdapterEvent> {
  const tools = new ToolCallAssembler({ maxBytes: options.maxBytes });
  const openItems = new Set<string>();
  const itemByOutputIndex = new Map<number, string>();
  const itemTypes = new Map<string, string>();
  let terminal = false;

  try {
    for await (const frame of decodeServerSentEvents(source, options)) {
      if (terminal) return;
      let raw: unknown;
      try {
        raw = JSON.parse(frame.data);
      } catch {
        terminal = true;
        yield {
          type: "error",
          code: "malformed_sse_json",
          message: "malformed Responses SSE data",
          retryable: false,
        };
        return;
      }
      if (!isRecord(raw) || typeof raw.type !== "string") {
        terminal = true;
        yield invalidWire("type", isRecord(raw) ? raw.type : raw);
        return;
      }

      switch (raw.type) {
        case "response.output_item.added": {
          if (
            !isRecord(raw.item) ||
            typeof raw.item.id !== "string" ||
            raw.item.id.length === 0 ||
            typeof raw.item.type !== "string" ||
            raw.item.type.length === 0
          ) {
            throw invalidShape("item", raw.item);
          }
          if (openItems.has(raw.item.id)) throw invalidShape("item.id", raw.item.id);
          const index = outputIndex(raw.output_index);
          if (index !== undefined) {
            const existing = itemByOutputIndex.get(index);
            if (existing !== undefined && existing !== raw.item.id) {
              throw invalidShape("output_index", raw.output_index);
            }
            itemByOutputIndex.set(index, raw.item.id);
          }
          openItems.add(raw.item.id);
          itemTypes.set(raw.item.id, raw.item.type);
          if (raw.item.type === "function_call") {
            tools.ingestResponsesItem({
              ...raw.item,
              ...(index === undefined ? {} : { output_index: index }),
            });
          }
          break;
        }
        case "response.output_text.delta":
          if (typeof raw.delta !== "string") throw invalidShape("delta", raw.delta);
          if (raw.delta.length > 0) {
            const item = eventItemId(raw);
            if (item.itemId && !itemTypes.has(item.itemId)) {
              throw invalidShape("item_id", item.itemId);
            }
            yield { type: "text_delta", text: raw.delta, ...item };
          }
          break;
        case "response.reasoning_text.delta":
        case "response.reasoning_summary_text.delta":
          if (typeof raw.delta !== "string") throw invalidShape("delta", raw.delta);
          if (raw.delta.length > 0) {
            const item = eventItemId(raw);
            if (item.itemId && !itemTypes.has(item.itemId)) {
              throw invalidShape("item_id", item.itemId);
            }
            yield { type: "reasoning_delta", text: raw.delta, ...item };
          }
          break;
        case "response.function_call_arguments.delta": {
          const index = outputIndex(raw.output_index);
          const normalized =
            raw.item_id === undefined && index !== undefined && itemByOutputIndex.has(index)
              ? { ...raw, item_id: itemByOutputIndex.get(index) }
              : raw;
          tools.ingestResponsesDelta(normalized);
          yield { type: "heartbeat" };
          break;
        }
        case "response.output_item.done": {
          if (
            !isRecord(raw.item) ||
            typeof raw.item.id !== "string" ||
            typeof raw.item.type !== "string" ||
            !openItems.delete(raw.item.id)
          ) {
            throw invalidShape("item.id", isRecord(raw.item) ? raw.item.id : raw.item);
          }
          if (itemTypes.get(raw.item.id) !== raw.item.type) {
            throw invalidShape("item.type", raw.item.type);
          }
          const index = outputIndex(raw.output_index);
          if (index !== undefined) {
            const expectedId = itemByOutputIndex.get(index);
            if (expectedId !== raw.item.id) throw invalidShape("output_index", raw.output_index);
          }
          if (raw.item.type === "function_call") {
            tools.completeResponsesItem({
              ...raw.item,
              ...(index === undefined ? {} : { output_index: index }),
            });
          }
          break;
        }
        case "response.completed": {
          if (!isRecord(raw.response)) throw invalidShape("response", raw.response);
          if (
            raw.response.id !== undefined &&
            (typeof raw.response.id !== "string" || raw.response.id.length === 0)
          ) {
            throw invalidShape("response.id", raw.response.id);
          }
          const responseId = raw.response.id as string | undefined;
          const usage = parseUsage(raw.response.usage);
          const output = raw.response.output;
          if (output !== undefined) {
            if (!Array.isArray(output)) throw invalidShape("response.output", output);
            const snapshotIds = new Set<string>();
            for (const item of output) {
              if (
                !isRecord(item) ||
                typeof item.id !== "string" ||
                item.id.length === 0 ||
                typeof item.type !== "string" ||
                item.type.length === 0 ||
                snapshotIds.has(item.id)
              ) {
                throw invalidShape("response.output[]", item);
              }
              snapshotIds.add(item.id);
              const knownType = itemTypes.get(item.id);
              if (knownType !== undefined && knownType !== item.type) {
                throw invalidShape("response.output[].type", item.type);
              }
              openItems.delete(item.id);
              if (item.type === "function_call") tools.completeResponsesItem(item);
            }
          }
          if (openItems.size > 0) throw invalidShape("response.output", output);
          const toolEvents = tools.flush();
          terminal = true;
          for (const event of toolEvents) yield event;
          yield {
            type: "done",
            protocol: "responses",
            ...(responseId === undefined ? {} : { responseId }),
            ...(usage ? { usage } : {}),
          };
          return;
        }
        case "response.incomplete":
          terminal = true;
          yield incompleteEvent(raw);
          return;
        case "response.failed":
        case "error":
          terminal = true;
          yield upstreamErrorEvent(raw);
          return;
        default:
          yield { type: "heartbeat" };
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
      message:
        "Responses SSE ended without response.completed, response.incomplete, response.failed, or error",
      retryable: false,
    };
  }
}
