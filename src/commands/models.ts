import { Command } from "commander";
import { ModelsClient } from "../surfaces/index.js";
import type { ModelFamily, XaiModel } from "../surfaces/models.js";
import { createXaiTransport } from "../transport/fetch.js";
import { log } from "../utils/logger.js";

function formatPrice(ticks: number | undefined): string {
  if (ticks == null) return "-";
  return `$${(ticks / 1e4).toFixed(2)}`;
}

const MODEL_TAGS: [string, string][] = [
  ["composer", " [composer]"],
  ["non-reasoning", " [fast]"],
  ["reasoning", " [reasoning]"],
  ["build", " [code]"],
  ["code", " [code]"],
  ["imagine-video", " [video]"],
  ["imagine", " [image]"],
];

const MODEL_KIND = {
  all: "models",
  language: "language-models",
  image: "image-generation-models",
  video: "video-generation-models",
  embedding: "embedding-models",
} as const satisfies Record<string, ModelFamily>;

function printDetailedModel(model: XaiModel): void {
  const input = Array.isArray(model.raw.input_modalities)
    ? model.raw.input_modalities
      .filter((value): value is string => typeof value === "string")
      .join(", ")
    : "";
  const inPrice = formatPrice(
    typeof model.raw.prompt_text_token_price === "number"
      ? model.raw.prompt_text_token_price
      : undefined,
  );
  const outPrice = formatPrice(
    typeof model.raw.completion_text_token_price === "number"
      ? model.raw.completion_text_token_price
      : undefined,
  );
  console.log(`  ${model.id}`);
  console.log(`    Input: ${input}  |  Price: ${inPrice}/1M in, ${outPrice}/1M out`);
  if (model.aliases.length > 0) {
    console.log(`    Aliases: ${model.aliases.slice(0, 5).join(", ")}${model.aliases.length > 5 ? ` (+${model.aliases.length - 5} more)` : ""}`);
  }
  console.log();
}

export function modelsCommand(): Command {
  return new Command("models")
    .description("List available Grok models")
    .option("--detail", "Show pricing and aliases from /v1/language-models")
    .option("--kind <kind>", "all|language|image|video|embedding", "all")
    .option("--json", "Output the live catalog as JSON")
    .action(async (opts: { detail?: boolean; kind?: string; json?: boolean }) => {
      try {
        const kind = opts.detail ? "language" : opts.kind ?? "all";
        const family = MODEL_KIND[kind as keyof typeof MODEL_KIND];
        if (!family) throw new Error(`invalid --kind '${kind}'`);
        const models = await new ModelsClient(createXaiTransport()).list(family);
        if (opts.json) {
          console.log(JSON.stringify({ source: `GET /v1/${family}`, models }, null, 2));
          return;
        }

        log.info(opts.detail ? "Grok Models (detailed)\n" : "Available Grok models:\n");
        for (const model of models) {
          if (opts.detail) printDetailedModel(model);
          else {
            const tag = MODEL_TAGS.find(([key]) => model.id.includes(key))?.[1] ?? "";
            console.log(`  ${model.id}${tag}`);
          }
        }
        if (!opts.detail) log.dim("\n  Use --detail for pricing and aliases");
      } catch (err) {
        log.error((err as Error).message);
        process.exit(1);
      }
    });
}
