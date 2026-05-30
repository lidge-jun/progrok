import { Command } from "commander";
import { deleteTokens } from "../auth/token-store.js";
import { log } from "../utils/logger.js";

export function logoutCommand(): Command {
  return new Command("logout")
    .description("Remove stored xAI credentials")
    .action(() => {
      deleteTokens();
      log.success("Logged out. Credentials removed.");
    });
}
