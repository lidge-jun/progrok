import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ToolCallAssembler,
  ToolCallWireError,
} from "../src/wire/tool-calls.js";

function chatDelta(value: unknown): unknown {
  return value;
}

function expectWireError(run: () => unknown, code = "invalid_tool_call"): void {
  assert.throws(
    run,
    (error: unknown) => error instanceof ToolCallWireError && error.code === code,
  );
}

describe("ToolCallAssembler", () => {
  it("assembles chat calls split across index-based deltas", () => {
    const assembler = new ToolCallAssembler();
    assembler.ingestChat(chatDelta([{ index: 0, id: "call_1", type: "function" }]));
    assembler.ingestChat(chatDelta([{ index: 0, function: { name: "lookup", arguments: "{\"x\":" } }]));
    assembler.ingestChat(chatDelta([{ index: 0, function: { arguments: "1}" } }]));
    assert.deepEqual(assembler.flush(), [
      { type: "tool_call_start", id: "call_1", name: "lookup" },
      { type: "tool_call_delta", id: "call_1", arguments: "{\"x\":1}" },
      { type: "tool_call_end", id: "call_1" },
    ]);
  });

  it("aliases an id-only start to a later index", () => {
    const assembler = new ToolCallAssembler();
    assembler.ingestChat([{ id: "call_1", function: { name: "lookup", arguments: "" } }]);
    assembler.ingestChat([{ index: 3, id: "call_1", function: { arguments: "{}" } }]);
    assert.equal(assembler.pendingCount, 1);
    assert.equal(assembler.flush()[0]?.type, "tool_call_start");
  });

  it("allows continuation padding only after a string was observed", () => {
    const valid = new ToolCallAssembler();
    valid.ingestChat([{ index: 0, id: "call", function: { name: "tool", arguments: "{}" } }]);
    valid.ingestChat([{ index: 0, id: null, function: { name: 4, arguments: null } }]);
    assert.equal(valid.flush().length, 3);

    const invalid = [
      [{ index: 0, id: null, function: { name: "tool", arguments: "{}" } }],
      [{ index: 0, id: "call", function: { name: null, arguments: "{}" } }],
      [{ index: 0, id: "call", function: { name: "tool", arguments: null } }],
    ];
    for (const raw of invalid) {
      expectWireError(() => new ToolCallAssembler().ingestChat(raw));
    }
  });

  it("fails closed for malformed chat wire shapes", () => {
    const invalid: unknown[] = [
      {},
      [null],
      [{ index: -1 }],
      [{ index: 0.5 }],
      [{ index: Number.MAX_SAFE_INTEGER + 1 }],
      [{ index: 0, function: "bad" }],
      [{ index: 0, id: 1 }],
      [{ index: 0, function: { name: 1 } }],
      [{ index: 0, function: { arguments: 1 } }],
    ];
    for (const raw of invalid) {
      expectWireError(() => new ToolCallAssembler().ingestChat(raw));
    }

    const blank = new ToolCallAssembler();
    blank.ingestChat([{ index: 0, id: "call", function: { name: " ", arguments: "{}" } }]);
    expectWireError(() => blank.flush());
  });

  it("rejects id/name/index conflicts", () => {
    const idConflict = new ToolCallAssembler();
    idConflict.ingestChat([{ index: 0, id: "a", function: { name: "one", arguments: "{}" } }]);
    expectWireError(() => idConflict.ingestChat([{ index: 0, id: "b" }]));

    const nameConflict = new ToolCallAssembler();
    nameConflict.ingestChat([{ index: 0, id: "a", function: { name: "one", arguments: "{}" } }]);
    expectWireError(() => nameConflict.ingestChat([{ index: 0, function: { name: "two" } }]));

    const indexConflict = new ToolCallAssembler();
    indexConflict.ingestChat([{ index: 0, id: "a", function: { name: "one", arguments: "{}" } }]);
    expectWireError(() => indexConflict.ingestChat([{ index: 1, id: "a" }]));
  });

  it("validates every call before exposing any tool event", () => {
    for (const argumentsText of ["[1]", "{\"x\":"]) {
      const assembler = new ToolCallAssembler();
      assembler.ingestChat([{ index: 0, id: "good", function: { name: "ok", arguments: "{}" } }]);
      assembler.ingestChat([{ index: 1, id: "bad", function: { name: "bad", arguments: argumentsText } }]);
      let events: unknown[] = [];
      expectWireError(() => {
        events = assembler.flush();
      });
      assert.deepEqual(events, []);
    }
  });

  it("does not grow the buffer when the byte limit is exceeded", () => {
    const assembler = new ToolCallAssembler({ maxBytes: 2 });
    expectWireError(
      () => assembler.ingestChat([{ index: 0, id: "a", function: { name: "x", arguments: "한" } }]),
      "tool_call_buffer_limit",
    );
    assert.equal(assembler.pendingCount, 1);
    assembler.ingestChat([{ index: 0, function: { arguments: "{}" } }]);
    assert.equal(assembler.flush().length, 3);
  });

  it("assembles and validates Responses function-call snapshots", () => {
    const assembler = new ToolCallAssembler();
    assembler.ingestResponsesItem({ type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "" });
    assembler.ingestResponsesDelta({ type: "response.function_call_arguments.delta", item_id: "item_1", delta: "{\"x\":1}" });
    assembler.completeResponsesItem({ type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "{\"x\":1}" });
    assert.deepEqual(assembler.flush(), [
      { type: "tool_call_start", id: "call_1", name: "lookup", itemId: "item_1" },
      { type: "tool_call_delta", id: "call_1", arguments: "{\"x\":1}" },
      { type: "tool_call_end", id: "call_1" },
    ]);

    const mismatch = new ToolCallAssembler();
    mismatch.ingestResponsesItem({ type: "function_call", id: "item_2", call_id: "call_2", name: "lookup", arguments: "" });
    mismatch.ingestResponsesDelta({ item_id: "item_2", delta: "{\"x\":" });
    expectWireError(() => mismatch.completeResponsesItem({ type: "function_call", id: "item_2", call_id: "call_2", name: "lookup", arguments: "{\"y\":1}" }));
  });
});
