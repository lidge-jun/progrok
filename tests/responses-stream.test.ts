import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AdapterEvent } from "../src/core/events.js";
import { reduceResponsesStream } from "../src/wire/responses-stream.js";

const encoder = new TextEncoder();

async function* chunks(...values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield encoder.encode(value);
}

async function collect(source: AsyncIterable<AdapterEvent>): Promise<AdapterEvent[]> {
  const events: AdapterEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}

function frame(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

describe("reduceResponsesStream", () => {
  it("reduces output item lifecycle to canonical text and done", async () => {
    const events = await collect(reduceResponsesStream(chunks(
      frame({ type: "response.output_item.added", output_index: 0, item: { id: "item_1", type: "message" } }),
      frame({ type: "response.output_text.delta", item_id: "item_1", delta: "hello" }),
      frame({ type: "response.output_item.done", output_index: 0, item: { id: "item_1", type: "message" } }),
      frame({ type: "response.completed", response: { id: "resp_1", output: [{ id: "item_1", type: "message" }] } }),
    )));
    assert.deepEqual(events, [
      { type: "text_delta", text: "hello", itemId: "item_1" },
      { type: "done", protocol: "responses", responseId: "resp_1" },
    ]);
  });

  it("emits a completed function call exactly once at terminal", async () => {
    const events = await collect(reduceResponsesStream(chunks(
      frame({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "" } }),
      frame({ type: "response.function_call_arguments.delta", output_index: 0, delta: "{\"x\":1}" }),
      frame({ type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "{\"x\":1}" } }),
      frame({ type: "response.completed", response: { id: "resp_1", output: [{ type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "{\"x\":1}" }] } }),
    )));
    assert.deepEqual(events.map((event) => event.type), [
      "heartbeat", "tool_call_start", "tool_call_delta", "tool_call_end", "done",
    ]);
  });

  it("fails when delta and done or completed snapshots disagree", async () => {
    for (const terminalFrames of [
      [frame({ type: "response.output_item.done", item: { type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "{\"y\":1}" } })],
      [
        frame({ type: "response.output_item.done", item: { type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "{\"x\":1}" } }),
        frame({ type: "response.completed", response: { output: [{ type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "{\"y\":1}" }] } }),
      ],
    ]) {
      const events = await collect(reduceResponsesStream(chunks(
        frame({ type: "response.output_item.added", item: { type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "" } }),
        frame({ type: "response.function_call_arguments.delta", item_id: "item_1", delta: "{\"x\":1}" }),
        ...terminalFrames,
      )));
      assert.equal(events.at(-1)?.type, "error");
      assert.equal(events.some((event) => event.type.startsWith("tool_call_")), false);
    }
  });

  it("maps incomplete, failed, and error to the first terminal", async () => {
    const cases = [
      {
        wire: { type: "response.incomplete", response: { id: "resp", incomplete_details: { reason: "max_output_tokens" } } },
        expected: "incomplete",
      },
      { wire: { type: "response.failed", response: { error: { message: "failed" } } }, expected: "error" },
      { wire: { type: "error", error: { message: "failed" } }, expected: "error" },
    ];
    for (const { wire, expected } of cases) {
      const events = await collect(reduceResponsesStream(chunks(frame(wire), frame({ type: "response.completed", response: {} }))));
      assert.deepEqual(events.map((event) => event.type), [expected]);
    }
  });

  it("requires a whole-response terminal after output_item.done", async () => {
    const events = await collect(reduceResponsesStream(chunks(
      frame({ type: "response.output_item.added", item: { id: "item", type: "message" } }),
      frame({ type: "response.output_item.done", item: { id: "item", type: "message" } }),
    )));
    assert.equal(events.at(-1)?.type, "error");
    assert.equal(events.at(-1)?.type === "error" && events.at(-1)?.code, "stream_truncated");
  });

  it("fails closed without exposing a pending tool call at strict EOF", async () => {
    const events = await collect(reduceResponsesStream(chunks(
      frame({ type: "response.output_item.added", item: { type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "" } }),
      frame({ type: "response.function_call_arguments.delta", item_id: "item_1", delta: "{\"q\":\"secret\"}" }),
    )));
    assert.deepEqual(events.map((event) => event.type), ["heartbeat", "error"]);
    assert.equal(events.at(-1)?.type === "error" && events.at(-1)?.code, "stream_truncated");
    assert.equal(events.some((event) => event.type.startsWith("tool_call_")), false);
  });

  it("rejects completed snapshots that do not match an open item", async () => {
    const events = await collect(reduceResponsesStream(chunks(
      frame({ type: "response.output_item.added", item: { id: "item", type: "message" } }),
      frame({ type: "response.completed", response: { output: [{ id: "item", type: "function_call", call_id: "call", name: "x", arguments: "{}" }] } }),
    )));
    assert.equal(events.at(-1)?.type, "error");
    assert.equal(events.at(-1)?.type === "error" && events.at(-1)?.code, "invalid_wire_shape");
  });

  it("stops after completed and ignores a later failure", async () => {
    let reads = 0;
    async function* source(): AsyncIterable<Uint8Array> {
      reads += 1;
      yield encoder.encode(frame({ type: "response.completed", response: { id: "resp" } }));
      reads += 1;
      yield encoder.encode(frame({ type: "response.failed", response: { error: { message: "late" } } }));
    }
    assert.deepEqual(await collect(reduceResponsesStream(source())), [
      { type: "done", protocol: "responses", responseId: "resp" },
    ]);
    assert.equal(reads, 1);
  });
});
