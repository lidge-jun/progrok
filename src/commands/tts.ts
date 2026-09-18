import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import { Command } from "commander";
import { createTtsClient } from "../voice/tts.js";
import { log } from "../utils/logger.js";

const DEFAULT_TTS_VOICE = "eve";

export interface TtsCliOptions {
  voice?: string;
  language?: string;
  format?: "mp3" | "wav" | "pcm" | "mulaw" | "alaw";
  output?: string;
  stdout?: boolean;
  json?: boolean;
}

function decodeTtsJsonBody(body: unknown): {
  audio: string;
  contentType: string;
  duration?: number;
} {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("TTS JSON body must be an object");
  }
  const value = body as Record<string, unknown>;
  if (typeof value.audio !== "string" || typeof value.content_type !== "string") {
    throw new Error("TTS JSON body omitted audio or content_type");
  }
  return {
    audio: value.audio,
    contentType: value.content_type,
    ...(typeof value.duration === "number" ? { duration: value.duration } : {}),
  };
}

export function ttsCommand(): Command {
  return new Command("tts")
    .description("Synthesize speech with xAI TTS")
    .argument("<text>", "text to synthesize")
    .option("--voice <id>", "voice ID", DEFAULT_TTS_VOICE)
    .option("--language <code>", "BCP-47 language or auto", "auto")
    .option("--format <format>", "mp3|wav|pcm|mulaw|alaw", "mp3")
    .option("-o, --output <path>", "output audio path")
    .option("--stdout", "write raw audio bytes to stdout")
    .option("--json", "write result metadata as JSON")
    .action(async (text: string, opts: TtsCliOptions) => {
      try {
        if (opts.stdout && (opts.output || opts.json)) {
          throw new Error("--stdout cannot be combined with --output or --json");
        }
        const result = await createTtsClient().synthesize({
          voice_id: opts.voice ?? DEFAULT_TTS_VOICE,
          language: opts.language ?? "auto",
          text,
          output_format: { codec: opts.format ?? "mp3" },
        });
        const json = result.kind === "json" ? decodeTtsJsonBody(result.body) : undefined;
        const bytes = result.kind === "audio"
          ? result.bytes
          : new Uint8Array(Buffer.from(json!.audio, "base64"));
        const contentType = result.kind === "audio"
          ? result.contentType
          : json!.contentType;

        if (opts.stdout) {
          process.stdout.write(bytes);
          return;
        }

        const path = opts.output ?? `progrok-tts.${opts.format ?? "mp3"}`;
        writeFileSync(path, bytes);
        if (opts.json) {
          console.log(JSON.stringify({
            path,
            bytes: bytes.byteLength,
            contentType,
            kind: result.kind,
            ...(json?.duration !== undefined ? { duration: json.duration } : {}),
          }, null, 2));
        } else {
          log.success(`Audio saved: ${path}`);
        }
      } catch (error) {
        log.error((error as Error).message);
        process.exitCode = 1;
      }
    });
}
