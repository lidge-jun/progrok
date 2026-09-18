export const XAI_VOICE_WS_ORIGIN = "wss://api.x.ai" as const;
export const PINNED_REALTIME_MODEL = "grok-voice-think-fast-2.0" as const;
export const REALTIME_MODEL_ALIAS = "grok-voice-latest" as const;
export const XAI_EPHEMERAL_PROTOCOL_PREFIX = "xai-client-secret." as const;

export const STT_CLIENT_EVENT_TYPES = ["finalize", "Finalize", "audio.done"] as const;
export const STT_EVENTS = {
  created: "transcript.created",
  partial: "transcript.partial",
  done: "transcript.done",
  error: "error",
} as const;
export const STT_SERVER_EVENT_TYPES = Object.values(STT_EVENTS);
export const TTS_CLIENT_EVENT_TYPES = ["text.delta", "text.done"] as const;
export const TTS_SERVER_EVENT_TYPES = ["audio.delta", "audio.done", "error"] as const;
export const REALTIME_CLIENT_EVENT_TYPES = [
  "session.update", "input_audio_buffer.append", "input_audio_buffer.commit",
  "input_audio_buffer.clear", "conversation.item.create", "conversation.item.delete",
  "conversation.item.truncate", "response.create", "response.cancel", "pong",
] as const;
export const REALTIME_SERVER_EVENT_TYPES = [
  "session.created", "session.updated", "conversation.created", "conversation.item.added",
  "conversation.item.created", "conversation.item.deleted", "conversation.item.truncated",
  "conversation.item.input_audio_transcription.updated",
  "conversation.item.input_audio_transcription.completed", "input_audio_buffer.speech_started",
  "input_audio_buffer.speech_stopped", "input_audio_buffer.committed",
  "input_audio_buffer.cleared", "input_audio_buffer.timeout_triggered",
  "input_audio_buffer.dtmf_event_received", "response.created", "response.done",
  "response.output_item.added", "response.output_item.done", "response.content_part.added",
  "response.content_part.done", "response.output_audio.delta", "response.output_audio.done",
  "response.output_audio_transcript.delta", "response.output_audio_transcript.done",
  "response.text.delta", "response.output_text.delta", "response.function_call_arguments.delta",
  "response.function_call_arguments.done", "mcp_list_tools.in_progress",
  "mcp_list_tools.completed", "mcp_list_tools.failed", "response.mcp_call_arguments.delta",
  "response.mcp_call_arguments.done", "response.mcp_call.in_progress",
  "response.mcp_call.completed", "response.mcp_call.failed", "response.cancelled", "ping", "error",
] as const;

export interface EphemeralClientSecret { value: string; expires_at: number }
export const ephemeralProtocols = (secret: string): string[] => {
  if (!secret || /[\r\n,]/.test(secret)) throw new RangeError("invalid ephemeral client secret");
  return [`${XAI_EPHEMERAL_PROTOCOL_PREFIX}${secret}`];
};

export interface StreamingSttWord { text: string; start: number; end: number; confidence?: number; speaker?: number }
export type SttClientControl = { type: "finalize" | "Finalize"; channel?: number } | { type: "audio.done" };
export type SttServerEvent =
  | { type: "transcript.created"; id: string }
  | { type: "transcript.partial"; text: string; words: StreamingSttWord[]; is_final: boolean; speech_final: boolean; start: number; duration: number; channel_index?: number; end_of_turn_confidence?: number }
  | { type: "transcript.done"; text: string; words: StreamingSttWord[]; duration: number; channel_index?: number }
  | { type: "error"; message: string };
export type TtsClientEvent = { type: "text.delta"; delta: string } | { type: "text.done" };
export interface StreamingAudioTimestamps { graph_chars: string[]; graph_times: [number, number][] }
export type TtsServerEvent =
  | { type: "audio.delta"; delta: string; audio_timestamps?: StreamingAudioTimestamps; audio_duration?: number }
  | { type: "audio.done"; trace_id?: string }
  | { type: "error"; message: string };

export type RealtimeVoiceModel = string;
export type RealtimeReasoningEffort = "low" | "medium" | "high";
export type RealtimeAudioType = "audio/pcm" | "audio/pcmu" | "audio/pcma" | "audio/opus";
export type RealtimeAudioRate = 8000 | 11025 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
export type RealtimeAudioTransport = "json" | "binary";
export interface RealtimeAudioFormat { type: RealtimeAudioType; rate?: RealtimeAudioRate }
export interface RealtimeTurnDetection { type: "server_vad"; threshold?: number; silence_duration_ms?: number; prefix_padding_ms?: number; idle_timeout_ms?: number | null }
export interface RealtimeInputTranscription { model?: "grok-transcribe"; language_hint?: string; keyterms?: string[] }
export interface RealtimeAudioConfig {
  input?: { format?: RealtimeAudioFormat; transport?: RealtimeAudioTransport; transcription?: RealtimeInputTranscription };
  output?: { format?: RealtimeAudioFormat; transport?: RealtimeAudioTransport; speed?: number };
}
export type RealtimeTool =
  | { type: "function"; function: { name: string; description?: string; parameters: Record<string, unknown> } }
  | { type: "web_search"; location?: { country?: string; city?: string; region?: string; timezone?: string }; allowed_domains?: string[]; excluded_domains?: string[]; enable_image_understanding?: boolean }
  | { type: "x_search"; allowed_x_handles?: string[]; excluded_x_handles?: string[]; from_date?: string; to_date?: string; enable_image_understanding?: boolean; enable_video_understanding?: boolean }
  | { type: "file_search"; vector_store_ids: string[]; max_num_results?: number }
  | { type: "mcp"; server_label: string; server_url: string; server_description?: string; allowed_tools?: string[]; authorization?: string; headers?: Record<string, string> };
export interface RealtimeSessionConfig { model?: RealtimeVoiceModel; instructions?: string; reasoning?: { effort?: RealtimeReasoningEffort }; voice?: string; turn_detection?: RealtimeTurnDetection | null; resumption?: { enabled: boolean }; audio?: RealtimeAudioConfig; tools?: RealtimeTool[]; replace?: Record<string, string> | null }
export type RealtimeContentPart = { type: "input_text" | "text"; text: string } | { type: "input_audio" | "audio"; audio: string; transcript?: string };
export type RealtimeConversationItem =
  | { type: "message"; id?: string; role: "user" | "assistant" | "system"; content: RealtimeContentPart[] }
  | { type: "function_call"; id?: string; name: string; arguments: string; call_id?: string }
  | { type: "function_call_output"; id?: string; call_id: string; output: string }
  | { type: "force_message"; role: "assistant"; content: [{ type: "output_text"; text: string }]; interruptible?: boolean };
export type RealtimeClientEvent =
  | { type: "session.update"; session: RealtimeSessionConfig }
  | { type: "input_audio_buffer.append"; audio: string }
  | { type: "input_audio_buffer.commit" }
  | { type: "input_audio_buffer.clear" }
  | { type: "conversation.item.create"; item: RealtimeConversationItem; previous_item_id?: string }
  | { type: "conversation.item.delete"; item_id: string }
  | { type: "conversation.item.truncate"; item_id: string; content_index: number; audio_end_ms: number }
  | { type: "response.create"; response?: { modalities?: ("text" | "audio")[] | null; instructions?: string | null; metadata?: Record<string, string> | null } }
  | { type: "response.cancel"; response_id?: string }
  | { type: "pong"; ping_timestamp: number };

export interface RealtimeEventBase { event_id?: string }
export type RealtimeServerEvent =
  | (RealtimeEventBase & { type: "session.created" | "session.updated"; session: Record<string, unknown> })
  | (RealtimeEventBase & { type: "conversation.created"; conversation: { id: string } })
  | (RealtimeEventBase & { type: "conversation.item.added" | "conversation.item.created"; previous_item_id?: string; item: Record<string, unknown> })
  | (RealtimeEventBase & { type: "conversation.item.deleted"; item_id: string })
  | (RealtimeEventBase & { type: "conversation.item.truncated"; item_id: string; content_index: number; audio_end_ms: number; transcript?: string })
  | (RealtimeEventBase & { type: "conversation.item.input_audio_transcription.updated" | "conversation.item.input_audio_transcription.completed"; item_id: string; transcript: string })
  | (RealtimeEventBase & { type: "input_audio_buffer.speech_started"; item_id: string; audio_start_ms: number })
  | (RealtimeEventBase & { type: "input_audio_buffer.speech_stopped"; item_id: string; audio_end_ms: number })
  | (RealtimeEventBase & { type: "input_audio_buffer.committed"; item_id: string; previous_item_id?: string })
  | (RealtimeEventBase & { type: "input_audio_buffer.cleared" })
  | (RealtimeEventBase & { type: "input_audio_buffer.timeout_triggered"; item_id: string; audio_start_ms: number; audio_end_ms: number; previous_item_id?: string })
  | (RealtimeEventBase & { type: "input_audio_buffer.dtmf_event_received"; event: "0"|"1"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"*"|"#"; received_at: number })
  | (RealtimeEventBase & { type: "response.created" | "response.done"; response: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.output_item.added" | "response.output_item.done"; response_id: string; output_index: number; item: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.content_part.added" | "response.content_part.done"; response_id: string; item_id: string; output_index: number; content_index: number; part: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.output_audio.delta"; response_id: string; item_id: string; output_index: number; content_index: number; delta: string })
  | (RealtimeEventBase & { type: "response.output_audio.done"; response_id: string; item_id: string; output_index: number; content_index: number })
  | (RealtimeEventBase & { type: "response.output_audio_transcript.delta"; response_id: string; item_id: string; output_index: number; content_index: number; delta: string })
  | (RealtimeEventBase & { type: "response.output_audio_transcript.done"; response_id: string; item_id: string; output_index: number; content_index: number; transcript: string })
  | (RealtimeEventBase & { type: "response.text.delta" | "response.output_text.delta"; response_id: string; item_id: string; delta: string; output_index?: number; content_index?: number })
  | (RealtimeEventBase & { type: "response.function_call_arguments.delta"; response_id: string; item_id: string; output_index: number; call_id: string; delta: string })
  | (RealtimeEventBase & { type: "response.function_call_arguments.done"; response_id: string; item_id: string; output_index: number; call_id: string; name: string; arguments: string })
  | (RealtimeEventBase & { type: "mcp_list_tools.in_progress" | "mcp_list_tools.completed"; item_id: string })
  | (RealtimeEventBase & { type: "mcp_list_tools.failed"; item_id: string; error: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.mcp_call_arguments.delta"; response_id: string; item_id: string; call_id: string; delta: string })
  | (RealtimeEventBase & { type: "response.mcp_call_arguments.done"; response_id: string; item_id: string; call_id: string; name: string; arguments: string })
  | (RealtimeEventBase & { type: "response.mcp_call.in_progress" | "response.mcp_call.completed"; item_id: string; output_index: number })
  | (RealtimeEventBase & { type: "response.mcp_call.failed"; item_id: string; output_index: number; error: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.cancelled"; response_id?: string })
  | { type: "ping"; timestamp: number }
  | (RealtimeEventBase & { type: "error"; error: { code?: string; type?: string; message: string } });
export type RealtimeNormalizedEvent = RealtimeServerEvent | { type: "response.output_audio.binary"; bytes: Uint8Array };

export class VoiceProtocolError extends Error {
  constructor(readonly code: "invalid_event" | "unexpected_binary" | "abnormal_close" | "queue_limit", message: string) {
    super(message);
    this.name = "VoiceProtocolError";
  }
}

function record(wire: unknown, label: string): Record<string, unknown> {
  if (!wire || typeof wire !== "object" || Array.isArray(wire)) throw new VoiceProtocolError("invalid_event", `${label} must be object`);
  return wire as Record<string, unknown>;
}
function stringField(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string") throw new VoiceProtocolError("invalid_event", `${key} must be string`);
  return value[key];
}
function numberField(value: Record<string, unknown>, key: string): number {
  if (typeof value[key] !== "number" || !Number.isFinite(value[key])) throw new VoiceProtocolError("invalid_event", `${key} must be number`);
  return value[key];
}
function integerField(value: Record<string, unknown>, key: string): number {
  const result = numberField(value, key);
  if (!Number.isInteger(result)) throw new VoiceProtocolError("invalid_event", `${key} must be integer`);
  return result;
}
function parseJson(text: string, label: string): Record<string, unknown> {
  try { return record(JSON.parse(text) as unknown, label); }
  catch (error) {
    if (error instanceof VoiceProtocolError) throw error;
    throw new VoiceProtocolError("invalid_event", `${label} was not JSON`);
  }
}
function eventId(value: Record<string, unknown>): RealtimeEventBase {
  return typeof value.event_id === "string" ? { event_id: value.event_id } : {};
}
function optionalString(value: Record<string, unknown>, key: string): { [name: string]: string } {
  return typeof value[key] === "string" ? { [key]: value[key] } : {};
}
function parseWord(wire: unknown): StreamingSttWord {
  const value = record(wire, "STT word");
  return {
    text: stringField(value, "text"), start: numberField(value, "start"), end: numberField(value, "end"),
    ...(typeof value.confidence === "number" ? { confidence: value.confidence } : {}),
    ...(Number.isInteger(value.speaker) ? { speaker: value.speaker as number } : {}),
  };
}

export function parseSttServerEvent(text: string): SttServerEvent {
  const value = parseJson(text, "STT event");
  if (value.type === "transcript.created") return { type: value.type, id: stringField(value, "id") };
  if (value.type === "error") return { type: value.type, message: stringField(value, "message") };
  if (value.type !== "transcript.partial" && value.type !== "transcript.done") throw new VoiceProtocolError("invalid_event", `unsupported STT event type: ${String(value.type)}`);
  if (!Array.isArray(value.words)) throw new VoiceProtocolError("invalid_event", "words must be array");
  const common = { text: stringField(value, "text"), words: value.words.map(parseWord), duration: numberField(value, "duration"), ...(Number.isInteger(value.channel_index) ? { channel_index: value.channel_index as number } : {}) };
  if (value.type === "transcript.done") return { type: value.type, ...common };
  if (typeof value.is_final !== "boolean" || typeof value.speech_final !== "boolean") throw new VoiceProtocolError("invalid_event", "transcript.partial state fields are invalid");
  return { type: value.type, ...common, start: numberField(value, "start"), is_final: value.is_final, speech_final: value.speech_final, ...(typeof value.end_of_turn_confidence === "number" ? { end_of_turn_confidence: value.end_of_turn_confidence } : {}) };
}

export function parseTtsServerEvent(text: string): TtsServerEvent {
  const value = parseJson(text, "TTS event");
  if (value.type === "audio.done") return { type: value.type, ...(typeof value.trace_id === "string" ? { trace_id: value.trace_id } : {}) };
  if (value.type === "error") return { type: value.type, message: stringField(value, "message") };
  if (value.type !== "audio.delta") throw new VoiceProtocolError("invalid_event", "unsupported TTS event");
  let audioTimestamps: StreamingAudioTimestamps | undefined;
  if (value.audio_timestamps !== undefined) {
    const timestamps = record(value.audio_timestamps, "audio_timestamps");
    if (!Array.isArray(timestamps.graph_chars) || !Array.isArray(timestamps.graph_times)) throw new VoiceProtocolError("invalid_event", "audio_timestamps fields are invalid");
    audioTimestamps = {
      graph_chars: timestamps.graph_chars.map((item) => { if (typeof item !== "string") throw new VoiceProtocolError("invalid_event", "graph_chars item is invalid"); return item; }),
      graph_times: timestamps.graph_times.map((item) => { if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== "number" || typeof item[1] !== "number") throw new VoiceProtocolError("invalid_event", "graph_times item is invalid"); return [item[0], item[1]]; }),
    };
  }
  return { type: value.type, delta: stringField(value, "delta"), ...(audioTimestamps ? { audio_timestamps: audioTimestamps } : {}), ...(typeof value.audio_duration === "number" ? { audio_duration: value.audio_duration } : {}) };
}

export function parseRealtimeServerEvent(text: string): RealtimeServerEvent {
  const value = parseJson(text, "realtime event");
  const type = stringField(value, "type");
  const base = eventId(value);
  switch (type) {
    case "ping": return { type, timestamp: numberField(value, "timestamp") };
    case "session.created": case "session.updated": return { type, session: record(value.session, "session"), ...base };
    case "conversation.created": return { type, conversation: { id: stringField(record(value.conversation, "conversation"), "id") }, ...base };
    case "conversation.item.added": case "conversation.item.created": return { type, item: record(value.item, "item"), ...optionalString(value, "previous_item_id"), ...base };
    case "conversation.item.deleted": return { type, item_id: stringField(value, "item_id"), ...base };
    case "conversation.item.truncated": return { type, item_id: stringField(value, "item_id"), content_index: integerField(value, "content_index"), audio_end_ms: numberField(value, "audio_end_ms"), ...optionalString(value, "transcript"), ...base };
    case "conversation.item.input_audio_transcription.updated": case "conversation.item.input_audio_transcription.completed": return { type, item_id: stringField(value, "item_id"), transcript: stringField(value, "transcript"), ...base };
    case "input_audio_buffer.speech_started": return { type, item_id: stringField(value, "item_id"), audio_start_ms: numberField(value, "audio_start_ms"), ...base };
    case "input_audio_buffer.speech_stopped": return { type, item_id: stringField(value, "item_id"), audio_end_ms: numberField(value, "audio_end_ms"), ...base };
    case "input_audio_buffer.committed": return { type, item_id: stringField(value, "item_id"), ...optionalString(value, "previous_item_id"), ...base };
    case "input_audio_buffer.cleared": return { type, ...base };
    case "input_audio_buffer.timeout_triggered": return { type, item_id: stringField(value, "item_id"), audio_start_ms: numberField(value, "audio_start_ms"), audio_end_ms: numberField(value, "audio_end_ms"), ...optionalString(value, "previous_item_id"), ...base };
    case "input_audio_buffer.dtmf_event_received": { const event = stringField(value, "event"); if (!/^[0-9*#]$/.test(event)) throw new VoiceProtocolError("invalid_event", "DTMF event is invalid"); return { type, event: event as Extract<RealtimeServerEvent, { type: typeof type }>["event"], received_at: numberField(value, "received_at"), ...base }; }
    case "response.created": case "response.done": return { type, response: record(value.response, "response"), ...base };
    case "response.output_item.added": case "response.output_item.done": return { type, response_id: stringField(value, "response_id"), output_index: integerField(value, "output_index"), item: record(value.item, "item"), ...base };
    case "response.content_part.added": case "response.content_part.done": return { type, response_id: stringField(value, "response_id"), item_id: stringField(value, "item_id"), output_index: integerField(value, "output_index"), content_index: integerField(value, "content_index"), part: record(value.part, "part"), ...base };
    case "response.output_audio.delta": return { type, response_id: stringField(value, "response_id"), item_id: stringField(value, "item_id"), output_index: integerField(value, "output_index"), content_index: integerField(value, "content_index"), delta: stringField(value, "delta"), ...base };
    case "response.output_audio.done": return { type, response_id: stringField(value, "response_id"), item_id: stringField(value, "item_id"), output_index: integerField(value, "output_index"), content_index: integerField(value, "content_index"), ...base };
    case "response.output_audio_transcript.delta": return { type, response_id: stringField(value, "response_id"), item_id: stringField(value, "item_id"), output_index: integerField(value, "output_index"), content_index: integerField(value, "content_index"), delta: stringField(value, "delta"), ...base };
    case "response.output_audio_transcript.done": return { type, response_id: stringField(value, "response_id"), item_id: stringField(value, "item_id"), output_index: integerField(value, "output_index"), content_index: integerField(value, "content_index"), transcript: stringField(value, "transcript"), ...base };
    case "response.text.delta": case "response.output_text.delta": return { type, response_id: stringField(value, "response_id"), item_id: stringField(value, "item_id"), delta: stringField(value, "delta"), ...(Number.isInteger(value.output_index) ? { output_index: value.output_index as number } : {}), ...(Number.isInteger(value.content_index) ? { content_index: value.content_index as number } : {}), ...base };
    case "response.function_call_arguments.delta": return { type, response_id: stringField(value, "response_id"), item_id: stringField(value, "item_id"), output_index: integerField(value, "output_index"), call_id: stringField(value, "call_id"), delta: stringField(value, "delta"), ...base };
    case "response.function_call_arguments.done": return { type, response_id: stringField(value, "response_id"), item_id: stringField(value, "item_id"), output_index: integerField(value, "output_index"), call_id: stringField(value, "call_id"), name: stringField(value, "name"), arguments: stringField(value, "arguments"), ...base };
    case "mcp_list_tools.in_progress": case "mcp_list_tools.completed": return { type, item_id: stringField(value, "item_id"), ...base };
    case "mcp_list_tools.failed": return { type, item_id: stringField(value, "item_id"), error: record(value.error, "error"), ...base };
    case "response.mcp_call_arguments.delta": return { type, response_id: stringField(value, "response_id"), item_id: stringField(value, "item_id"), call_id: stringField(value, "call_id"), delta: stringField(value, "delta"), ...base };
    case "response.mcp_call_arguments.done": return { type, response_id: stringField(value, "response_id"), item_id: stringField(value, "item_id"), call_id: stringField(value, "call_id"), name: stringField(value, "name"), arguments: stringField(value, "arguments"), ...base };
    case "response.mcp_call.in_progress": case "response.mcp_call.completed": return { type, item_id: stringField(value, "item_id"), output_index: integerField(value, "output_index"), ...base };
    case "response.mcp_call.failed": return { type, item_id: stringField(value, "item_id"), output_index: integerField(value, "output_index"), error: record(value.error, "error"), ...base };
    case "response.cancelled": return { type, ...optionalString(value, "response_id"), ...base };
    case "error": { const error = record(value.error, "error"); return { type, error: { message: stringField(error, "message"), ...(typeof error.code === "string" ? { code: error.code } : {}), ...(typeof error.type === "string" ? { type: error.type } : {}) }, ...base }; }
    default: throw new VoiceProtocolError("invalid_event", `unsupported realtime event type: ${type}`);
  }
}
