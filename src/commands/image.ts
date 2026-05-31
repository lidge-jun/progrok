import { Command } from "commander";
import { getValidBearer } from "../auth/token-store.js";
import { XAI_API_BASE_URL } from "../auth/constants.js";
import { log } from "../utils/logger.js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_IMAGE_MODEL = "grok-imagine-image";

export interface ImageOptions {
  model?: string;
  aspect?: string;
  resolution?: string;
  ref?: string[];
  output?: string;
  json?: boolean;
  n?: string;
}

function imageToDataUri(filePath: string): string {
  const abs = resolve(filePath);
  const buf = readFileSync(abs);
  const ext = abs.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  return `data:image/${ext};base64,${buf.toString("base64")}`;
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
        const bearer = await getValidBearer();
        const refs = opts.ref ?? [];
        const n = parseInt(opts.n ?? "1", 10);
        const isEdit = refs.length > 0;

        const endpoint = isEdit ? "images/edits" : "images/generations";

        const body: Record<string, unknown> = {
          model: opts.model ?? DEFAULT_IMAGE_MODEL,
          prompt,
          n,
          response_format: "b64_json",
          aspect_ratio: opts.aspect ?? "1:1",
          resolution: opts.resolution ?? "1k",
        };

        if (isEdit) {
          if (refs.length === 1) {
            body.image = { type: "image_url", url: imageToDataUri(refs[0]) };
          } else {
            body.images = refs.map((r) => ({ type: "image_url", url: imageToDataUri(r) }));
          }
        }

        const res = await fetch(`${XAI_API_BASE_URL}/${endpoint}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`);
        }

        const data = (await res.json()) as {
          data: { b64_json?: string; url?: string; revised_prompt?: string }[];
          usage?: { cost_in_usd_ticks?: number };
        };

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        for (let i = 0; i < data.data.length; i++) {
          const item = data.data[i];
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

        if (data.usage?.cost_in_usd_ticks) {
          log.dim(`Cost: $${(data.usage.cost_in_usd_ticks / 10_000_000_000).toFixed(4)}`);
        }
      } catch (err) {
        log.error((err as Error).message);
        process.exit(1);
      }
    });
}

function collectRefs(value: string, prev: string[]): string[] {
  return [...prev, value];
}
