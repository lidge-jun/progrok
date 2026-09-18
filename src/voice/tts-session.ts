import {
  VoiceProtocolError,
  parseTtsServerEvent,
  type TtsClientEvent,
  type TtsServerEvent,
} from "./protocol.js";
import {
  openVoiceSocket,
  type StreamingSampleRate,
  type VoiceWsAuth,
  type VoiceWsDeps,
} from "./ws-socket.js";

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

