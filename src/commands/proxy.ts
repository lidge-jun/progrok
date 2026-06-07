import { Command } from "commander";
import { startProxy } from "../proxy/server.js";
import { loadTokens } from "../auth/token-store.js";
import {
  PROXY_DEFAULT_PORT,
  PROXY_DEFAULT_HOST,
} from "../auth/constants.js";
import { log } from "../utils/logger.js";
import { parseIntOrThrow } from "../utils/parse-int.js";

export function proxyCommand(): Command {
  return new Command("proxy")
    .description(
      `Start OpenAI-compatible proxy server for Grok.
  Forwards ALL /v1/* requests to api.x.ai with your OAuth token injected.
  Any client (curl, OpenAI SDK, LangChain, etc.) can connect — no API key needed.
  Supports streaming (SSE), multipart (stt), and binary responses (tts).`,
    )
    .option("-p, --port <port>", "Port number", String(PROXY_DEFAULT_PORT))
    .option("--host <host>", "Host to bind", PROXY_DEFAULT_HOST)
    .action(async (opts: { port: string; host: string }) => {
      const tokens = loadTokens();
      if (!tokens?.accessToken) {
        log.error("Not logged in. Run `progrok login` first.");
        process.exit(1);
      }

      try {
        await startProxy(parseIntOrThrow(opts.port, "port", 1, 65535), opts.host);
        await new Promise(() => {});
      } catch (err) {
        log.error((err as Error).message);
        process.exit(1);
      }
    });
}
