import type { AdapterEvent } from "../core/events.js";

export const DEFAULT_MAX_TOOL_CALL_BYTES = 8 * 1024 * 1024;

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

export interface ToolCallAssemblerOptions {
  maxBytes?: number;
}

interface PendingCall {
  key: string;
  index?: number;
  outputIndex?: number;
  itemId?: string;
  id?: string;
  name?: string;
  arguments: string;
  sawArgumentsString: boolean;
  bytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueType(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

function invalid(
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

function readOptionalString(
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

function readIndex(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalid(field, value);
  }
  return value as number;
}

function assertArgumentsObject(raw: string): void {
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

export class ToolCallAssembler {
  readonly #maxBytes: number;
  readonly #calls = new Map<string, PendingCall>();
  readonly #byIndex = new Map<number, PendingCall>();
  readonly #byOutputIndex = new Map<number, PendingCall>();
  readonly #byItemId = new Map<string, PendingCall>();
  readonly #byId = new Map<string, PendingCall>();
  #nextKey = 0;
  #totalBytes = 0;

  constructor(options: ToolCallAssemblerOptions = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_TOOL_CALL_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError("maxBytes must be a positive safe integer");
    }
    this.#maxBytes = maxBytes;
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
      const call = this.#resolveChat(index, provisionalId);
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
      if (index !== undefined) this.#bindIndex(call, index);
      if (id !== undefined) this.#bindId(call, id, index);
      if (name !== undefined) this.#bindName(call, name, index);
      if (argumentsDelta !== undefined) this.#appendArguments(call, argumentsDelta, index);
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

    const call = this.#resolveResponses(itemId, callId, outputIndex);
    this.#bindItemId(call, itemId);
    if (outputIndex !== undefined) this.#bindOutputIndex(call, outputIndex);
    this.#bindResponseId(call, callId ?? itemId, itemId);

    const name = readOptionalString(rawItem.name, "item.name", call.name !== undefined);
    if (name !== undefined) this.#bindName(call, name);
    const initialArguments = readOptionalString(
      rawItem.arguments,
      "item.arguments",
      call.sawArgumentsString,
    );
    if (initialArguments !== undefined) {
      if (!call.sawArgumentsString) this.#appendArguments(call, initialArguments);
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
    const byItem = itemId === undefined ? undefined : this.#byItemId.get(itemId);
    const byOutput = outputIndex === undefined
      ? undefined
      : this.#byOutputIndex.get(outputIndex);
    if (byItem && byOutput && byItem !== byOutput) {
      throw new ToolCallWireError("invalid_tool_call", "function call aliases conflicted", {
        field: "item_id",
        valueType: "string",
      });
    }
    const call = byItem ?? byOutput;
    if (!call) {
      throw new ToolCallWireError("invalid_tool_call", "function call delta had no matching item", {
        field: itemId === undefined ? "output_index" : "item_id",
        valueType: itemId === undefined ? valueType(rawEvent.output_index) : "string",
      });
    }
    if (typeof rawEvent.delta !== "string") throw invalid("delta", rawEvent.delta);
    this.#appendArguments(call, rawEvent.delta);
  }

  completeResponsesItem(rawItem: unknown): void {
    if (!isRecord(rawItem)) throw invalid("item", rawItem);
    if (rawItem.type !== "function_call") throw invalid("item.type", rawItem.type);
    const itemId = readRequiredNonBlankString(rawItem.id, "item.id");
    const callId = rawItem.call_id === undefined
      ? undefined
      : readRequiredNonBlankString(rawItem.call_id, "item.call_id");
    const outputIndex = readIndex(rawItem.output_index, "output_index");
    const call = this.#resolveResponses(itemId, callId, outputIndex);
    this.#bindItemId(call, itemId);
    if (outputIndex !== undefined) this.#bindOutputIndex(call, outputIndex);
    this.#bindResponseId(call, callId ?? itemId, itemId);

    const name = readOptionalString(rawItem.name, "item.name", call.name !== undefined);
    if (name !== undefined) this.#bindName(call, name);
    const snapshot = readOptionalString(
      rawItem.arguments,
      "item.arguments",
      call.sawArgumentsString,
    );
    if (snapshot === undefined) return;
    if (!call.sawArgumentsString) {
      this.#appendArguments(call, snapshot);
      return;
    }
    if (snapshot === call.arguments) return;
    if (!snapshot.startsWith(call.arguments)) {
      throw new ToolCallWireError("invalid_tool_call", "function call arguments snapshot conflicted", {
        field: "item.arguments",
        valueType: "string",
      });
    }
    this.#appendArguments(call, snapshot.slice(call.arguments.length));
  }

  flush(): AdapterEvent[] {
    const calls = [...this.#calls.values()];
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
    this.#calls.clear();
    this.#byIndex.clear();
    this.#byOutputIndex.clear();
    this.#byItemId.clear();
    this.#byId.clear();
    this.#totalBytes = 0;
  }

  get pendingCount(): number {
    return this.#calls.size;
  }

  #createCall(): PendingCall {
    const key = `call:${this.#nextKey}`;
    this.#nextKey += 1;
    const call: PendingCall = {
      key,
      arguments: "",
      sawArgumentsString: false,
      bytes: 0,
    };
    this.#calls.set(key, call);
    return call;
  }

  #resolveChat(index: number | undefined, id: string | undefined): PendingCall {
    const byIndex = index === undefined ? undefined : this.#byIndex.get(index);
    const byId = id === undefined ? undefined : this.#byId.get(id);
    if (byIndex && byId && byIndex !== byId) {
      throw new ToolCallWireError("invalid_tool_call", "tool call id and index conflicted", {
        field: "tool_calls[].id",
        valueType: "string",
        ...(index === undefined ? {} : { callIndex: index }),
      });
    }
    return byIndex ?? byId ?? this.#createCall();
  }

  #resolveResponses(
    itemId: string,
    id: string | undefined,
    outputIndex: number | undefined,
  ): PendingCall {
    const candidates = [
      this.#byItemId.get(itemId),
      id === undefined ? undefined : this.#byId.get(id),
      outputIndex === undefined ? undefined : this.#byOutputIndex.get(outputIndex),
    ].filter((call): call is PendingCall => call !== undefined);
    if (candidates.some((call) => call !== candidates[0])) {
      throw new ToolCallWireError("invalid_tool_call", "function call aliases conflicted", {
        field: "item.id",
        valueType: "string",
      });
    }
    return candidates[0] ?? this.#createCall();
  }

  #bindIndex(call: PendingCall, index: number): void {
    const existing = this.#byIndex.get(index);
    if ((existing && existing !== call) || (call.index !== undefined && call.index !== index)) {
      throw new ToolCallWireError("invalid_tool_call", "tool call index conflicted", {
        field: "tool_calls[].index",
        valueType: "number",
        callIndex: index,
      });
    }
    call.index = index;
    this.#byIndex.set(index, call);
  }

  #bindId(call: PendingCall, id: string, index?: number): void {
    if (id.length === 0) return;
    const existing = this.#byId.get(id);
    if (existing && existing !== call) {
      throw new ToolCallWireError("invalid_tool_call", "tool call id conflicted", {
        field: "tool_calls[].id",
        valueType: "string",
        ...(index === undefined ? {} : { callIndex: index }),
      });
    }
    if (call.id && call.id !== id) {
      throw new ToolCallWireError("invalid_tool_call", "tool call id changed", {
        field: "tool_calls[].id",
        valueType: "string",
        ...(index === undefined ? {} : { callIndex: index }),
      });
    }
    call.id = id;
    this.#byId.set(id, call);
  }

  #bindResponseId(call: PendingCall, id: string, itemId: string): void {
    if (call.id && call.id !== id) {
      if (call.id !== itemId) {
        throw new ToolCallWireError("invalid_tool_call", "function call id changed", {
          field: "item.call_id",
          valueType: "string",
        });
      }
      if (this.#byId.get(call.id) === call) this.#byId.delete(call.id);
      call.id = undefined;
    }
    this.#bindId(call, id);
  }

  #bindName(call: PendingCall, name: string, index?: number): void {
    if (name.length === 0) return;
    if (call.name && call.name !== name) {
      throw new ToolCallWireError("invalid_tool_call", "tool call name changed", {
        field: "function.name",
        valueType: "string",
        ...(index === undefined ? {} : { callIndex: index }),
      });
    }
    call.name = name;
  }

  #bindItemId(call: PendingCall, itemId: string): void {
    const existing = this.#byItemId.get(itemId);
    if ((existing && existing !== call) || (call.itemId && call.itemId !== itemId)) {
      throw new ToolCallWireError("invalid_tool_call", "function call item id conflicted", {
        field: "item.id",
        valueType: "string",
      });
    }
    call.itemId = itemId;
    this.#byItemId.set(itemId, call);
  }

  #bindOutputIndex(call: PendingCall, outputIndex: number): void {
    const existing = this.#byOutputIndex.get(outputIndex);
    if (
      (existing && existing !== call) ||
      (call.outputIndex !== undefined && call.outputIndex !== outputIndex)
    ) {
      throw new ToolCallWireError("invalid_tool_call", "function call output index conflicted", {
        field: "output_index",
        valueType: "number",
      });
    }
    call.outputIndex = outputIndex;
    this.#byOutputIndex.set(outputIndex, call);
  }

  #appendArguments(call: PendingCall, delta: string, index?: number): void {
    const bytes = Buffer.byteLength(delta, "utf8");
    if (this.#totalBytes + bytes > this.#maxBytes) {
      throw new ToolCallWireError(
        "tool_call_buffer_limit",
        "tool arguments exceeded the safe byte limit",
        {
          field: "function.arguments",
          valueType: "string",
          ...(index === undefined ? {} : { callIndex: index }),
        },
      );
    }
    call.arguments += delta;
    call.sawArgumentsString = true;
    call.bytes += bytes;
    this.#totalBytes += bytes;
  }
}

function readRequiredNonBlankString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw invalid(field, value);
  return value;
}
