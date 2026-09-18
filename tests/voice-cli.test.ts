import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveTokens } from "../src/auth/token-store.js";
import { sttCommand } from "../src/commands/stt.js";
import { ttsCommand } from "../src/commands/tts.js";

const liveCalls: Array<{ method: string; args: unknown[] }> = [];
let liveServerEvents: unknown[] = [];
mock.module(new URL("../src/voice/realtime.ts", import.meta.url), {
  exports: {
    createRealtimeClient(options: unknown) {
      liveCalls.push({ method: "createRealtimeClient", args: [options] });
      const record = (method: string, ...args: unknown[]): void => {
        liveCalls.push({ method, args });
      };
      return {
        updateSession: (value: unknown) => record("updateSession", value),
        appendAudioBase64: (value: unknown) => record("appendAudioBase64", value),
        commitAudio: () => record("commitAudio"),
        clearAudio: () => record("clearAudio"),
        createItem: (...args: unknown[]) => record("createItem", ...args),
        deleteItem: (...args: unknown[]) => record("deleteItem", ...args),
        truncateItem: (...args: unknown[]) => record("truncateItem", ...args),
        createResponse: (...args: unknown[]) => record("createResponse", ...args),
        cancelResponse: (...args: unknown[]) => record("cancelResponse", ...args),
        async *events() {
          record("events");
          for (const event of liveServerEvents) yield event;
        },
        close: (...args: unknown[]) => record("close", ...args),
      };
    },
  },
});
const { liveCommand } = await import("../src/commands/live.js");

afterEach(() => {
  process.exitCode = undefined;
  liveCalls.length = 0;
  liveServerEvents = [];
});

describe("Voice CLI", () => {
  it("registers tts, stt, and live without inventing REST model options", () => {
    const tts = ttsCommand();
    const stt = sttCommand();
    const live = liveCommand();
    assert.equal(tts.name(), "tts");
    assert.equal(stt.name(), "stt");
    assert.equal(live.name(), "live");
    assert.equal(tts.options.some((option) => option.long === "--model"), false);
    assert.equal(stt.options.some((option) => option.long === "--model"), false);
    assert.equal(
      live.options.find((option) => option.long === "--model")?.defaultValue,
      "grok-voice-latest",
    );
  });

  it("maps TTS defaults through the real client and writes exact audio bytes", async () => {
    await saveTokens({ accessToken: "voice-cli-test", expiresAt: Date.now() + 10 * 60_000 });
    const directory = mkdtempSync(join(tmpdir(), "progrok-tts-cli-"));
    const outputPath = join(directory, "speech.mp3");
    let requestBody: Record<string, unknown> | undefined;
    const fetchMock = mock.method(globalThis, "fetch", async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(Uint8Array.from([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    });
    const logs: string[] = [];
    const logMock = mock.method(console, "log", (value?: unknown) => logs.push(String(value)));
    try {
      await ttsCommand().parseAsync([
        "node",
        "progrok",
        "hello",
        "--output",
        outputPath,
        "--json",
      ]);
      assert.deepEqual([...readFileSync(outputPath)], [1, 2, 3, 4]);
      assert.equal(requestBody?.voice_id, "eve");
      assert.equal(requestBody?.language, "auto");
      assert.deepEqual(requestBody?.output_format, { codec: "mp3" });
      assert.equal(logs.length, 1);
      assert.equal((JSON.parse(logs[0]) as { bytes: number }).bytes, 4);
    } finally {
      logMock.mock.restore();
      fetchMock.mock.restore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("maps STT flags and repeatable keyterms through the real client", async () => {
    await saveTokens({ accessToken: "voice-cli-test", expiresAt: Date.now() + 10 * 60_000 });
    const directory = mkdtempSync(join(tmpdir(), "progrok-stt-cli-"));
    const inputPath = join(directory, "meeting.wav");
    writeFileSync(inputPath, Uint8Array.from([8, 9]));
    let form: FormData | undefined;
    const fetchMock = mock.method(globalThis, "fetch", async (_input, init) => {
      form = init?.body as FormData;
      return Response.json({ text: "hello", language: "en", duration: 1 });
    });
    const logs: string[] = [];
    const logMock = mock.method(console, "log", (value?: unknown) => logs.push(String(value)));
    try {
      await sttCommand().parseAsync([
        "node",
        "progrok",
        inputPath,
        "--language",
        "en",
        "--diarize",
        "--multichannel",
        "--keyterm",
        "alpha",
        "--keyterm",
        "beta",
        "--json",
      ]);
      assert.equal(form?.get("language"), "en");
      assert.equal(form?.get("diarize"), "true");
      assert.equal(form?.get("multichannel"), "true");
      assert.deepEqual(form?.getAll("keyterm"), ["alpha", "beta"]);
      assert.equal((form?.get("file") as File).name, "meeting.wav");
      assert.equal(logs.length, 1);
      assert.equal((JSON.parse(logs[0]) as { text: string }).text, "hello");
    } finally {
      logMock.mock.restore();
      fetchMock.mock.restore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps live on the semantic realtime client surface", () => {
    const source = readFileSync("src/commands/live.ts", "utf8");
    for (const method of [
      "updateSession",
      "appendAudioBase64",
      "commitAudio",
      "clearAudio",
      "createItem",
      "deleteItem",
      "truncateItem",
      "createResponse",
      "cancelResponse",
    ]) {
      assert.match(source, new RegExp(`client\\.${method}\\(`));
    }
    assert.match(source, /session\.events\(\)/);
    assert.match(source, /session\?\.close\(\)/);
    assert.doesNotMatch(source, /\.send\(/);
  });

  it("keeps top-level live stdout reserved for NDJSON", () => {
    const testHome = mkdtempSync(join(tmpdir(), "progrok-live-help-"));
    try {
      const stdout = execFileSync(
        process.execPath,
        ["--import", "tsx", "src/index.ts", "live", "--help"],
        {
          cwd: process.cwd(),
          env: { ...process.env, HOME: testHome },
          encoding: "utf8",
        },
      );
      assert.match(stdout, /^Usage: progrok live/m);
      assert.doesNotMatch(stdout, /star the repo/i);
    } finally {
      rmSync(testHome, { recursive: true, force: true });
    }
  });

  it("dispatches NDJSON client events to semantic methods and emits server NDJSON", async () => {
    liveServerEvents = [{ type: "response.done", response: { id: "resp-1" } }];
    const events = [
      { type: "session.update", session: { instructions: "hello" } },
      { type: "input_audio_buffer.append", audio: "AQI=" },
      { type: "input_audio_buffer.commit" },
      { type: "input_audio_buffer.clear" },
      { type: "conversation.item.create", item: { type: "message", role: "user", content: [] }, previous_item_id: "prev" },
      { type: "conversation.item.delete", item_id: "item-1" },
      { type: "conversation.item.truncate", item_id: "item-2", content_index: 1, audio_end_ms: 250 },
      { type: "response.create", response: { modalities: ["text"] } },
      { type: "response.cancel", response_id: "resp-0" },
    ];
    const stdout: string[] = [];
    const writeMock = mock.method(process.stdout, "write", (value: string | Uint8Array) => {
      stdout.push(String(value));
      return true;
    });
    try {
      await liveCommand().parseAsync([
        "node",
        "progrok",
        "--no-stdin",
        "--once",
        ...events.flatMap((event) => ["--event", JSON.stringify(event)]),
      ]);
    } finally {
      writeMock.mock.restore();
    }

    assert.deepEqual(
      liveCalls.map((call) => call.method),
      [
        "createRealtimeClient",
        "updateSession",
        "appendAudioBase64",
        "commitAudio",
        "clearAudio",
        "createItem",
        "deleteItem",
        "truncateItem",
        "createResponse",
        "cancelResponse",
        "events",
        "close",
      ],
    );
    const options = liveCalls[0].args[0] as {
      auth: { kind: string };
      model: string;
      signal: AbortSignal;
    };
    assert.deepEqual(options.auth, { kind: "oauth" });
    assert.equal(options.model, "grok-voice-latest");
    assert(options.signal instanceof AbortSignal);
    assert.deepEqual(liveCalls.at(-1)?.args, []);
    assert.deepEqual(stdout, [JSON.stringify(liveServerEvents[0]) + "\n"]);
  });

  it("rejects malformed inline live events before iterating", async () => {
    const errors: string[] = [];
    const errorMock = mock.method(console, "error", (value?: unknown) => errors.push(String(value)));
    try {
      await liveCommand().parseAsync([
        "node",
        "progrok",
        "--no-stdin",
        "--event",
        "not-json",
      ]);
    } finally {
      errorMock.mock.restore();
    }
    assert.equal(process.exitCode, 1);
    assert.match(errors.join("\n"), /Unexpected token|JSON/);
    assert.deepEqual(liveCalls.map((call) => call.method), ["createRealtimeClient", "close"]);
  });

  for (const [label, event, pattern] of [
    ["non-object JSON", "[]", /JSON object/],
    ["missing event type", "{}", /event\.type is required/],
    ["unsupported event type", '{"type":"unknown"}', /unsupported live event type/],
  ] as const) {
    it(`rejects ${label}`, async () => {
      const errors: string[] = [];
      const errorMock = mock.method(console, "error", (value?: unknown) => errors.push(String(value)));
      try {
        await liveCommand().parseAsync([
          "node",
          "progrok",
          "--no-stdin",
          "--event",
          event,
        ]);
      } finally {
        errorMock.mock.restore();
      }
      assert.equal(process.exitCode, 1);
      assert.match(errors.join("\n"), pattern);
      assert.deepEqual(liveCalls.map((call) => call.method), ["createRealtimeClient", "close"]);
    });
  }
});
