import {
  XAI_VOICE_WS_ORIGIN,
  ephemeralProtocols,
  type EphemeralClientSecret,
} from "../../voice/protocol.js";
import type { VoiceMode } from "./contracts.js";

export interface VoiceSocketSpec {
  url: string;
  protocols: string[];
}

export function buildVoiceSocketSpec(
  mode: VoiceMode,
  secret: EphemeralClientSecret,
  options: { model: string; conversationId?: string },
): VoiceSocketSpec {
  const path = mode === "stt" ? "stt" : "realtime";
  const url = new URL(`${XAI_VOICE_WS_ORIGIN}/v1/${path}`);
  if (mode === "stt") {
    url.searchParams.set("encoding", "pcm");
    url.searchParams.set("sample_rate", "16000");
    url.searchParams.set("interim_results", "true");
    url.searchParams.set("endpointing", "400");
  } else {
    url.searchParams.set("model", options.model);
    if (options.conversationId) {
      url.searchParams.set("conversation_id", options.conversationId);
    }
  }
  return { url: url.href, protocols: ephemeralProtocols(secret.value) };
}
