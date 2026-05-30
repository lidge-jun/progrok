import express from "express";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProxyApp } from "../proxy/server.js";
import { CHAT_DEFAULT_PORT, PROXY_DEFAULT_HOST } from "../auth/constants.js";
import { openUrl } from "../utils/open-url.js";
import { log } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function startChat(
  port = CHAT_DEFAULT_PORT,
  host = PROXY_DEFAULT_HOST,
): Promise<void> {
  const app = createProxyApp();

  const publicDir = join(__dirname, "public");
  app.use(express.static(publicDir));

  app.get("/", (_req, res) => {
    res.sendFile(join(publicDir, "index.html"));
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      log.success(`progrok chat running at ${url}`);
      log.dim(`Proxy also available at ${url}/v1`);
      log.info("Press Ctrl+C to stop.\n");
      void openUrl(url);
      resolve();
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      reject(new Error(`Chat server failed: ${err.message}`));
    });

    process.on("SIGINT", () => {
      log.info("\nprogrok chat stopped.");
      server.close();
      process.exit(0);
    });
  });
}
