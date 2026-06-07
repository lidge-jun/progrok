import { Command } from "commander";
import { getValidBearer } from "../auth/token-store.js";
import { XAI_API_BASE_URL } from "../auth/constants.js";
import { log } from "../utils/logger.js";

interface LanguageModel {
  id: string;
  input_modalities?: string[];
  output_modalities?: string[];
  prompt_text_token_price?: number;
  completion_text_token_price?: number;
  aliases?: string[];
}

interface SimpleModel {
  id: string;
}

function formatPrice(ticks: number | undefined): string {
  if (!ticks) return "-";
  // ticks = per-token price in 1e-10 USD; show per 1M tokens
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

export function modelsCommand(): Command {
  return new Command("models")
    .description("List available Grok models")
    .option("--detail", "Show pricing and aliases from /v1/language-models")
    .action(async (opts: { detail?: boolean }) => {
      try {
        const bearer = await getValidBearer();

        if (opts.detail) {
          const res = await fetch(`${XAI_API_BASE_URL}/language-models`, {
            headers: { Authorization: `Bearer ${bearer}` },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const data = (await res.json()) as { models: LanguageModel[] };

          log.info("Grok Models (detailed)\n");
          for (const m of data.models) {
            const input = (m.input_modalities || []).join(", ");
            const inPrice = formatPrice(m.prompt_text_token_price);
            const outPrice = formatPrice(m.completion_text_token_price);
            console.log(`  ${m.id}`);
            console.log(`    Input: ${input}  |  Price: ${inPrice}/1M in, ${outPrice}/1M out`);
            if (m.aliases && m.aliases.length > 0) {
              console.log(`    Aliases: ${m.aliases.slice(0, 5).join(", ")}${m.aliases.length > 5 ? ` (+${m.aliases.length - 5} more)` : ""}`);
            }
            console.log();
          }
          return;
        }

        const res = await fetch(`${XAI_API_BASE_URL}/models`, {
          headers: { Authorization: `Bearer ${bearer}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as { data: SimpleModel[] };

        log.info("Available Grok models:\n");
        for (const m of data.data) {
          const tag = MODEL_TAGS.find(([k]) => m.id.includes(k))?.[1] ?? "";
          console.log(`  ${m.id}${tag}`);
        }
        log.dim("\n  Use --detail for pricing and aliases");
      } catch (err) {
        log.error((err as Error).message);
        process.exit(1);
      }
    });
}
