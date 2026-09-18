import { randomUUID } from "node:crypto";
import {
  VoiceProtocolError,
  parseSttServerEvent,
  type SttClientControl,
  type SttServerEvent,
} from "./protocol.js";
import {
  openVoiceSocket,
  type StreamingSampleRate,
  type VoiceWsAuth,
  type VoiceWsDeps,
} from "./ws-socket.js";

export type StreamingSttEncoding = "pcm" | "mulaw" | "alaw" | "opus";

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
