import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AdapterEvent } from "../src/core/events.js";
import { reduceChatStream } from "../src/wire/chat-stream.js";

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

describe("reduceChatStream", () => {
  it("stops at finish_reason without reading a later DONE frame", async () => {
    let reads = 0;
    async function* source(): AsyncIterable<Uint8Array> {
      reads += 1;
      yield encoder.encode(frame({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }));
      reads += 1;
      yield encoder.encode("data: [DONE]\n\n");
    }
    assert.deepEqual(await collect(reduceChatStream(source())), [
      { type: "text_delta", text: "ok" },
      { type: "done", protocol: "chat", finishReason: "stop" },
    ]);
    assert.equal(reads, 1);
  });

  it("treats the first DONE marker as authoritative", async () => {
    const events = await collect(
      reduceChatStream(chunks("data: [DONE]\n\n", frame({ error: { message: "late" } }))),
    );
    assert.deepEqual(events, [{ type: "done", protocol: "chat" }]);
  });

  it("buffers tool calls until terminal validation succeeds", async () => {
    const events = await collect(reduceChatStream(chunks(
      frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"x\":" } }] } }] }),
      frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] }, finish_reason: "tool_calls" }] }),
    )));
    assert.deepEqual(events, [
      { type: "heartbeat" },
      { type: "heartbeat" },
      { type: "tool_call_start", id: "call_1", name: "lookup" },
      { type: "tool_call_delta", id: "call_1", arguments: "{\"x\":1}" },
      { type: "tool_call_end", id: "call_1" },
      { type: "done", protocol: "chat", finishReason: "tool_calls" },
    ]);
  });

  it("maps malformed JSON, choices, and tool calls to one terminal error", async () => {
    const inputs = [
      "data: {bad\n\n",
      frame({ choices: {} }),
      frame({ choices: [{ delta: { tool_calls: {} } }] }),
    ];
    for (const input of inputs) {
      const events = await collect(reduceChatStream(chunks(input, "data: [DONE]\n\n")));
      assert.equal(events.filter((event) => event.type === "error").length, 1);
      assert.equal(events.some((event) => event.type === "done"), false);
    }
  });

  it("reports strict EOF after text without a terminal frame", async () => {
    assert.deepEqual(
      await collect(reduceChatStream(chunks(frame({ choices: [{ delta: { content: "partial" } }] })))),
      [
        { type: "text_delta", text: "partial" },
        { type: "error", code: "stream_truncated", message: "Chat SSE ended without finish_reason or [DONE]", retryable: false },
      ],
    );
  });

  it("does not expose pending tools on truncated EOF", async () => {
    const events = await collect(reduceChatStream(chunks(frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call", function: { name: "x", arguments: "{}" } }] } }] }))));
    assert.deepEqual(events.map((event) => event.type), ["heartbeat", "error"]);
    assert.equal(events.some((event) => event.type.startsWith("tool_call_")), false);
  });
});
