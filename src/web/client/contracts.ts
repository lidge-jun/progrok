export type TurnStatus =
  | "composing"
  | "queued"
  | "streaming"
  | "complete"
  | "stopped"
  | "failed";

export interface ModelRecord {
  id: string;
  object?: string;
  owned_by?: string;
}

export interface ToolView {
  id: string;
  type: string;
  name?: string;
  status: "queued" | "running" | "complete" | "failed";
  argumentsText: string;
  outputText?: string;
  citations: Array<{ title: string; url: string }>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoningSummary: string;
  tools: ToolView[];
  status: TurnStatus;
}

export interface ChatSession {
  id: string;
  model: string;
  title: string;
  createdAt: number;
  messages: ChatMessage[];
}

export type VoiceMode = "stt" | "realtime";
export type VoiceStatus =
  | "idle"
  | "requesting-permission"
  | "minting-secret"
  | "connecting"
  | "listening"
  | "responding"
  | "speaking"
  | "stopped"
  | "failed";

export interface ImageResult {
  url: string;
  revisedPrompt?: string;
}

export interface VideoJob {
  requestId: string;
  status: "pending" | "done" | "failed" | "expired";
  progress?: number;
  videoUrl?: string;
  error?: string;
}
