import { Command } from "commander";
import {
  DEFAULT_IMAGE_MODEL,
  USD_TICKS_DIVISOR,
} from "../auth/constants.js";
import { ImagesClient } from "../surfaces/index.js";
import { createXaiTransport } from "../transport/fetch.js";
import { log } from "../utils/logger.js";
import { writeFileSync } from "node:fs";
import { fileToDataUri } from "../utils/media.js";
import { collectRefs } from "../utils/collect-refs.js";
import { parseIntOrThrow } from "../utils/parse-int.js";

export interface ImageOptions {
  model?: string;
  aspect?: string;
  resolution?: string;
  ref?: string[];
  output?: string;
  json?: boolean;
  n?: string;
}

interface ImageOutput {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

function decodeImageOutput(value: unknown): ImageOutput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("image result must be an object");
  }
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.b64_json === "string" ? { b64_json: record.b64_json } : {}),
    ...(typeof record.url === "string" ? { url: record.url } : {}),
    ...(typeof record.revised_prompt === "string" ? { revised_prompt: record.revised_prompt } : {}),
  };
}

function imageCostTicks(usage: unknown): number | undefined {
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const ticks = (usage as Record<string, unknown>).cost_in_usd_ticks;
  return typeof ticks === "number" ? ticks : undefined;
}



export function imageCommand(): Command {
  return new Command("image")
    .description(
      `Generate or edit images with Grok Imagine.

  Examples:
    $ progrok image "A sunset over mountains"
    $ progrok image "Make it winter" --ref photo.jpg
    $ progrok image "prompt" --model grok-imagine-image-quality --resolution 2k`,
    )
    .argument("<prompt>", "image generation/edit prompt")
    .option("--model <id>", "image model", DEFAULT_IMAGE_MODEL)
    .option("--aspect <ratio>", "aspect ratio (1:1, 16:9, 9:16, etc.)", "1:1")
    .option("--resolution <r>", "1k or 2k", "1k")
    .option("--ref <path>", "reference image(s) for editing (repeatable)", collectRefs, [])
    .option("--output <path>", "output file path")
    .option("--json", "output structured JSON")
    .option("--n <count>", "number of images", "1")
    .action(async (prompt: string, opts: ImageOptions) => {
      try {
        const refs = opts.ref ?? [];
        const n = parseIntOrThrow(opts.n ?? "1", "n", 1, 10);
        const isEdit = refs.length > 0;

        const request: Parameters<ImagesClient["create"]>[0] = {
          model: opts.model ?? DEFAULT_IMAGE_MODEL,
          prompt,
          n,
          response_format: "b64_json",
          aspect_ratio: opts.aspect ?? "1:1",
          resolution: opts.resolution ?? "1k",
        };

        if (isEdit) {
          if (refs.length === 1) {
            request.image = { type: "image_url", url: fileToDataUri(refs[0], "image") };
          } else {
            request.images = refs.map((r) => ({ type: "image_url", url: fileToDataUri(r, "image") }));
          }
        }

        const data = await new ImagesClient(createXaiTransport()).create(request);

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        for (let i = 0; i < data.data.length; i++) {
          const item = decodeImageOutput(data.data[i]);
          if (item.b64_json) {
            const suffix = data.data.length > 1 ? `-${i + 1}` : "";
            const outPath = opts.output
              ? opts.output.replace(/(\.\w+)$/, `${suffix}$1`)
              : `progrok-image${suffix}.png`;
            writeFileSync(outPath, Buffer.from(item.b64_json, "base64"));
            log.success(`Image saved: ${outPath}`);
          } else if (item.url) {
            log.info(`Image URL: ${item.url}`);
          }
          if (item.revised_prompt) {
            log.dim(`Revised: ${item.revised_prompt.slice(0, 100)}`);
          }
        }

        const costTicks = imageCostTicks(data.usage);
        if (costTicks) {
          log.dim(`Cost: $${(costTicks / USD_TICKS_DIVISOR).toFixed(4)}`);
        }
      } catch (err) {
        log.error((err as Error).message);
        process.exit(1);
      }
    });
}
