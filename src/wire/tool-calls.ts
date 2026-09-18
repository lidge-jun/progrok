import type { AdapterEvent } from "../core/events.js";
import { PendingCallRegistry } from "./pending-call-registry.js";
import {
  assertArgumentsObject,
  invalid,
  isRecord,
  readIndex,
  readOptionalString,
  readRequiredNonBlankString,
  ToolCallWireError,
} from "./tool-call-wire.js";

export { ToolCallWireError } from "./tool-call-wire.js";

export const DEFAULT_MAX_TOOL_CALL_BYTES = 8 * 1024 * 1024;

export interface ToolCallAssemblerOptions {
  maxBytes?: number;
}

export class ToolCallAssembler {
  readonly #registry: PendingCallRegistry;

  constructor(options: ToolCallAssemblerOptions = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_TOOL_CALL_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError("maxBytes must be a positive safe integer");
    }
    this.#registry = new PendingCallRegistry(maxBytes);
  }

  ingestChat(rawToolCalls: unknown): void {
    if (rawToolCalls === undefined || rawToolCalls === null) return;
    if (!Array.isArray(rawToolCalls)) throw invalid("tool_calls", rawToolCalls);

    for (const rawCall of rawToolCalls) {
      if (!isRecord(rawCall)) throw invalid("tool_calls[]", rawCall);
      const index = readIndex(rawCall.index, "tool_calls[].index");
      if (rawCall.type !== undefined && rawCall.type !== "function") {
        throw invalid("tool_calls[].type", rawCall.type, index);
      }
      if (rawCall.function !== undefined && !isRecord(rawCall.function)) {
        throw invalid("tool_calls[].function", rawCall.function, index);
      }

      const functionRecord = isRecord(rawCall.function) ? rawCall.function : undefined;
      const provisionalId = typeof rawCall.id === "string" && rawCall.id.length > 0
        ? rawCall.id
        : undefined;
      const call = this.#registry.resolveChat(index, provisionalId);
      const id = readOptionalString(
        rawCall.id,
        "tool_calls[].id",
        call.id !== undefined,
        index,
      );
      const name = readOptionalString(
        functionRecord?.name,
        "tool_calls[].function.name",
        call.name !== undefined,
        index,
      );
      const argumentsDelta = readOptionalString(
        functionRecord?.arguments,
        "tool_calls[].function.arguments",
        call.sawArgumentsString,
        index,
      );

      if (index === undefined && id === undefined && call.id === undefined) {
        throw new ToolCallWireError("invalid_tool_call", "tool call lacked an index or id", {
          field: "tool_calls[].index",
          valueType: "undefined",
        });
      }
      if (index !== undefined) this.#registry.bindIndex(call, index);
      if (id !== undefined) this.#registry.bindId(call, id, index);
      if (name !== undefined) this.#registry.bindName(call, name, index);
      if (argumentsDelta !== undefined) {
        this.#registry.appendArguments(call, argumentsDelta, index);
      }
    }
  }

  ingestResponsesItem(rawItem: unknown): void {
    if (!isRecord(rawItem)) throw invalid("item", rawItem);
    if (rawItem.type !== "function_call") throw invalid("item.type", rawItem.type);
    const itemId = readRequiredNonBlankString(rawItem.id, "item.id");
    const outputIndex = readIndex(rawItem.output_index, "output_index");
    const callId = rawItem.call_id === undefined
      ? undefined
      : readRequiredNonBlankString(rawItem.call_id, "item.call_id");

    const call = this.#registry.resolveResponses(itemId, callId, outputIndex);
    this.#registry.bindItemId(call, itemId);
    if (outputIndex !== undefined) this.#registry.bindOutputIndex(call, outputIndex);
    this.#registry.bindResponseId(call, callId ?? itemId, itemId);

    const name = readOptionalString(rawItem.name, "item.name", call.name !== undefined);
    if (name !== undefined) this.#registry.bindName(call, name);
    const initialArguments = readOptionalString(
      rawItem.arguments,
      "item.arguments",
      call.sawArgumentsString,
    );
    if (initialArguments !== undefined) {
      if (!call.sawArgumentsString) this.#registry.appendArguments(call, initialArguments);
      else if (initialArguments !== call.arguments) {
        throw new ToolCallWireError("invalid_tool_call", "function call item arguments conflicted", {
          field: "item.arguments",
          valueType: "string",
        });
      }
    }
  }

  ingestResponsesDelta(rawEvent: Record<string, unknown>): void {
    if (!isRecord(rawEvent)) throw invalid("event", rawEvent);
    const itemId = rawEvent.item_id === undefined
      ? undefined
      : readRequiredNonBlankString(rawEvent.item_id, "item_id");
    const outputIndex = readIndex(rawEvent.output_index, "output_index");
    const call = this.#registry.resolveDelta(itemId, outputIndex);
    if (typeof rawEvent.delta !== "string") throw invalid("delta", rawEvent.delta);
    this.#registry.appendArguments(call, rawEvent.delta);
  }

  completeResponsesItem(rawItem: unknown): void {
    if (!isRecord(rawItem)) throw invalid("item", rawItem);
    if (rawItem.type !== "function_call") throw invalid("item.type", rawItem.type);
    const itemId = readRequiredNonBlankString(rawItem.id, "item.id");
    const callId = rawItem.call_id === undefined
      ? undefined
      : readRequiredNonBlankString(rawItem.call_id, "item.call_id");
    const outputIndex = readIndex(rawItem.output_index, "output_index");
    const call = this.#registry.resolveResponses(itemId, callId, outputIndex);
    this.#registry.bindItemId(call, itemId);
    if (outputIndex !== undefined) this.#registry.bindOutputIndex(call, outputIndex);
    this.#registry.bindResponseId(call, callId ?? itemId, itemId);

    const name = readOptionalString(rawItem.name, "item.name", call.name !== undefined);
    if (name !== undefined) this.#registry.bindName(call, name);
    const snapshot = readOptionalString(
      rawItem.arguments,
      "item.arguments",
      call.sawArgumentsString,
    );
    if (snapshot === undefined) return;
    if (!call.sawArgumentsString) {
      this.#registry.appendArguments(call, snapshot);
      return;
    }
    if (snapshot === call.arguments) return;
    if (!snapshot.startsWith(call.arguments)) {
      throw new ToolCallWireError("invalid_tool_call", "function call arguments snapshot conflicted", {
        field: "item.arguments",
        valueType: "string",
      });
    }
    this.#registry.appendArguments(call, snapshot.slice(call.arguments.length));
  }

  flush(): AdapterEvent[] {
    const calls = [...this.#registry.values()];
    for (const call of calls) {
      if (!call.id || !call.name || call.name.trim().length === 0 || !call.sawArgumentsString) {
        throw new ToolCallWireError("invalid_tool_call", "tool call was incomplete", {
          ...(call.index === undefined ? {} : { callIndex: call.index }),
        });
      }
      assertArgumentsObject(call.arguments);
    }

    const events = calls.flatMap<AdapterEvent>((call) => [
      {
        type: "tool_call_start",
        id: call.id as string,
        name: call.name as string,
        ...(call.itemId ? { itemId: call.itemId } : {}),
      },
      ...(call.arguments.length > 0
        ? [{
            type: "tool_call_delta",
            id: call.id as string,
            arguments: call.arguments,
          } as AdapterEvent]
        : []),
      { type: "tool_call_end", id: call.id as string },
    ]);
    this.clear();
    return events;
  }

  clear(): void {
    this.#registry.clear();
  }

  get pendingCount(): number {
    return this.#registry.pendingCount;
  }
}
