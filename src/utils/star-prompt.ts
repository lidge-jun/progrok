import { GITHUB_URL } from "../auth/constants.js";
import { readConfig, writeConfig } from "./config.js";
import { log } from "./logger.js";

export async function showStarPrompt(): Promise<void> {
  const config = readConfig();
  if (config.onboarding?.starPrompted) return;

  log.dim("─".repeat(50));
  log.info("⭐ If progrok is useful, star the repo!");
  log.dim(`   ${GITHUB_URL}`);
  log.dim("─".repeat(50) + "\n");

  writeConfig({
    ...config,
    onboarding: { ...config.onboarding, starPrompted: true },
  });
}
