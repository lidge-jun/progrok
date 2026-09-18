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
}

export function sttCommand(): Command {
  return new Command("stt")
    .description("Transcribe an audio file with xAI STT")
    .argument("<file>", "audio file path")
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
          language: opts.language,
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
