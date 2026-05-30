import { Command } from "commander";
import { getValidBearer } from "../auth/token-store.js";
import { XAI_API_BASE_URL } from "../auth/constants.js";
import { log } from "../utils/logger.js";

export function modelsCommand(): Command {
  return new Command("models")
    .description("List available Grok models")
    .action(async () => {
      try {
        const bearer = await getValidBearer();
        const res = await fetch(`${XAI_API_BASE_URL}/models`, {
          headers: { Authorization: `Bearer ${bearer}` },
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch models: HTTP ${res.status}`);
        }

        const data = (await res.json()) as {
          data: Array<{ id: string; owned_by?: string }>;
        };

        log.info("Available Grok models:\n");
        for (const m of data.data) {
          const tag = m.id.includes("reasoning")
            ? " [reasoning]"
            : m.id.includes("non-reasoning")
              ? " [fast]"
              : m.id.includes("build")
                ? " [code]"
                : m.id.includes("imagine")
                  ? " [image]"
                  : "";
          console.log(`  ${m.id}${tag}`);
        }
      } catch (err) {
        log.error((err as Error).message);
        process.exit(1);
      }
    });
}
