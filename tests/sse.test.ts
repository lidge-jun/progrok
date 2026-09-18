import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeServerSentEvents,
  SseDecodeError,
} from "../src/wire/sse.js";

const encoder = new TextEncoder();

async function* byteChunks(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

describe("decodeServerSentEvents", () => {
  it("preserves a multibyte character at every possible byte split", async () => {
    const bytes = encoder.encode("data: A한🙂Z\n\n");
    for (let split = 1; split < bytes.length; split += 1) {
      const events = await collect(
        decodeServerSentEvents(byteChunks(bytes.slice(0, split), bytes.slice(split))),
      );
      assert.deepEqual(events, [{ data: "A한🙂Z" }], `split=${split}`);
    }
  });

  it("rejects malformed UTF-8 and an incomplete final sequence", async () => {
    for (const bytes of [
      Uint8Array.from([0x64, 0x61, 0x74, 0x61, 0x3a, 0x20, 0xff]),
      Uint8Array.from([0x64, 0x61, 0x74, 0x61, 0x3a, 0x20, 0xe2, 0x82]),
    ]) {
      await assert.rejects(
        () => collect(decodeServerSentEvents(byteChunks(bytes))),
        (error: unknown) => error instanceof SseDecodeError && error.code === "invalid_utf8",
      );
    }
  });

  it("handles LF, CRLF, comments, multiline data, metadata, and final EOF dispatch", async () => {
    const input = [
      ": comment\r\n",
      "event: update\r\n",
      "id: abc\r\n",
      "retry: 25\r\n",
      "data: one\r\n",
      "data: two\r\n",
      "\r\n",
      "data: final",
    ].join("");
    assert.deepEqual(
      await collect(decodeServerSentEvents(byteChunks(encoder.encode(input)))),
      [
        { event: "update", id: "abc", retry: 25, data: "one\ntwo" },
        { id: "abc", data: "final" },
      ],
    );
  });

  it("enforces the combined residual and multiline data byte budget", async () => {
    const cases = [
      { input: "data: 12345", limit: 10 },
      { input: "data: 12\ndata: 34\n", limit: 4 },
    ];
    for (const { input, limit } of cases) {
      await assert.rejects(
        () => collect(decodeServerSentEvents(byteChunks(encoder.encode(input)), { maxBufferedBytes: limit })),
        (error: unknown) => error instanceof SseDecodeError && error.code === "sse_buffer_limit",
      );
    }
  });

  it("releases the event budget after dispatch", async () => {
    const events = await collect(
      decodeServerSentEvents(
        byteChunks(encoder.encode("data: 1234\n\ndata: 5678\n\n")),
        { maxBufferedBytes: 4 },
      ),
    );
    assert.deepEqual(events, [{ data: "1234" }, { data: "5678" }]);
  });

  it("includes retained event metadata in the byte budget", async () => {
    await assert.rejects(
      () => collect(
        decodeServerSentEvents(byteChunks(encoder.encode("event: 123\ndata: 12\n\n")), {
          maxBufferedBytes: 4,
        }),
      ),
      (error: unknown) => error instanceof SseDecodeError && error.code === "sse_buffer_limit",
    );
  });

  it("rejects non-positive or unbounded limits", async () => {
    for (const maxBufferedBytes of [0, -1, Number.POSITIVE_INFINITY]) {
      await assert.rejects(
        () => collect(decodeServerSentEvents(byteChunks(), { maxBufferedBytes })),
        RangeError,
      );
    }
  });
});
