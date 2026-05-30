import { Command } from "commander";
import { startChat } from "../chat/server.js";
import { loadTokens } from "../auth/token-store.js";
import {
  CHAT_DEFAULT_PORT,
  PROXY_DEFAULT_HOST,
} from "../auth/constants.js";
import { log } from "../utils/logger.js";

export function chatCommand(): Command {
  return new Command("chat")
    .description("Open Grok chat in your browser")
    .option("-p, --port <port>", "Port number", String(CHAT_DEFAULT_PORT))
    .option("--host <host>", "Host to bind", PROXY_DEFAULT_HOST)
    .action(async (opts: { port: string; host: string }) => {
      const tokens = loadTokens();
      if (!tokens?.accessToken) {
        log.error("Not logged in. Run `progrok login` first.");
        process.exit(1);
      }

      try {
        await startChat(parseInt(opts.port, 10), opts.host);
        await new Promise(() => {});
      } catch (err) {
        log.error((err as Error).message);
        process.exit(1);
      }
    });
}
