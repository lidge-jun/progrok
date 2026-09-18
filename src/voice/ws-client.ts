import { randomUUID } from "node:crypto";
import WebSocket, { type ClientOptions, type RawData } from "ws";
import { getValidBearerSnapshot } from "../auth/token-manager.js";
import { buildUpstreamHeaders } from "../transport/headers.js";
import { readPackageVersion } from "../utils/version.js";
import {
  XAI_VOICE_WS_ORIGIN,
  VoiceProtocolError,
  ephemeralProtocols,
  parseSttServerEvent,
  parseTtsServerEvent,
  type SttClientControl,
  type SttServerEvent,
  type TtsClientEvent,
  type TtsServerEvent,
} from "./protocol.js";

export { ephemeralProtocols } from "./protocol.js";

export const VOICE_WS_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
export const VOICE_WS_MAX_QUEUE_BYTES = 32 * 1024 * 1024;
export const VOICE_WS_OPEN_TIMEOUT_MS = 30_000;

export type VoiceWsAuth =
  | { kind: "oauth" }
  | { kind: "ephemeral"; clientSecret: string };

export type VoiceWsFrame =
  | { kind: "text"; text: string }
  | { kind: "binary"; bytes: Uint8Array }
  | { kind: "close"; code: number; reason: string };

export interface VoiceSocket {
  sendJson(value: unknown): void;
  sendBinary(bytes: Uint8Array): void;
  frames(): AsyncGenerator<VoiceWsFrame>;
  close(code?: number, reason?: string): void;
}

export interface VoiceWsDeps {
  dial?: typeof WebSocket;
  endpointOrigin?: string;
  clientVersion?: string;
}

class VoiceHandshakeError extends Error {
  constructor(readonly status: number) {
    super(`Voice WebSocket handshake failed with HTTP ${status}`);
    this.name = "VoiceHandshakeError";
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function rawBytes(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

async function dialVoiceSocket(
  url: URL,
  protocols: string[],
  options: ClientOptions,
  signal: AbortSignal | undefined,
  Ctor: typeof WebSocket,
): Promise<VoiceSocket> {
  if (signal?.aborted) throw abortReason(signal);

  const ws = new Ctor(url, protocols, options);
  ws.binaryType = "arraybuffer";
  const queue: Array<{ frame: VoiceWsFrame; size: number }> = [];
  let queuedBytes = 0;
  let wake: (() => void) | undefined;
  let terminalError: Error | undefined;
  let framesStarted = false;
  let opened = false;
  let closeRequested = false;

  const notify = (): void => {
    const current = wake;
    wake = undefined;
    current?.();
  };
  const enqueue = (frame: VoiceWsFrame, size: number): void => {
    if (frame.kind !== "close" && queuedBytes + size > VOICE_WS_MAX_QUEUE_BYTES) {
      terminalError = new VoiceProtocolError("queue_limit", "Voice WebSocket receive queue exceeded its byte limit");
      queue.length = 0;
      queuedBytes = 0;
      if (!closeRequested) {
        closeRequested = true;
        ws.close(1009, "voice receive queue exceeded");
      }
      notify();
      return;
    }
    queuedBytes += size;
    queue.push({ frame, size });
    notify();
  };
  const onMessage = (data: RawData, isBinary: boolean): void => {
    const bytes = rawBytes(data);
    enqueue(
      isBinary
        ? { kind: "binary", bytes: bytes.slice() }
        : { kind: "text", text: Buffer.from(bytes).toString("utf8") },
      bytes.byteLength,
    );
  };
  const onClose = (code: number, reason: Buffer): void => {
    signal?.removeEventListener("abort", onAbort);
    enqueue({ kind: "close", code, reason: reason.toString("utf8") }, 0);
  };
  const onAbort = (): void => {
    if (opened) {
      if (!closeRequested) {
        closeRequested = true;
        ws.close(1000, "caller aborted");
      }
      return;
    }
    ws.terminate();
  };
  ws.on("message", onMessage);
  ws.on("close", onClose);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (run: () => void): void => {
        if (settled) return;
        settled = true;
        ws.off("open", onOpen);
        ws.off("unexpected-response", onUnexpectedResponse);
        signal?.removeEventListener("abort", onDialAbort);
        run();
      };
      const onOpen = (): void => finish(() => { opened = true; resolve(); });
      const onError = (): void => {
        if (!opened) finish(() => reject(new Error("Voice WebSocket connection failed")));
      };
      const onUnexpectedResponse = (_request: unknown, response: import("node:http").IncomingMessage): void => {
        response.resume();
        finish(() => reject(new VoiceHandshakeError(response.statusCode ?? 0)));
      };
      const onDialAbort = (): void => finish(() => reject(abortReason(signal!)));
      ws.once("open", onOpen);
      ws.once("error", onError);
      ws.once("unexpected-response", onUnexpectedResponse);
      signal?.addEventListener("abort", onDialAbort, { once: true });
    });
  } catch (error) {
    signal?.removeEventListener("abort", onAbort);
    ws.removeAllListeners();
    ws.on("error", () => undefined);
    if (ws.readyState === WebSocket.OPEN) ws.terminate();
    throw error;
  }

  // WebSocket emits post-open errors before close; retaining a listener prevents
  // EventEmitter from turning a transport failure into an uncaught exception.
  ws.on("error", () => undefined);

  const ensureOpen = (): void => {
    if (ws.readyState !== WebSocket.OPEN || terminalError) throw new Error("Voice WebSocket is not open");
  };
  return {
    sendJson(value) {
      ensureOpen();
      ws.send(JSON.stringify(value));
    },
    sendBinary(bytes) {
      ensureOpen();
      ws.send(bytes, { binary: true });
    },
    async *frames() {
      if (framesStarted) throw new Error("Voice WebSocket frames can only be consumed once");
      framesStarted = true;
      for (;;) {
        if (terminalError) throw terminalError;
        const next = queue.shift();
        if (next) {
          queuedBytes -= next.size;
          yield next.frame;
          if (next.frame.kind === "close") return;
          continue;
        }
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    },
    close(code = 1000, reason = "client close") {
      signal?.removeEventListener("abort", onAbort);
      if (closeRequested || ws.readyState === WebSocket.CLOSED) return;
      closeRequested = true;
      ws.close(code, reason);
    },
  };
}

export async function openVoiceSocket(
  path: string,
  auth: VoiceWsAuth,
  signal: AbortSignal | undefined,
  deps: VoiceWsDeps,
): Promise<VoiceSocket> {
  if (signal?.aborted) throw abortReason(signal);
  const origin = deps.endpointOrigin ?? XAI_VOICE_WS_ORIGIN;
  const url = new URL(path, origin);
  if (!deps.endpointOrigin && (url.protocol !== "wss:" || url.hostname !== "api.x.ai")) {
    throw new Error("Voice WebSocket destination must be api.x.ai over wss");
  }
  const Ctor = deps.dial ?? WebSocket;
  const baseOptions: ClientOptions = {
    maxPayload: VOICE_WS_MAX_MESSAGE_BYTES,
    handshakeTimeout: VOICE_WS_OPEN_TIMEOUT_MS,
    perMessageDeflate: false,
  };
  if (auth.kind === "ephemeral") {
    return dialVoiceSocket(url, ephemeralProtocols(auth.clientSecret), baseOptions, signal, Ctor);
  }

  const connect = async (bearer: string): Promise<VoiceSocket> => {
    const headers = buildUpstreamHeaders({
      auth: { kind: "oauth", bearer },
      clientVersion: deps.clientVersion ?? readPackageVersion(),
      trace: { requestId: randomUUID() },
    });
    return dialVoiceSocket(url, [], { ...baseOptions, headers: Object.fromEntries(headers) }, signal, Ctor);
  };
  const first = await getValidBearerSnapshot({ signal });
  try {
    return await connect(first.bearer);
  } catch (error) {
    if (!(error instanceof VoiceHandshakeError) || error.status !== 401) throw error;
    const refreshed = await getValidBearerSnapshot({
      forceRefresh: true,
      rejectedAccessToken: first.bearer,
      signal,
    });
    return connect(refreshed.bearer);
  }
}

export type StreamingSttEncoding = "pcm" | "mulaw" | "alaw" | "opus";
export type StreamingSampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000;

export interface StreamingSttOptions {
  encoding?: StreamingSttEncoding;
  sample_rate?: StreamingSampleRate;
  interim_results?: boolean;
  endpointing?: number;
  language?: string;
  multichannel?: boolean;
  channels?: number;
  diarize?: boolean;
  keyterm?: string[];
  filler_words?: boolean;
  smart_turn?: number;
  smart_turn_timeout?: number;
  vad_threshold?: number;
  signal?: AbortSignal;
}

export interface SttCompletion {
  kind: "completed" | "completed-with-transport-close";
  finalText: string;
  finalEvent: "transcript.partial:speech_final" | "transcript.done";
  closeCode?: number;
}

export interface StreamingSttSession {
  sendAudio(bytes: Uint8Array): void;
  finalize(channel?: number): void;
  finish(): void;
  events(): AsyncGenerator<SttServerEvent | SttCompletion>;
  close(): void;
}

interface SttState {
  ready: boolean;
  finishSent: boolean;
  speechFinal?: Extract<SttServerEvent, { type: "transcript.partial" }>;
  done?: Extract<SttServerEvent, { type: "transcript.done" }>;
}

export function reduceSttEvent(state: SttState, event: SttServerEvent): SttState {
  if (event.type === "transcript.created") return { ...state, ready: true };
  if (event.type === "transcript.partial" && event.speech_final) return { ...state, speechFinal: event };
  if (event.type === "transcript.done") return { ...state, done: event };
  return state;
}

function sttUrl(options: StreamingSttOptions): string {
  if (options.endpointing !== undefined && (options.endpointing < 0 || options.endpointing > 5000)) throw new RangeError("endpointing must be 0..5000");
  if (options.vad_threshold !== undefined && (options.vad_threshold < 0 || options.vad_threshold > 1)) throw new RangeError("vad_threshold must be 0..1");
  if (options.smart_turn !== undefined && (options.smart_turn < 0 || options.smart_turn > 1)) throw new RangeError("smart_turn must be 0..1");
  if (options.smart_turn_timeout !== undefined && (options.smart_turn_timeout < 0 || options.smart_turn_timeout > 10_000)) throw new RangeError("smart_turn_timeout must be 0..10000");
  if (options.multichannel && (!Number.isInteger(options.channels) || options.channels! < 2 || options.channels! > 8)) throw new RangeError("multichannel requires channels 2..8");
  if (options.encoding === "opus" && options.multichannel) throw new RangeError("opus does not support multichannel");
  if ((options.keyterm?.length ?? 0) > 100 || options.keyterm?.some((term) => term.length === 0 || term.length > 50)) throw new RangeError("invalid keyterm");
  const query = new URLSearchParams();
  const set = (key: string, value: string | number | boolean | undefined): void => {
    if (value !== undefined) query.set(key, String(value));
  };
  set("encoding", options.encoding); set("sample_rate", options.sample_rate);
  set("interim_results", options.interim_results); set("endpointing", options.endpointing);
  set("language", options.language); set("multichannel", options.multichannel);
  set("channels", options.channels); set("diarize", options.diarize);
  for (const term of options.keyterm ?? []) query.append("keyterm", term);
  set("filler_words", options.filler_words); set("smart_turn", options.smart_turn);
  set("smart_turn_timeout", options.smart_turn_timeout); set("vad_threshold", options.vad_threshold);
  return `/v1/stt${query.size ? `?${query}` : ""}`;
}

export async function createSttSession(
  options: StreamingSttOptions = {},
  deps: VoiceWsDeps = {},
): Promise<StreamingSttSession> {
  const socket = await openVoiceSocket(sttUrl(options), { kind: "oauth" }, options.signal, deps);
  let state: SttState = { ready: false, finishSent: false };
  return {
    sendAudio(bytes) {
      if (!state.ready) throw new Error("wait for transcript.created before sending audio");
      if (state.finishSent) throw new Error("audio.done was already sent");
      socket.sendBinary(bytes);
    },
    finalize(channel) {
      if (state.finishSent) throw new Error("audio.done was already sent");
      const event: SttClientControl = channel === undefined ? { type: "finalize" } : { type: "finalize", channel };
      socket.sendJson(event);
    },
    finish() {
      if (state.finishSent) throw new Error("audio.done was already sent");
      state = { ...state, finishSent: true };
      socket.sendJson({ type: "audio.done" } satisfies SttClientControl);
    },
    async *events() {
      for await (const frame of socket.frames()) {
        if (frame.kind === "binary") {
          socket.close(1002, "unexpected STT binary frame");
          throw new VoiceProtocolError("unexpected_binary", "STT server sent a binary frame");
        }
        if (frame.kind === "text") {
          let event: SttServerEvent;
          try { event = parseSttServerEvent(frame.text); }
          catch (error) { socket.close(1002, "invalid STT event"); throw error; }
          if (event.type === "error") {
            socket.close(1002, "STT error event");
            throw new VoiceProtocolError("invalid_event", "xAI STT returned an error event");
          }
          state = reduceSttEvent(state, event);
          yield event;
          continue;
        }
        const terminal = state.speechFinal ?? state.done;
        if (!terminal || !state.finishSent) {
          throw new VoiceProtocolError("abnormal_close", `STT closed before terminal evidence (${frame.code})`);
        }
        yield {
          kind: frame.code === 1006 ? "completed-with-transport-close" : "completed",
          finalText: state.speechFinal?.text ?? state.done?.text ?? "",
          finalEvent: state.speechFinal ? "transcript.partial:speech_final" : "transcript.done",
          ...(frame.code === 1006 ? { closeCode: frame.code } : {}),
        };
        return;
      }
    },
    close() { socket.close(); },
  };
}

export interface StreamingTtsOptions {
  voice?: string;
  language: string;
  codec?: "mp3" | "wav" | "pcm" | "mulaw" | "alaw";
  sample_rate?: StreamingSampleRate;
  bit_rate?: 32000 | 64000 | 96000 | 128000 | 192000;
  optimize_streaming_latency?: 0 | 1;
  speed?: number;
  text_normalization?: boolean;
  with_timestamps?: boolean;
  signal?: AbortSignal;
}

export interface StreamingTtsSession {
  sendText(delta: string): void;
  finishUtterance(): void;
  events(): AsyncGenerator<TtsServerEvent>;
  close(): void;
}

export async function createTtsSession(
  options: StreamingTtsOptions,
  deps: VoiceWsDeps = {},
): Promise<StreamingTtsSession> {
  if (!options.language.trim()) throw new RangeError("language is required");
  if (options.speed !== undefined && (options.speed < 0.7 || options.speed > 1.5)) throw new RangeError("speed must be 0.7..1.5");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (key !== "signal" && value !== undefined) query.set(key, String(value));
  }
  const socket = await openVoiceSocket(`/v1/tts?${query}`, { kind: "oauth" }, options.signal, deps);
  let awaitingDone = false;
  return {
    sendText(delta) {
      if (awaitingDone) throw new Error("wait for audio.done before the next utterance");
      if (delta.length === 0 || delta.length > 60_000) throw new RangeError("text delta must contain 1..60000 characters");
      socket.sendJson({ type: "text.delta", delta } satisfies TtsClientEvent);
    },
    finishUtterance() {
      if (awaitingDone) throw new Error("wait for audio.done before finishing another utterance");
      awaitingDone = true;
      socket.sendJson({ type: "text.done" } satisfies TtsClientEvent);
    },
    async *events() {
      for await (const frame of socket.frames()) {
        if (frame.kind === "binary") {
          socket.close(1002, "unexpected TTS binary frame");
          throw new VoiceProtocolError("unexpected_binary", "streaming TTS server sent binary instead of JSON");
        }
        if (frame.kind === "close") return;
        let event: TtsServerEvent;
        try { event = parseTtsServerEvent(frame.text); }
        catch (error) { socket.close(1002, "invalid TTS event"); throw error; }
        if (event.type === "error") {
          socket.close(1002, "TTS error event");
          throw new VoiceProtocolError("invalid_event", "xAI TTS returned an error event");
        }
        if (event.type === "audio.done") awaitingDone = false;
        yield event;
      }
    },
    close() { socket.close(); },
  };
}
