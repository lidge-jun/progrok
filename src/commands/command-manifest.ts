export const COMMAND_NAMES = [
  "login",
  "logout",
  "proxy",
  "chat",
  "models",
  "status",
  "skill",
  "capabilities",
  "search",
  "video",
  "image",
  "billing",
  "tts",
  "stt",
  "live",
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

/** Pinned operational default, not a claim about the live model catalog. */
export const DEFAULT_LIVE_MODEL = "grok-voice-latest";

export interface CommandManifestEntry {
  name: CommandName;
  summary: string;
  mutatesRemote: boolean;
  json: boolean;
}

export const COMMAND_MANIFEST: CommandManifestEntry[] = [
  { name: "login", summary: "Authenticate with xAI OAuth.", mutatesRemote: true, json: false },
  { name: "logout", summary: "Remove local xAI credentials.", mutatesRemote: false, json: false },
  { name: "proxy", summary: "Run the local HTTP /v1 proxy.", mutatesRemote: false, json: false },
  { name: "chat", summary: "Open the local Grok web chat.", mutatesRemote: false, json: false },
  { name: "models", summary: "Read the live xAI model catalogs.", mutatesRemote: false, json: true },
  { name: "status", summary: "Inspect local authentication status.", mutatesRemote: false, json: false },
  { name: "skill", summary: "Print the packaged progrok skill.", mutatesRemote: false, json: true },
  { name: "capabilities", summary: "Print commands, endpoints, and live catalog metadata.", mutatesRemote: false, json: true },
  { name: "search", summary: "Search the web and X through Responses.", mutatesRemote: true, json: true },
  { name: "video", summary: "Generate, edit, or extend video.", mutatesRemote: true, json: true },
  { name: "image", summary: "Generate or edit images.", mutatesRemote: true, json: true },
  { name: "billing", summary: "Read subscription billing and usage.", mutatesRemote: false, json: true },
  { name: "tts", summary: "Synthesize speech to a file or stdout.", mutatesRemote: true, json: true },
  { name: "stt", summary: "Transcribe an audio file.", mutatesRemote: true, json: true },
  { name: "live", summary: "Bridge Realtime events over NDJSON stdin/stdout.", mutatesRemote: true, json: true },
];
