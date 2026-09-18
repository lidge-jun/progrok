import type { XaiTransport } from "../transport/fetch.js";
import { createVoiceHttpClient, expectRecord, expectString, jsonBody, VoiceHttpError } from "./http.js";

export type TtsCodec = "mp3" | "wav" | "pcm" | "mulaw" | "alaw";
export type AudioSampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
export type Mp3BitRate = 32000 | 64000 | 96000 | 128000 | 192000;
export interface TtsOutputFormat { codec: TtsCodec; sample_rate?: AudioSampleRate | null; bit_rate?: Mp3BitRate | null }
export interface TtsRequest { text: string; language: "auto" | (string & {}); voice_id?: string; output_format?: TtsOutputFormat; optimize_streaming_latency?: "0" | "1"; text_normalization?: boolean; with_timestamps?: boolean; speed?: number; replace?: Record<string, string> }
export interface TtsGraphTime { start: number; end: number }
export interface TtsAudioTimestamps { graph_chars: string[]; graph_times: TtsGraphTime[] }
export interface TtsJsonResponse { audio: string; content_type: string; duration: number; audio_timestamps?: TtsAudioTimestamps }
export type TtsResult = { kind: "audio"; bytes: Uint8Array; contentType: string; duration?: number } | { kind: "json"; body: unknown };
export interface TtsVoice { voice_id: string; name: string; language: string | null }
export interface ListTtsVoicesResponse { voices: TtsVoice[] }

function validateTtsRequest(request: TtsRequest): void {
  if (request.text.length === 0 || request.text.length > 60_000) throw new RangeError("text must contain 1..60000 characters");
  if (!request.language.trim()) throw new RangeError("language is required");
  if (request.speed !== undefined && (request.speed < 0.7 || request.speed > 1.5)) throw new RangeError("speed must be 0.7..1.5");
  if (request.output_format?.bit_rate != null && request.output_format.codec !== "mp3") throw new RangeError("bit_rate is valid only for mp3");
  const replacements = Object.entries(request.replace ?? {});
  if (replacements.length > 200) throw new RangeError("replace supports at most 200 entries");
  for (const [from, to] of replacements) {
    if (!/^[\p{L}\p{N}' ]+$/u.test(from) || from.length > 100 || to.length === 0 || to.length > 128) throw new RangeError("replace entry is invalid");
  }
}
function decodeTtsJson(wire: unknown): TtsJsonResponse {
  const value = expectRecord(wire, "TTS response");
  if (typeof value.duration !== "number" || !Number.isFinite(value.duration)) throw new TypeError("duration must be finite");
  const result: TtsJsonResponse = { audio: expectString(value, "audio"), content_type: expectString(value, "content_type"), duration: value.duration };
  if (value.audio_timestamps !== undefined) {
    const timestamps = expectRecord(value.audio_timestamps, "audio_timestamps");
    if (!Array.isArray(timestamps.graph_chars) || !Array.isArray(timestamps.graph_times)) throw new TypeError("invalid audio_timestamps");
    result.audio_timestamps = {
      graph_chars: timestamps.graph_chars.map((item) => { if (typeof item !== "string") throw new TypeError("invalid graph char"); return item; }),
      graph_times: timestamps.graph_times.map((item) => { const time = expectRecord(item, "graph_time"); if (typeof time.start !== "number" || typeof time.end !== "number") throw new TypeError("invalid graph_time"); return { start: time.start, end: time.end }; }),
    };
  }
  return result;
}
export function createTtsClient(deps?: { transport?: XaiTransport }): { synthesize(req: TtsRequest): Promise<TtsResult> } {
  const http = createVoiceHttpClient(deps);
  return {
    async synthesize(req) {
      validateTtsRequest(req);
      const response = await http.request("/v1/tts", { method: "POST", ...jsonBody(req) });
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.includes("application/json")) {
        let wire: unknown;
        try { wire = await response.json(); }
        catch { throw new VoiceHttpError("voice_invalid_response", response.status, "TTS returned invalid JSON"); }
        try { return { kind: "json", body: decodeTtsJson(wire) }; }
        catch (cause) { if (cause instanceof VoiceHttpError) throw cause; throw new VoiceHttpError("voice_invalid_response", response.status, "TTS response shape was invalid"); }
      }
      return { kind: "audio", bytes: new Uint8Array(await response.arrayBuffer()), contentType: contentType || "application/octet-stream" };
    },
  };
}
