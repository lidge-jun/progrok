import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import {
  VOICE_WS_MAX_QUEUE_BYTES,
  createSttSession,
  createTtsSession,
  openVoiceSocket,
} from "../src/voice/ws-client.js";
import {
  DEFAULT_REALTIME_MODEL,
  REALTIME_MODEL_ALIAS,
  createRealtimeClient,
  reduceRealtimeEvent,
} from "../src/voice/realtime.js";
import { VoiceProtocolError, type RealtimeNormalizedEvent } from "../src/voice/protocol.js";

const authDir = join(homedir(), ".progrok");
const authFile = join(authDir, "auth.json");
mkdirSync(authDir, { recursive: true });
writeFileSync(authFile, JSON.stringify({ accessToken: "oauth-test-token", expiresAt: Date.now() + 3_600_000 }));

after(() => rmSync(authFile, { force: true }));

async function startServer(): Promise<{ server: WebSocketServer; origin: string }> {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { server, origin: `ws://127.0.0.1:${port}` };
}

async function stopServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) client.terminate();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function messageJson(data: import("ws").RawData): Record<string, unknown> {
  return JSON.parse(Buffer.from(data as ArrayBuffer).toString("utf8")) as Record<string, unknown>;
}

function partial(text: string, speechFinal: boolean): string {
  return JSON.stringify({
    type: "transcript.partial", text, words: [], is_final: speechFinal,
    speech_final: speechFinal, start: 0, duration: 1,
  });
}

describe("Voice WebSocket", () => {
  it("uses OAuth bearer headers for server-side STT, TTS, and realtime", async () => {
    const { server, origin } = await startServer();
    const requests: Array<{ authorization?: string; marker?: string; url?: string }> = [];
    server.on("connection", (socket, request) => {
      requests.push({
        authorization: request.headers.authorization,
        marker: request.headers["x-xai-token-auth"] as string | undefined,
        url: request.url,
      });
      socket.send(JSON.stringify({ type: "transcript.created", id: "stt" }));
    });
    try {
      const stt = await createSttSession({}, { endpointOrigin: origin, clientVersion: "test" });
      const tts = await createTtsSession({ language: "en" }, { endpointOrigin: origin, clientVersion: "test" });
      const realtime = createRealtimeClient({ auth: { kind: "oauth" }, deps: { endpointOrigin: origin, clientVersion: "test" } });
      await realtime.ready();
      stt.close(); tts.close(); realtime.close();
      assert.equal(requests.length, 3);
      for (const request of requests) {
        assert.equal(request.authorization, "Bearer oauth-test-token");
        assert.equal(request.marker, "xai-grok-cli");
      }
      assert(requests.some((request) => request.url?.startsWith("/v1/stt")));
      assert(requests.some((request) => request.url?.startsWith("/v1/tts")));
      assert(requests.some((request) => request.url?.startsWith("/v1/realtime")));
    } finally { await stopServer(server); }
  });

  it("uses the one-use client secret only as a WebSocket subprotocol", async () => {
    const { server, origin } = await startServer();
    let handshake: { protocol?: string; authorization?: string; url?: string } = {};
    server.on("connection", (socket, request) => {
      handshake = {
        protocol: request.headers["sec-websocket-protocol"] as string | undefined,
        authorization: request.headers.authorization,
        url: request.url,
      };
      socket.close();
    });
    try {
      const socket = await openVoiceSocket("/v1/stt?language=en", { kind: "ephemeral", clientSecret: "one-use-secret" }, undefined, { endpointOrigin: origin });
      assert.equal(handshake.protocol, "xai-client-secret.one-use-secret");
      assert.equal(handshake.authorization, undefined);
      assert.equal(handshake.url, "/v1/stt?language=en");
      assert.equal(handshake.url?.includes("one-use-secret"), false);
      socket.close();
    } finally { await stopServer(server); }
  });

  it("refreshes and redials OAuth exactly once only for a pre-open 401", async () => {
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ noServer: true });
    const attempts: Array<string | undefined> = [];
    const originalFetch = globalThis.fetch;
    writeFileSync(authFile, JSON.stringify({
      accessToken: "stale-token", refreshToken: "refresh-token",
      expiresAt: Date.now() + 3_600_000, tokenEndpoint: "https://auth.x.ai/oauth2/token",
    }));
    let refreshes = 0;
    globalThis.fetch = async () => {
      refreshes += 1;
      return new Response(JSON.stringify({ access_token: "fresh-token", refresh_token: "fresh-refresh", expires_in: 3600 }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    };
    httpServer.on("upgrade", (request, socket, head) => {
      attempts.push(request.headers.authorization);
      if (request.headers.authorization === "Bearer stale-token") {
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      wsServer.handleUpgrade(request, socket, head, (client) => wsServer.emit("connection", client, request));
    });
    httpServer.listen(0, "127.0.0.1");
    await once(httpServer, "listening");
    const { port } = httpServer.address() as AddressInfo;
    try {
      const socket = await openVoiceSocket("/v1/realtime", { kind: "oauth" }, undefined, { endpointOrigin: `ws://127.0.0.1:${port}` });
      assert.deepEqual(attempts, ["Bearer stale-token", "Bearer fresh-token"]);
      assert.equal(refreshes, 1);
      socket.close();
    } finally {
      globalThis.fetch = originalFetch;
      writeFileSync(authFile, JSON.stringify({ accessToken: "oauth-test-token", expiresAt: Date.now() + 3_600_000 }));
      for (const client of wsServer.clients) client.terminate();
      await new Promise<void>((resolve) => wsServer.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it("rejects ephemeral auth for SIP call_id before dialing", () => {
    assert.throws(() => createRealtimeClient({ auth: { kind: "ephemeral", clientSecret: "one-use" }, callId: "call_1" }), /server-side bearer/);
  });

  it("streams STT binary/control frames and preserves speech_final across empty done and 1006", async () => {
    const { server, origin } = await startServer();
    const received: Array<{ binary: boolean; value: string | number[] }> = [];
    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "transcript.created", id: "stream_1" }));
      socket.on("message", (data, binary) => {
        received.push({ binary, value: binary ? [...Buffer.from(data as ArrayBuffer)] : Buffer.from(data as ArrayBuffer).toString("utf8") });
        if (!binary && messageJson(data).type === "audio.done") {
          socket.send(partial("authoritative partial", true));
          socket.send(JSON.stringify({ type: "transcript.done", text: "", words: [], duration: 1 }));
          socket.terminate();
        }
      });
    });
    try {
      const session = await createSttSession({}, { endpointOrigin: origin });
      assert.throws(() => session.sendAudio(new Uint8Array([0])), /transcript.created/);
      const events = session.events();
      assert.equal((await events.next()).value?.type, "transcript.created");
      session.sendAudio(new Uint8Array([1, 2, 3]));
      session.finalize(1);
      session.finish();
      const seen: unknown[] = [];
      for await (const event of events) seen.push(event);
      assert.deepEqual(received, [
        { binary: true, value: [1, 2, 3] },
        { binary: false, value: '{"type":"finalize","channel":1}' },
        { binary: false, value: '{"type":"audio.done"}' },
      ]);
      assert.deepEqual(seen.at(-1), {
        kind: "completed-with-transport-close", finalText: "authoritative partial",
        finalEvent: "transcript.partial:speech_final", closeCode: 1006,
      });
    } finally { await stopServer(server); }
  });

  it("fails STT when 1006 arrives before terminal evidence", async () => {
    const { server, origin } = await startServer();
    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "transcript.created", id: "stream_2" }));
      socket.on("message", (data, binary) => {
        if (!binary && messageJson(data).type === "audio.done") socket.terminate();
      });
    });
    try {
      const session = await createSttSession({}, { endpointOrigin: origin });
      const events = session.events();
      await events.next();
      session.finish();
      await assert.rejects(events.next(), (error) => error instanceof VoiceProtocolError && error.code === "abnormal_close");
    } finally { await stopServer(server); }
  });

  it("repeats STT keyterms and validates multichannel and VAD ranges before dialing", async () => {
    const { server, origin } = await startServer();
    let requestUrl = "";
    server.on("connection", (socket, request) => { requestUrl = request.url ?? ""; socket.close(); });
    try {
      const session = await createSttSession({ keyterm: ["one", "two"], multichannel: true, channels: 2, vad_threshold: 0.5 }, { endpointOrigin: origin });
      session.close();
      const url = new URL(requestUrl, origin);
      assert.deepEqual(url.searchParams.getAll("keyterm"), ["one", "two"]);
      assert.equal(url.searchParams.get("channels"), "2");
      await assert.rejects(createSttSession({ multichannel: true, channels: 1 }, { endpointOrigin: origin }), /2..8/);
      await assert.rejects(createSttSession({ vad_threshold: 2 }, { endpointOrigin: origin }), /0..1/);
    } finally { await stopServer(server); }
  });

  it("streams TTS text/audio and permits another utterance after audio.done", async () => {
    const { server, origin } = await startServer();
    const textEvents: Record<string, unknown>[] = [];
    server.on("connection", (socket) => socket.on("message", (data) => {
      const event = messageJson(data);
      textEvents.push(event);
      if (event.type === "text.done") {
        socket.send(JSON.stringify({ type: "audio.delta", delta: "AQI=" }));
        socket.send(JSON.stringify({ type: "audio.done", trace_id: `trace-${textEvents.length}` }));
      }
    }));
    try {
      const session = await createTtsSession({ language: "en", speed: 1 }, { endpointOrigin: origin });
      const events = session.events();
      session.sendText("first"); session.finishUtterance();
      assert.throws(() => session.sendText("too early"), /audio.done/);
      assert.equal((await events.next()).value?.type, "audio.delta");
      assert.equal((await events.next()).value?.type, "audio.done");
      session.sendText("second"); session.finishUtterance();
      await events.next(); await events.next();
      assert.deepEqual(textEvents.map((event) => event.type), ["text.delta", "text.done", "text.delta", "text.done"]);
      session.close();
    } finally { await stopServer(server); }
  });

  it("defaults realtime to the pinned model, sends controls, and pongs with the timestamp", async () => {
    const { server, origin } = await startServer();
    let requestUrl = "";
    const received: Array<Record<string, unknown> | "binary"> = [];
    let resolvePong!: () => void;
    const pong = new Promise<void>((resolve) => { resolvePong = resolve; });
    server.on("connection", (socket, request) => {
      requestUrl = request.url ?? "";
      socket.on("message", (data, binary) => {
        if (binary) { received.push("binary"); return; }
        const event = messageJson(data); received.push(event);
        if (event.type === "pong") resolvePong();
      });
      socket.send(JSON.stringify({ type: "ping", timestamp: 42 }));
      socket.send(new Uint8Array([7, 8]), { binary: true });
      for (const event of [
        { type: "session.updated", session: {} },
        { type: "input_audio_buffer.speech_started", item_id: "item_1", audio_start_ms: 0 },
        { type: "response.output_audio.delta", response_id: "response_1", item_id: "item_1", output_index: 0, content_index: 0, delta: "AA==" },
        { type: "response.function_call_arguments.done", response_id: "response_1", item_id: "item_1", output_index: 0, call_id: "call_1", name: "lookup", arguments: "{}" },
        { type: "mcp_list_tools.completed", item_id: "item_2" },
        { type: "input_audio_buffer.dtmf_event_received", event: "#", received_at: 1 },
        { type: "response.done", response: { id: "response_1" } },
      ]) socket.send(JSON.stringify(event));
    });
    try {
      const client = createRealtimeClient({ auth: { kind: "oauth" }, deps: { endpointOrigin: origin } });
      await client.ready();
      client.updateSession({ turn_detection: { type: "server_vad", threshold: 0.5 } });
      client.appendAudioBase64("AA=="); client.appendAudioBinary(new Uint8Array([1]));
      client.commitAudio(); client.clearAudio();
      client.createItem({ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] });
      client.deleteItem("item_1"); client.truncateItem("item_2", 0, 25);
      client.createResponse({ modalities: ["audio"] }); client.cancelResponse("response_1");
      const events = client.events();
      assert.equal((await events.next()).value?.type, "ping");
      const binary = (await events.next()).value;
      assert.equal(binary?.type, "response.output_audio.binary");
      if (binary?.type === "response.output_audio.binary") assert.deepEqual([...binary.bytes], [7, 8]);
      const serverTypes: string[] = [];
      for (let index = 0; index < 7; index += 1) {
        const event = (await events.next()).value;
        if (event) serverTypes.push(event.type);
      }
      assert.deepEqual(serverTypes, [
        "session.updated", "input_audio_buffer.speech_started", "response.output_audio.delta",
        "response.function_call_arguments.done", "mcp_list_tools.completed",
        "input_audio_buffer.dtmf_event_received", "response.done",
      ]);
      await pong;
      assert.equal(new URL(requestUrl, origin).searchParams.get("model"), DEFAULT_REALTIME_MODEL);
      assert.equal(REALTIME_MODEL_ALIAS, "grok-voice-latest");
      assert(received.some((event) => event === "binary"));
      assert(received.some((event) => event !== "binary" && event.type === "session.update"));
      assert(received.some((event) => event !== "binary" && event.type === "conversation.item.delete"));
      assert(received.some((event) => event !== "binary" && event.type === "conversation.item.truncate"));
      assert(received.some((event) => event !== "binary" && event.type === "response.create"));
      assert(received.some((event) => event !== "binary" && event.type === "response.cancel"));
      assert(received.some((event) => event !== "binary" && event.type === "pong" && event.ping_timestamp === 42));
      client.close();
    } finally { await stopServer(server); }
  });

  it("sends force_message without response.create and builds the resumption URL", async () => {
    const { server, origin } = await startServer();
    let requestUrl = "";
    let resolveMessage!: () => void;
    const message = new Promise<void>((resolve) => { resolveMessage = resolve; });
    const received: Record<string, unknown>[] = [];
    server.on("connection", (socket, request) => {
      requestUrl = request.url ?? "";
      socket.on("message", (data) => { received.push(messageJson(data)); resolveMessage(); });
    });
    try {
      const client = createRealtimeClient({
        auth: { kind: "ephemeral", clientSecret: "fresh-secret" }, model: REALTIME_MODEL_ALIAS,
        conversationId: "conversation_1", reasoningEffort: "high", deps: { endpointOrigin: origin },
      });
      await client.ready();
      client.forceMessage("speak now", false);
      await message;
      const url = new URL(requestUrl, origin);
      assert.equal(url.searchParams.get("model"), REALTIME_MODEL_ALIAS);
      assert.equal(url.searchParams.get("conversation_id"), "conversation_1");
      assert.equal(url.searchParams.get("reasoning.effort"), "high");
      assert.equal(received.length, 1);
      assert.deepEqual(received[0], { type: "conversation.item.create", item: { type: "force_message", role: "assistant", content: [{ type: "output_text", text: "speak now" }], interruptible: false } });
      client.close();
    } finally { await stopServer(server); }
  });

  it("maps realtime session, VAD, response, DTMF, replay, and error state", () => {
    let state = { phase: "connecting" as const, speechActive: false };
    const events: RealtimeNormalizedEvent[] = [
      { type: "conversation.created", conversation: { id: "conversation_1" } },
      { type: "conversation.item.created", item: { id: "item_1" } },
      { type: "conversation.item.added", item: { id: "item_2" } },
      { type: "input_audio_buffer.speech_started", item_id: "item_1", audio_start_ms: 0 },
      { type: "input_audio_buffer.speech_stopped", item_id: "item_1", audio_end_ms: 1 },
      { type: "input_audio_buffer.dtmf_event_received", event: "#", received_at: 1 },
      { type: "response.created", response: { id: "response_1" } },
      { type: "response.done", response: { id: "response_1" } },
      { type: "error", error: { code: "failed", message: "failed" } },
    ];
    for (const event of events) state = reduceRealtimeEvent(state, event);
    assert.deepEqual(state, { phase: "failed", speechActive: false, conversationId: "conversation_1", responseId: undefined, lastDtmf: "#", errorCode: "failed" });
  });

  it("rejects invalid realtime session ranges and mutually exclusive search filters", () => {
    const client = createRealtimeClient({ auth: { kind: "ephemeral", clientSecret: "unused" }, deps: { endpointOrigin: "ws://127.0.0.1:1" } });
    assert.throws(() => client.updateSession({ turn_detection: { type: "server_vad", threshold: 1 } }), /0.1..0.9/);
    assert.throws(() => client.updateSession({ audio: { output: { speed: 2 } } }), /0.7..1.5/);
    assert.throws(() => client.updateSession({ tools: [{ type: "web_search", allowed_domains: ["a"], excluded_domains: ["b"] }] }), /mutually exclusive/);
    client.close();
  });

  it("aborts without reconnecting and closes an overflowing receive queue with 1009", async () => {
    const { server, origin } = await startServer();
    let connections = 0;
    const closeCodes: number[] = [];
    let resolveAbortClose!: () => void;
    let resolveOverflowClose!: () => void;
    const abortClose = new Promise<void>((resolve) => { resolveAbortClose = resolve; });
    const overflowClose = new Promise<void>((resolve) => { resolveOverflowClose = resolve; });
    server.on("connection", (socket: WebSocket, request) => {
      connections += 1;
      socket.on("close", (code) => {
        closeCodes.push(code);
        if (code === 1000) resolveAbortClose();
        if (code === 1009) resolveOverflowClose();
      });
      if (request.url === "/overflow") {
        const chunk = Buffer.alloc(Math.floor(VOICE_WS_MAX_QUEUE_BYTES / 3) + 1);
        socket.send(chunk); socket.send(chunk); socket.send(chunk);
      }
    });
    try {
      const controller = new AbortController();
      await openVoiceSocket("/abort", { kind: "ephemeral", clientSecret: "abort-secret" }, controller.signal, { endpointOrigin: origin });
      controller.abort();
      await abortClose;

      await openVoiceSocket("/overflow", { kind: "ephemeral", clientSecret: "overflow-secret" }, undefined, { endpointOrigin: origin });
      await overflowClose;
      assert.equal(connections, 2);
      assert.deepEqual(closeCodes.sort((a, b) => a - b), [1000, 1009]);
    } finally { await stopServer(server); }
  });
});
