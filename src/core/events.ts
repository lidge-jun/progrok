import type { AdapterErrorDetail } from "./errors.js";

export interface AdapterUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  raw?: Record<string, unknown>;
}

export type AdapterTerminalEvent =
  | {
      type: "done";
      protocol: "chat" | "responses";
      finishReason?: string;
      responseId?: string;
      usage?: AdapterUsage;
    }
  | {
      type: "incomplete";
      protocol: "responses";
      reason: string;
      responseId?: string;
      usage?: AdapterUsage;
    }
  | ({ type: "error" } & AdapterErrorDetail);

export type AdapterEvent =
  | { type: "heartbeat" }
  | { type: "text_delta"; text: string; itemId?: string }
  | { type: "reasoning_delta"; text: string; itemId?: string }
  | { type: "tool_call_start"; id: string; name: string; itemId?: string }
  | { type: "tool_call_delta"; id: string; arguments: string }
  | { type: "tool_call_end"; id: string }
  | AdapterTerminalEvent;

export function isTerminalEvent(event: AdapterEvent): event is AdapterTerminalEvent {
  return event.type === "done" || event.type === "incomplete" || event.type === "error";
}
