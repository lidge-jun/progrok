import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { XaiFetchInput, XaiTransport } from "../src/transport/fetch.js";
import { createTtsClient } from "../src/voice/tts.js";
import { buildSttForm, createSttClient } from "../src/voice/stt.js";
import { createCustomVoicesClient } from "../src/voice/custom-voices.js";
import { VoiceHttpError } from "../src/voice/http.js";

function transport(handler: (input: XaiFetchInput) => Response | Promise<Response>): XaiTransport {
  return { fetch: handler };
}
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const voice = { voice_id: "abcd1234", name: null, description: null, gender: null, accent: null, age: null, language: null, use_case: null, tone: null, created_at: "2026-09-18T00:00:00Z" };

describe("Voice REST", () => {
  it("serializes object output_format and returns raw or JSON TTS results", async () => {
    const client = createTtsClient({ transport: transport(async (input) => {
      const body = JSON.parse(String(input.body)) as Record<string, unknown>;
      assert.deepEqual(body.output_format, { codec: "mp3", sample_rate: 24000, bit_rate: 128000 });
      return new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "audio/mpeg" } });
    }) });
    const result = await client.synthesize({ text: "hello", language: "auto", output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 128000 } });
    assert.equal(result.kind, "audio");
    if (result.kind === "audio") { assert.deepEqual([...result.bytes], [1, 2]); assert.equal(result.contentType, "audio/mpeg"); }

    const timestamped = await createTtsClient({ transport: transport(() => json({ audio: "AA==", content_type: "audio/mpeg", duration: 1, audio_timestamps: { graph_chars: ["a"], graph_times: [{ start: 0, end: 1 }] } })) }).synthesize({ text: "a", language: "en", with_timestamps: true });
    assert.deepEqual(timestamped, { kind: "json", body: { audio: "AA==", content_type: "audio/mpeg", duration: 1, audio_timestamps: { graph_chars: ["a"], graph_times: [{ start: 0, end: 1 }] } } });
  });

  it("validates TTS speed, bitrate, and pronunciation replacements", async () => {
    const client = createTtsClient({ transport: transport(() => { throw new Error("unreachable"); }) });
    await assert.rejects(client.synthesize({ text: "x", language: "auto", speed: 1.6 }), RangeError);
    await assert.rejects(client.synthesize({ text: "x", language: "auto", output_format: { codec: "wav", bit_rate: 32000 } }), RangeError);
    await assert.rejects(client.synthesize({ text: "x", language: "auto", replace: { "bad-key": "x" } }), RangeError);
  });

  it("puts STT file last on the serialized wire and sends URL input as multipart", async () => {
    const form = buildSttForm({ file: new Blob(["audio"]), filename: "a.wav", language: "en", keyterm: ["one", "two"], diarize: true });
    assert.equal([...form.keys()].at(-1), "file");
    assert.deepEqual(form.getAll("keyterm"), ["one", "two"]);
    const wireRequest = new Request("http://voice.invalid/v1/stt", {
      method: "POST",
      body: form,
    });
    assert.match(
      wireRequest.headers.get("content-type") ?? "",
      /^multipart\/form-data; boundary=/,
    );
    const multipart = Buffer.from(await wireRequest.arrayBuffer()).toString("utf8");
    const filePosition = multipart.indexOf('name="file"; filename="a.wav"');
    assert(filePosition > 0);
    for (const field of ["language", "keyterm", "diarize"]) {
      const metadataPosition = multipart.lastIndexOf(`name="${field}"`);
      assert(metadataPosition >= 0, field);
      assert(metadataPosition < filePosition, field);
    }
    const result = await createSttClient({ transport: transport((input) => {
      assert(input.body instanceof FormData);
      assert.equal(input.body.get("url"), "https://example.com/a.wav");
      assert.equal(input.body.has("file"), false);
      assert.equal(input.headers.has("content-type"), false);
      return json({ text: "hello", language: "en", duration: 1, words: [{ text: "hello", start: 0, end: 1, speaker: 1 }], channels: [{ index: 0, text: "hello" }] });
    }) }).transcribe({ url: "https://example.com/a.wav" });
    assert.equal(result.words?.[0]?.speaker, 1);
    assert.equal(result.channels?.[0]?.index, 0);
  });

  it("validates raw STT and option ranges", () => {
    assert.throws(() => buildSttForm({ file: new Blob(["x"]), filename: "x.pcm", audio_format: "pcm" }), /sample_rate/);
    assert.throws(() => buildSttForm({ url: "ftp://example.com/a", vad_threshold: 0.5 }), /http or https/);
    assert.throws(() => buildSttForm({ url: "https://example.com/a", multichannel: true, channels: 1 }), /2..8/);
    assert.throws(() => buildSttForm({ url: "https://example.com/a", vad_threshold: 2 }), /0..1/);
  });

  it("covers custom voice CRUD and audio", async () => {
    const seen: string[] = [];
    const client = createCustomVoicesClient({ transport: transport((input) => {
      seen.push(`${input.method} ${input.pathWithQuery}`);
      if (input.pathWithQuery.endsWith("/audio")) return new Response(new Uint8Array([9]), { headers: { "Content-Type": "audio/wav" } });
      if (input.method === "DELETE") return json({ deleted: true });
      if (input.method === "GET" && input.pathWithQuery.includes("?")) return json({ voices: [voice], pagination_token: null });
      return json(voice, input.method === "POST" ? 201 : 200);
    }) });
    assert.equal((await client.create({ file: new Blob(["x"]), filename: "x.wav", name: "Voice" })).voice_id, "abcd1234");
    assert.equal((await client.list({ limit: 1 })).voices.length, 1);
    assert.equal((await client.get("abcd1234")).voice_id, "abcd1234");
    assert.equal((await client.update("abcd1234", { name: null })).name, null);
    assert.deepEqual(await client.delete("abcd1234"), { deleted: true });
    assert.deepEqual([...(await client.getAudio("abcd1234")).bytes], [9]);
    assert.equal(seen.length, 6);
    assert.throws(() => client.get("BAD"), RangeError);
    assert.throws(() => client.update("abcd1234", { name: "" }), RangeError);
  });

  it("maps Voice HTTP status without exposing the response body", async () => {
    const codes = new Map([[401, "voice_auth_required"], [403, "voice_forbidden"], [404, "voice_not_found"], [422, "voice_validation_error"], [429, "voice_rate_limited"]]);
    for (const [status, code] of codes) {
      const promise = createSttClient({ transport: transport(() => new Response("secret upstream body", { status })) }).transcribe({ url: "https://example.com/a" });
      await assert.rejects(promise, (error) => error instanceof VoiceHttpError && error.code === code && error.status === status && !error.message.includes("secret"));
    }
  });
});
