import type { RealtimeClientEvent } from "../../voice/protocol.js";

/**
 * Stateless helpers for the voice client. They are here rather than on the
 * controller because they read nothing from it — keeping them out keeps the
 * controller about connection lifecycle and UI state.
 */

export function describeMediaError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone permission was denied. Allow it for this site in your browser settings, then start again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone input was found. Connect a device and start again.";
  }
  if (name === "NotReadableError") {
    return "The microphone is busy in another application. Close it and start again.";
  }
  return error instanceof Error ? error.message : String(error);
}

export function buildSessionUpdate(
  voice: string,
): Extract<RealtimeClientEvent, { type: "session.update" }> {
  return {
    type: "session.update",
    session: {
      voice,
      reasoning: { effort: "high" },
      turn_detection: {
        type: "server_vad",
        threshold: 0.85,
        silence_duration_ms: 500,
        prefix_padding_ms: 333,
        idle_timeout_ms: 10000,
      },
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          transport: "binary",
          transcription: { model: "grok-transcribe" },
        },
        output: {
          format: { type: "audio/pcm", rate: 24000 },
          transport: "binary",
          speed: 1,
        },
      },
      resumption: { enabled: true },
    },
  };
}

