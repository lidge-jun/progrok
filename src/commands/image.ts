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
  quality?: string;
  ref?: string[];
  output?: string;
  json?: boolean;
  n?: string;
}

interface ImageOutput {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
  mime_type?: string;
}

function decodeImageOutput(value: unknown): ImageOutput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("image result must be an object");
  }
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.mime_type === "string" ? { mime_type: record.mime_type } : {}),
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



export function imageExtension(item: { mime_type?: string }, bytes: Buffer): "jpg" | "png" | "webp" {
  const mime = item.mime_type?.toLowerCase().split(";")[0].trim();
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) return "jpg";
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return "jpg";
}

export function imageCommand(): Command {
  return new Command("image")
    .description(
      `Generate or edit images with Grok Imagine.

  Examples:
    $ progrok image "A sunset over mountains"
    $ progrok image "Make it winter" --ref photo.jpg
    $ progrok image "prompt" --quality medium --resolution 2k`,
    )
    .argument("<prompt>", "image generation/edit prompt")
    .option("--model <id>", "image model", DEFAULT_IMAGE_MODEL)
    .option("--aspect <ratio>", "aspect ratio (1:1, 16:9, 9:16, 21:9, 5:2, etc.)", "1:1")
    .option("--resolution <r>", "1k, 1.5k or 2k", "1k")
    .option("--quality <q>", "low, medium or auto (image 2.0)")
    .option("--ref <path>", "reference image(s) for editing (repeatable)", collectRefs, [])
    .option("--output <path>", "output file path")
    .option("--json", "output structured JSON")
    .option("--n <count>", "number of images", "1")
    .action(async (prompt: string, opts: ImageOptions) => {
      try {
        const refs = opts.ref ?? [];
        const n = parseIntOrThrow(opts.n ?? "1", "n", 1, 10);
        const isEdit = refs.length > 0;
        if (refs.length > 5) throw new Error("image editing accepts at most 5 source images");
        if (!["1k", "1.5k", "2k"].includes(opts.resolution ?? "1k")) throw new Error("--resolution must be 1k, 1.5k or 2k");
        if (opts.quality && !["low", "medium", "auto"].includes(opts.quality)) throw new Error("--quality must be low, medium or auto (grok-imagine-image-2.0)");
        if (opts.quality && !(opts.model ?? DEFAULT_IMAGE_MODEL).includes("image-2")) throw new Error("--quality needs grok-imagine-image-2.0");

        const request: Parameters<ImagesClient["create"]>[0] = {
          model: opts.model ?? DEFAULT_IMAGE_MODEL,
          prompt,
          n,
          response_format: "b64_json",
          aspect_ratio: opts.aspect ?? "1:1",
          resolution: opts.resolution ?? "1k",
          ...(opts.quality ? { quality: opts.quality as "low" | "medium" | "auto" } : {}),
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
            const bytes = Buffer.from(item.b64_json, "base64");
            const outPath = opts.output
              ? opts.output
              : `progrok-image${suffix}.${imageExtension(item, bytes)}`;
            writeFileSync(outPath, bytes);
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
