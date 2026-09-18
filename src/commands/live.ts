import { createInterface, type Interface } from "node:readline";
import { Command } from "commander";
import {
  createRealtimeClient,
  type RealtimeClient,
} from "../voice/realtime.js";
import {
  REALTIME_CLIENT_EVENT_TYPES,
  type RealtimeClientEvent,
  type RealtimeReasoningEffort,
  type RealtimeVoiceModel,
} from "../voice/protocol.js";
import { log } from "../utils/logger.js";
import { DEFAULT_LIVE_MODEL } from "./command-manifest.js";

export interface LiveCliOptions {
  model?: RealtimeVoiceModel;
  conversationId?: string;
  reasoning?: RealtimeReasoningEffort;
  event?: string[];
  stdin?: boolean;
  once?: boolean;
}

function collectEvent(value: string, previous: string[]): string[] {
  return previous.concat(value);
}

type LiveClientEvent = Exclude<RealtimeClientEvent, { type: "pong" }>;

function parseRealtimeModel(value: string): RealtimeVoiceModel {
  if (value !== "grok-voice-think-fast-2.0" && value !== "grok-voice-latest") {
    throw new Error("--model must be grok-voice-think-fast-2.0 or grok-voice-latest");
  }
  return value;
}

function parseReasoningEffort(value: string): RealtimeReasoningEffort {
  if (value !== "low" && value !== "medium" && value !== "high") {
    throw new Error("--reasoning must be low, medium, or high");
  }
  return value;
}

function parseClientEvent(line: string): LiveClientEvent {
  const wire: unknown = JSON.parse(line);
  if (wire === null || typeof wire !== "object" || Array.isArray(wire)) {
    throw new Error("live event must be a JSON object");
  }
  const type = (wire as { type?: unknown }).type;
  if (typeof type !== "string" || type.length === 0) {
    throw new Error("live event.type is required");
  }
  if (type === "pong") {
    throw new Error("pong is managed automatically by the realtime client");
  }
  if (!(REALTIME_CLIENT_EVENT_TYPES as readonly string[]).includes(type)) {
    throw new Error(`unsupported live event type: ${type}`);
  }
  return wire as LiveClientEvent;
}

function sendClientEvent(client: RealtimeClient, event: LiveClientEvent): void {
  switch (event.type) {
    case "session.update": client.updateSession(event.session); return;
    case "input_audio_buffer.append": client.appendAudioBase64(event.audio); return;
    case "input_audio_buffer.commit": client.commitAudio(); return;
    case "input_audio_buffer.clear": client.clearAudio(); return;
    case "conversation.item.create": client.createItem(event.item, event.previous_item_id); return;
    case "conversation.item.delete": client.deleteItem(event.item_id); return;
    case "conversation.item.truncate": client.truncateItem(event.item_id, event.content_index, event.audio_end_ms); return;
    case "response.create": client.createResponse(event.response); return;
    case "response.cancel": client.cancelResponse(event.response_id); return;
  }
}

export function liveCommand(): Command {
  return new Command("live")
    .description("Bridge xAI Realtime events over NDJSON stdin/stdout (no microphone capture)")
    .option("--model <id>", "pinned Voice model or latest alias", parseRealtimeModel, DEFAULT_LIVE_MODEL)
    .option("--conversation-id <id>", "resume an existing conversation")
    .option("--reasoning <effort>", "low|medium|high", parseReasoningEffort)
    .option("--event <json>", "send one client event (repeatable)", collectEvent, [])
    .option("--no-stdin", "do not read additional NDJSON events from stdin")
    .option("--once", "exit after the first response.done or error")
    .action(async (opts: LiveCliOptions) => {
      const stop = new AbortController();
      const onSigint = (): void => stop.abort();
      process.once("SIGINT", onSigint);
      let session: RealtimeClient | undefined;
      let lines: Interface | undefined;
      let inputFailure: unknown;

      try {
        session = createRealtimeClient({
          auth: { kind: "oauth" },
          model: opts.model ?? DEFAULT_LIVE_MODEL,
          conversationId: opts.conversationId,
          reasoningEffort: opts.reasoning,
          signal: stop.signal,
        });
        for (const encoded of opts.event ?? []) {
          sendClientEvent(session, parseClientEvent(encoded));
        }
        if (opts.stdin !== false) {
          lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
          void (async () => {
            for await (const line of lines!) {
              if (line.trim()) sendClientEvent(session!, parseClientEvent(line));
            }
          })().catch((error) => {
            inputFailure = error;
            stop.abort(error);
          });
        }
        for await (const event of session.events()) {
          process.stdout.write(`${JSON.stringify(event)}\n`);
          if (opts.once && (event.type === "response.done" || event.type === "error")) {
            break;
          }
        }
        if (inputFailure !== undefined) throw inputFailure;
      } catch (error) {
        log.error((error as Error).message);
        process.exitCode = 1;
      } finally {
        lines?.close();
        session?.close();
        process.removeListener("SIGINT", onSigint);
      }
    });
}
