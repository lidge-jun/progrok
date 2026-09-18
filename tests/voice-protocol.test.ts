import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REALTIME_CLIENT_EVENT_TYPES, REALTIME_SERVER_EVENT_TYPES, STT_EVENTS,
  STT_SERVER_EVENT_TYPES, TTS_SERVER_EVENT_TYPES, VoiceProtocolError,
  ephemeralProtocols, parseRealtimeServerEvent, parseSttServerEvent,
  parseTtsServerEvent, type EphemeralClientSecret,
} from "../src/voice/protocol.js";

describe("Voice protocol", () => {
  it("exports the browser-safe event names", () => {
    assert.deepEqual(STT_SERVER_EVENT_TYPES, ["transcript.created", "transcript.partial", "transcript.done", "error"]);
    assert.deepEqual(TTS_SERVER_EVENT_TYPES, ["audio.delta", "audio.done", "error"]);
    assert.equal(REALTIME_CLIENT_EVENT_TYPES[0], "session.update");
    assert.equal(REALTIME_SERVER_EVENT_TYPES.length, 40);
    assert.equal(STT_EVENTS.done, "transcript.done");
  });

  it("builds only the xAI ephemeral subprotocol and rejects unsafe secrets", () => {
    assert.deepEqual(ephemeralProtocols("one-use"), ["xai-client-secret.one-use"]);
    for (const secret of ["", "a,b", "a\rb", "a\nb"]) assert.throws(() => ephemeralProtocols(secret), RangeError);
  });

  it("decodes STT and TTS events from unknown wire data", () => {
    assert.deepEqual(parseSttServerEvent(JSON.stringify({ type: "transcript.done", text: "hi", words: [{ text: "hi", start: 0, end: 1, speaker: 2 }], duration: 1 })), {
      type: "transcript.done", text: "hi", words: [{ text: "hi", start: 0, end: 1, speaker: 2 }], duration: 1,
    });
    assert.deepEqual(parseTtsServerEvent(JSON.stringify({ type: "audio.delta", delta: "AA==", audio_timestamps: { graph_chars: ["a"], graph_times: [[0, 1]] } })), {
      type: "audio.delta", delta: "AA==", audio_timestamps: { graph_chars: ["a"], graph_times: [[0, 1]] },
    });
    for (const parse of [parseSttServerEvent, parseTtsServerEvent]) {
      assert.throws(() => parse("{"), (error) => error instanceof VoiceProtocolError && error.code === "invalid_event");
    }
  });

  it("decodes every realtime server discriminant", () => {
    const common = { response_id: "r", item_id: "i", output_index: 0, content_index: 0, call_id: "c" };
    const fixtures: Record<string, Record<string, unknown>> = {
      "session.created": { session: {} }, "session.updated": { session: {} },
      "conversation.created": { conversation: { id: "c" } },
      "conversation.item.added": { item: {} }, "conversation.item.created": { item: {} },
      "conversation.item.deleted": { item_id: "i" },
      "conversation.item.truncated": { item_id: "i", content_index: 0, audio_end_ms: 1 },
      "conversation.item.input_audio_transcription.updated": { item_id: "i", transcript: "t" },
      "conversation.item.input_audio_transcription.completed": { item_id: "i", transcript: "t" },
      "input_audio_buffer.speech_started": { item_id: "i", audio_start_ms: 0 },
      "input_audio_buffer.speech_stopped": { item_id: "i", audio_end_ms: 1 },
      "input_audio_buffer.committed": { item_id: "i" }, "input_audio_buffer.cleared": {},
      "input_audio_buffer.timeout_triggered": { item_id: "i", audio_start_ms: 0, audio_end_ms: 1 },
      "input_audio_buffer.dtmf_event_received": { event: "#", received_at: 1 },
      "response.created": { response: {} }, "response.done": { response: {} },
      "response.output_item.added": { response_id: "r", output_index: 0, item: {} },
      "response.output_item.done": { response_id: "r", output_index: 0, item: {} },
      "response.content_part.added": { ...common, part: {} }, "response.content_part.done": { ...common, part: {} },
      "response.output_audio.delta": { ...common, delta: "AA==" }, "response.output_audio.done": common,
      "response.output_audio_transcript.delta": { ...common, delta: "t" },
      "response.output_audio_transcript.done": { ...common, transcript: "t" },
      "response.text.delta": { response_id: "r", item_id: "i", delta: "t" },
      "response.output_text.delta": { response_id: "r", item_id: "i", delta: "t" },
      "response.function_call_arguments.delta": { response_id: "r", item_id: "i", output_index: 0, call_id: "c", delta: "{}" },
      "response.function_call_arguments.done": { response_id: "r", item_id: "i", output_index: 0, call_id: "c", name: "f", arguments: "{}" },
      "mcp_list_tools.in_progress": { item_id: "i" }, "mcp_list_tools.completed": { item_id: "i" },
      "mcp_list_tools.failed": { item_id: "i", error: {} },
      "response.mcp_call_arguments.delta": { response_id: "r", item_id: "i", call_id: "c", delta: "{}" },
      "response.mcp_call_arguments.done": { response_id: "r", item_id: "i", call_id: "c", name: "f", arguments: "{}" },
      "response.mcp_call.in_progress": { item_id: "i", output_index: 0 },
      "response.mcp_call.completed": { item_id: "i", output_index: 0 },
      "response.mcp_call.failed": { item_id: "i", output_index: 0, error: {} },
      "response.cancelled": {}, "ping": { timestamp: 1 }, "error": { error: { message: "failed" } },
    };
    assert.deepEqual(Object.keys(fixtures), [...REALTIME_SERVER_EVENT_TYPES]);
    for (const type of REALTIME_SERVER_EVENT_TYPES) assert.equal(parseRealtimeServerEvent(JSON.stringify({ type, ...fixtures[type] })).type, type);
    assert.throws(() => parseRealtimeServerEvent('{"type":"response.done"}'), VoiceProtocolError);
  });

  it("keeps the canonical client secret response shape", () => {
    const secret: EphemeralClientSecret = { value: "test-only", expires_at: 123 };
    assert.equal(secret.expires_at, 123);
  });
});
