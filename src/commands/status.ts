import { Command } from "commander";
import { loadTokens } from "../auth/token-store.js";
import { log } from "../utils/logger.js";

export function statusCommand(): Command {
  return new Command("status")
    .description("Show authentication status")
    .action(() => {
      const tokens = loadTokens();
      if (!tokens?.accessToken) {
        log.info("Status: Not logged in");
        log.dim("Run `progrok login` to authenticate.");
        return;
      }

      const expired =
        tokens.expiresAt !== undefined && Date.now() >= tokens.expiresAt;
      const hasRefresh = !!tokens.refreshToken;

      log.info("Status: Logged in");
      if (tokens.email) log.info(`  Account: ${tokens.email}`);
      if (tokens.expiresAt) {
        const remaining = Math.max(
          0,
          Math.floor((tokens.expiresAt - Date.now()) / 60000),
        );
        log.info(
          `  Token:   ${expired ? "expired" : `valid (${remaining} min remaining)`}`,
        );
      }
      log.info(`  Refresh: ${hasRefresh ? "available" : "none"}`);
    });
}
