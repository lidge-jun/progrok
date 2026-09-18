import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseRealtimeServerEvent,
  safeEventLabel,
  tryParseRealtimeServerEvent,
  tryParseSttServerEvent,
} from "../src/voice/protocol.js";

describe("tolerant voice event parsing", () => {
  it("drops an event type this build does not model instead of throwing", () => {
    const frame = JSON.stringify({ type: "response.output_audio_timing.delta", delta: 12 });
    assert.throws(() => parseRealtimeServerEvent(frame));
    assert.equal(tryParseRealtimeServerEvent(frame), null);
  });

  it("drops a known event whose fields do not match the contract", () => {
    const frame = JSON.stringify({ type: "response.created", response: "not-an-object" });
    assert.throws(() => parseRealtimeServerEvent(frame));
    assert.equal(tryParseRealtimeServerEvent(frame), null);
  });

  it("drops a frame that is not JSON at all", () => {
    assert.equal(tryParseRealtimeServerEvent("<html>gateway</html>"), null);
    assert.equal(tryParseSttServerEvent("{"), null);
  });

  it("still parses a well-formed server error so the session can fail", () => {
    const frame = JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: "session expired" },
    });
    const parsed = tryParseRealtimeServerEvent(frame);
    assert.equal(parsed?.type, "error");
    assert.equal(
      parsed?.type === "error" ? parsed.error.message : undefined,
      "session expired",
    );
  });

  it("treats a malformed error frame as an unsupported frame, not a failure", () => {
    // Deliberate boundary: a broken frame must not end a live call. A genuinely
    // fatal condition still arrives as a socket close.
    const frame = JSON.stringify({ type: "error", error: "missing message" });
    assert.equal(tryParseRealtimeServerEvent(frame), null);
  });

  it("still parses the events the client acts on", () => {
    const started = JSON.stringify({
      type: "input_audio_buffer.speech_started",
      item_id: "item_1",
      audio_start_ms: 120,
    });
    assert.equal(tryParseRealtimeServerEvent(started)?.type, "input_audio_buffer.speech_started");
    const partial = JSON.stringify({
      type: "transcript.partial",
      text: "hello",
      words: [],
      duration: 0.8,
      start: 0,
      is_final: false,
      speech_final: false,
    });
    assert.equal(tryParseSttServerEvent(partial)?.type, "transcript.partial");
  });
});

describe("event log labels", () => {
  it("keeps an identifier-safe slice of the wire type", () => {
    assert.equal(
      safeEventLabel(JSON.stringify({ type: "response.output_audio.delta" })),
      "unsupported:response.output_audio.delta",
    );
  });

  it("strips characters that do not belong in an identifier", () => {
    assert.equal(
      safeEventLabel(JSON.stringify({ type: "evil<script>alert(1)</script>" })),
      "unsupported:evilscriptalert1script",
    );
  });

  it("caps a long type so the log cannot be flooded", () => {
    const label = safeEventLabel(JSON.stringify({ type: "a".repeat(400) }));
    assert.equal(label, `unsupported:${"a".repeat(48)}`);
  });

  it("falls back to a fixed label for junk input", () => {
    assert.equal(safeEventLabel("not json"), "unsupported");
    assert.equal(safeEventLabel(JSON.stringify({ type: 7 })), "unsupported");
    assert.equal(safeEventLabel(JSON.stringify({ type: "!!!" })), "unsupported");
    assert.equal(safeEventLabel(JSON.stringify(["array"])), "unsupported");
  });
});
