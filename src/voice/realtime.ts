import {
  openVoiceSocket,
  type VoiceSocket,
  type VoiceWsAuth,
  type VoiceWsDeps,
} from "./ws-client.js";
import {
  PINNED_REALTIME_MODEL,
  parseRealtimeServerEvent,
  type RealtimeClientEvent,
  type RealtimeConversationItem,
  type RealtimeNormalizedEvent,
  type RealtimeReasoningEffort,
  type RealtimeSessionConfig,
  type RealtimeVoiceModel,
} from "./protocol.js";

export { PINNED_REALTIME_MODEL, REALTIME_MODEL_ALIAS } from "./protocol.js";
export type {
  RealtimeClientEvent,
  RealtimeConversationItem,
  RealtimeNormalizedEvent,
  RealtimeReasoningEffort,
  RealtimeServerEvent,
  RealtimeSessionConfig,
  RealtimeVoiceModel,
} from "./protocol.js";

export interface RealtimeState {
  phase: "connecting" | "ready" | "responding" | "closed" | "failed";
  conversationId?: string;
  responseId?: string;
  speechActive: boolean;
  lastDtmf?: string;
  errorCode?: string;
}

export function reduceRealtimeEvent(
  state: RealtimeState,
  event: RealtimeNormalizedEvent,
): RealtimeState {
  switch (event.type) {
    case "conversation.created":
      return { ...state, phase: "ready", conversationId: event.conversation.id };
    case "session.updated":
      return { ...state, phase: state.phase === "connecting" ? "ready" : state.phase };
    case "input_audio_buffer.speech_started":
      return { ...state, speechActive: true };
    case "input_audio_buffer.speech_stopped":
      return { ...state, speechActive: false };
    case "input_audio_buffer.dtmf_event_received":
      return { ...state, lastDtmf: event.event };
    case "response.created":
      return {
        ...state,
        phase: "responding",
        responseId: typeof event.response.id === "string" ? event.response.id : state.responseId,
      };
    case "response.done":
      return { ...state, phase: "ready", responseId: undefined };
    case "error":
      return { ...state, phase: "failed", errorCode: event.error.code };
    default:
      return state;
  }
}

export type RealtimeAuth =
  | { kind: "oauth" }
  | { kind: "ephemeral"; clientSecret: string };

export interface RealtimeOptions {
  auth: RealtimeAuth;
  model?: RealtimeVoiceModel;
  reasoningEffort?: RealtimeReasoningEffort;
  callId?: string;
  conversationId?: string;
  signal?: AbortSignal;
  deps?: VoiceWsDeps;
}

export interface RealtimeClient {
  ready(): Promise<void>;
  updateSession(config: RealtimeSessionConfig): void;
  appendAudioBase64(audio: string): void;
  appendAudioBinary(audio: Uint8Array): void;
  commitAudio(): void;
  clearAudio(): void;
  createItem(item: RealtimeConversationItem, previousItemId?: string): void;
  forceMessage(text: string, interruptible?: boolean): void;
  deleteItem(itemId: string): void;
  truncateItem(itemId: string, contentIndex: number, audioEndMs: number): void;
  createResponse(response?: Extract<RealtimeClientEvent, { type: "response.create" }>["response"]): void;
  cancelResponse(responseId?: string): void;
  events(): AsyncGenerator<RealtimeNormalizedEvent>;
  close(): void;
}

function validateSessionConfig(session: RealtimeSessionConfig): void {
  const vad = session.turn_detection;
  if (vad) {
    if (vad.threshold !== undefined && (vad.threshold < 0.1 || vad.threshold > 0.9)) {
      throw new RangeError("VAD threshold must be 0.1..0.9");
    }
    for (const [name, value] of [
      ["silence_duration_ms", vad.silence_duration_ms],
      ["prefix_padding_ms", vad.prefix_padding_ms],
    ] as const) {
      if (value !== undefined && (value < 0 || value > 10_000)) {
        throw new RangeError(`${name} must be 0..10000`);
      }
    }
  }
  const speed = session.audio?.output?.speed;
  if (speed !== undefined && (speed < 0.7 || speed > 1.5)) {
    throw new RangeError("output speed must be 0.7..1.5");
  }
  for (const tool of session.tools ?? []) {
    if (tool.type === "web_search" && tool.allowed_domains && tool.excluded_domains) {
      throw new RangeError("allowed_domains and excluded_domains are mutually exclusive");
    }
    if (tool.type === "x_search" && tool.allowed_x_handles && tool.excluded_x_handles) {
      throw new RangeError("allowed_x_handles and excluded_x_handles are mutually exclusive");
    }
  }
}

function makeRealtimeClient(socketPromise: Promise<VoiceSocket>): RealtimeClient {
  let socket: VoiceSocket | undefined;
  let dialFailed = false;
  let dialFailure: unknown;
  const settled = socketPromise.then(
    (value) => { socket = value; },
    (error: unknown) => { dialFailed = true; dialFailure = error; },
  );
  const ready = async (): Promise<void> => {
    await settled;
    if (dialFailed) throw dialFailure;
  };
  const withSocket = (run: (active: VoiceSocket) => void): void => {
    void settled.then(() => { if (socket) run(socket); });
  };
  const send = (event: RealtimeClientEvent): void => {
    withSocket((active) => active.sendJson(event));
  };

  return {
    ready,
    updateSession(session) {
      validateSessionConfig(session);
      send({ type: "session.update", session });
    },
    appendAudioBase64(audio) { send({ type: "input_audio_buffer.append", audio }); },
    appendAudioBinary(audio) { withSocket((active) => active.sendBinary(audio)); },
    commitAudio() { send({ type: "input_audio_buffer.commit" }); },
    clearAudio() { send({ type: "input_audio_buffer.clear" }); },
    createItem(item, previous_item_id) {
      send({ type: "conversation.item.create", item, ...(previous_item_id ? { previous_item_id } : {}) });
    },
    forceMessage(text, interruptible) {
      send({
        type: "conversation.item.create",
        item: {
          type: "force_message",
          role: "assistant",
          content: [{ type: "output_text", text }],
          ...(interruptible === undefined ? {} : { interruptible }),
        },
      });
    },
    deleteItem(item_id) { send({ type: "conversation.item.delete", item_id }); },
    truncateItem(item_id, content_index, audio_end_ms) {
      send({ type: "conversation.item.truncate", item_id, content_index, audio_end_ms });
    },
    createResponse(response) {
      send(response === undefined ? { type: "response.create" } : { type: "response.create", response });
    },
    cancelResponse(response_id) {
      send(response_id === undefined ? { type: "response.cancel" } : { type: "response.cancel", response_id });
    },
    async *events() {
      await ready();
      for await (const frame of socket!.frames()) {
        if (frame.kind === "binary") {
          yield { type: "response.output_audio.binary", bytes: frame.bytes };
          continue;
        }
        if (frame.kind === "close") return;
        let event;
        try { event = parseRealtimeServerEvent(frame.text); }
        catch (error) { socket!.close(1002, "invalid realtime event"); throw error; }
        if (event.type === "ping") send({ type: "pong", ping_timestamp: event.timestamp });
        yield event;
      }
    },
    close() { withSocket((active) => active.close()); },
  };
}

export function createRealtimeClient(opts: RealtimeOptions): RealtimeClient {
  if (opts.callId && opts.auth.kind === "ephemeral") {
    throw new RangeError("SIP call_id sessions require server-side bearer authentication");
  }
  const query = new URLSearchParams();
  if (!opts.callId) query.set("model", opts.model ?? PINNED_REALTIME_MODEL);
  if (opts.callId) query.set("call_id", opts.callId);
  if (opts.conversationId) query.set("conversation_id", opts.conversationId);
  if (opts.reasoningEffort) query.set("reasoning.effort", opts.reasoningEffort);
  const auth: VoiceWsAuth = opts.auth.kind === "oauth"
    ? { kind: "oauth" }
    : { kind: "ephemeral", clientSecret: opts.auth.clientSecret };
  return makeRealtimeClient(openVoiceSocket(`/v1/realtime?${query}`, auth, opts.signal, opts.deps ?? {}));
}
