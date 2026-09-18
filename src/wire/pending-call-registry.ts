import { ToolCallWireError, valueType } from "./tool-call-wire.js";

export interface PendingCall {
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

export class PendingCallRegistry {
  readonly #maxBytes: number;
  readonly #calls = new Map<string, PendingCall>();
  readonly #byIndex = new Map<number, PendingCall>();
  readonly #byOutputIndex = new Map<number, PendingCall>();
  readonly #byItemId = new Map<string, PendingCall>();
  readonly #byId = new Map<string, PendingCall>();
  #nextKey = 0;
  #totalBytes = 0;

  constructor(maxBytes: number) {
    this.#maxBytes = maxBytes;
  }

  resolveChat(index: number | undefined, id: string | undefined): PendingCall {
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

  resolveResponses(
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

  resolveDelta(
    itemId: string | undefined,
    outputIndex: number | undefined,
  ): PendingCall {
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
        valueType: itemId === undefined ? valueType(outputIndex) : "string",
      });
    }
    return call;
  }

  bindIndex(call: PendingCall, index: number): void {
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

  bindId(call: PendingCall, id: string, index?: number): void {
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

  bindResponseId(call: PendingCall, id: string, itemId: string): void {
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
    this.bindId(call, id);
  }

  bindName(call: PendingCall, name: string, index?: number): void {
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

  bindItemId(call: PendingCall, itemId: string): void {
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

  bindOutputIndex(call: PendingCall, outputIndex: number): void {
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

  appendArguments(call: PendingCall, delta: string, index?: number): void {
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

  values(): IterableIterator<PendingCall> {
    return this.#calls.values();
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
}
