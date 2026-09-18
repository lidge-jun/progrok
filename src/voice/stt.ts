import type { XaiTransport } from "../transport/fetch.js";
import { createVoiceHttpClient, expectRecord, expectString } from "./http.js";
import type { AudioSampleRate } from "./tts.js";

export type SttAudioFormat = "pcm" | "mulaw" | "alaw" | "wav" | "mp3" | "ogg" | "opus" | "flac" | "aac" | "mp4" | "m4a" | "mkv";
export type SttSource = { file: Blob; filename: string; url?: never } | { url: string; file?: never; filename?: never };
export type SttRequest = SttSource & { audio_format?: SttAudioFormat; sample_rate?: AudioSampleRate; language?: string; format?: boolean; multichannel?: boolean; channels?: number; diarize?: boolean; keyterm?: string[]; filler_words?: boolean; vad_threshold?: number };
export interface SttWord { text: string; start: number; end: number; confidence?: number; speaker?: number }
export interface SttChannel { index: number; language?: string; text: string; words?: SttWord[] }
export interface SttResult { text: string; language: string; duration: number; words?: SttWord[]; channels?: SttChannel[] }

const RAW_FORMATS = new Set<SttAudioFormat>(["pcm", "mulaw", "alaw"]);
function validateSttRequest(request: SttRequest): void {
  const raw = request as Partial<{ file: Blob; filename: string; url: string }>;
  const hasFile = raw.file instanceof Blob;
  const hasUrl = typeof raw.url === "string";
  if (hasFile === hasUrl) throw new RangeError("exactly one of file or url is required");
  if (hasFile && raw.file!.size > 500 * 1024 * 1024) throw new RangeError("STT file exceeds 500 MB");
  if (hasFile && !raw.filename?.trim()) throw new RangeError("filename is required for file input");
  if (hasUrl) { const url = new URL(raw.url!); if (url.protocol !== "https:" && url.protocol !== "http:") throw new RangeError("STT url must use http or https"); }
  if (request.audio_format && RAW_FORMATS.has(request.audio_format) && request.sample_rate === undefined) throw new RangeError("sample_rate is required for raw audio");
  if (request.format && !request.language) throw new RangeError("language is required when format=true");
  if (request.multichannel && request.channels !== undefined && (!Number.isInteger(request.channels) || request.channels < 2 || request.channels > 8)) throw new RangeError("channels must be 2..8");
  if (request.keyterm && (request.keyterm.length > 100 || request.keyterm.some((term) => term.length === 0 || term.length > 50))) throw new RangeError("keyterm supports at most 100 non-empty values of 50 characters");
  if (request.vad_threshold !== undefined && (request.vad_threshold < 0 || request.vad_threshold > 1)) throw new RangeError("vad_threshold must be 0..1");
}
export function buildSttForm(request: SttRequest): FormData {
  validateSttRequest(request);
  const form = new FormData();
  const append = (name: string, value: string | number | boolean | undefined): void => { if (value !== undefined) form.append(name, String(value)); };
  if ("url" in request && request.url !== undefined) form.append("url", request.url);
  append("audio_format", request.audio_format); append("sample_rate", request.sample_rate); append("language", request.language);
  append("format", request.format); append("multichannel", request.multichannel); append("channels", request.channels); append("diarize", request.diarize);
  for (const term of request.keyterm ?? []) form.append("keyterm", term);
  append("filler_words", request.filler_words); append("vad_threshold", request.vad_threshold);
  if ("file" in request && request.file !== undefined) form.append("file", request.file, request.filename);
  return form;
}
function decodeWord(wire: unknown): SttWord {
  const value = expectRecord(wire, "STT word");
  if (typeof value.start !== "number" || typeof value.end !== "number") throw new TypeError("invalid STT word timestamps");
  return { text: expectString(value, "text"), start: value.start, end: value.end, ...(typeof value.confidence === "number" ? { confidence: value.confidence } : {}), ...(Number.isInteger(value.speaker) ? { speaker: value.speaker as number } : {}) };
}
function decodeSttResponse(wire: unknown): SttResult {
  const value = expectRecord(wire, "STT response");
  if (typeof value.duration !== "number" || !Number.isFinite(value.duration)) throw new TypeError("invalid duration");
  const result: SttResult = { text: expectString(value, "text"), language: expectString(value, "language"), duration: value.duration };
  if (value.words !== undefined) { if (!Array.isArray(value.words)) throw new TypeError("words must be array"); result.words = value.words.map(decodeWord); }
  if (value.channels !== undefined) {
    if (!Array.isArray(value.channels)) throw new TypeError("channels must be array");
    result.channels = value.channels.map((rawChannel) => { const channel = expectRecord(rawChannel, "STT channel"); if (!Number.isInteger(channel.index)) throw new TypeError("channel index must be integer"); return { index: channel.index as number, text: expectString(channel, "text"), ...(typeof channel.language === "string" ? { language: channel.language } : {}), ...(Array.isArray(channel.words) ? { words: channel.words.map(decodeWord) } : {}) }; });
  }
  return result;
}
export function createSttClient(deps?: { transport?: XaiTransport }): { transcribe(req: SttRequest): Promise<SttResult> } {
  const http = createVoiceHttpClient(deps);
  return { transcribe(req) { return http.requestJson("/v1/stt", { method: "POST", body: buildSttForm(req) }, decodeSttResponse); } };
}
