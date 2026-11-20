import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Command } from "commander";
import { createSttClient } from "../voice/stt.js";
import { collectRefs } from "../utils/collect-refs.js";
import { log } from "../utils/logger.js";

export interface SttCliOptions {
  language?: string;
  diarize?: boolean;
  multichannel?: boolean;
  keyterm?: string[];
  json?: boolean;
  model?: string;
  fillerWords?: boolean;
  vadThreshold?: string;
  format?: boolean;
  audioFormat?: "pcm" | "mulaw" | "alaw";
  sampleRate?: string;
  channels?: string;
}

export function sttCommand(): Command {
  return new Command("stt")
    .description("Transcribe an audio file with xAI STT")
    .argument("<file>", "audio file path")
    .option("--model <id>", "transcription model")
    .option("--filler-words", "include filler words")
    .option("--vad-threshold <0..1>", "voice activity threshold")
    .option("--format", "apply inverse text normalization (requires --language)")
    .option("--audio-format <pcm|mulaw|alaw>", "raw audio format")
    .option("--sample-rate <hz>", "raw audio sample rate")
    .option("--channels <n>", "number of audio channels")
    .option("--language <code>", "BCP-47 language hint")
    .option("--diarize", "enable speaker diarization")
    .option("--multichannel", "transcribe channels separately")
    .option("--keyterm <term>", "key term hint (repeatable)", collectRefs, [])
    .option("--json", "output the full structured transcript")
    .action(async (file: string, opts: SttCliOptions) => {
      try {
        const result = await createSttClient().transcribe({
          file: new Blob([new Uint8Array(readFileSync(file))]),
          filename: basename(file),
          language: opts.language, model: opts.model, filler_words: opts.fillerWords, format: opts.format, audio_format: opts.audioFormat,
          vad_threshold: opts.vadThreshold === undefined ? undefined : Number(opts.vadThreshold),
          sample_rate: opts.sampleRate === undefined ? undefined : Number(opts.sampleRate) as import("../voice/tts.js").AudioSampleRate,
          channels: opts.channels === undefined ? undefined : Number(opts.channels),
          diarize: opts.diarize,
          multichannel: opts.multichannel,
          keyterm: opts.keyterm ?? [],
        });
        if (opts.json) console.log(JSON.stringify(result, null, 2));
        else console.log(result.text);
      } catch (error) {
        log.error((error as Error).message);
        process.exitCode = 1;
      }
    });
}
