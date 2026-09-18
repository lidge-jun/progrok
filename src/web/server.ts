import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_DEFAULT_PORT,
  PROXY_DEFAULT_HOST,
} from "../auth/constants.js";
import { createProxyApp } from "../proxy/server.js";
import { log } from "../utils/logger.js";
import { openUrl } from "../utils/open-url.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

const WEB_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self' wss://api.x.ai",
  "img-src 'self' data: blob: https://assets.grok.com https://*.x.ai",
  "media-src 'self' blob: https://assets.grok.com https://*.x.ai",
  "worker-src 'self' blob:",
].join("; ");

export interface WebAppOptions {
  publicDir?: string;
}

export function applyWebSecurityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("Content-Security-Policy", WEB_CSP);
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(self)",
  );
  next();
}

export function createWebApp(
  options: WebAppOptions = {},
): express.Application {
  const app = express();
  const publicDir = options.publicDir
    ? resolve(options.publicDir)
    : join(MODULE_DIR, "public");

  app.use(applyWebSecurityHeaders);
  app.use("/v1/realtime/client_secrets", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    next();
  });
  app.use(createProxyApp());
  app.use(express.static(publicDir, { etag: true, maxAge: 0, index: false }));
  app.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(publicDir, "index.html"));
  });
  return app;
}

export async function startWebApp(
  port = CHAT_DEFAULT_PORT,
  host = PROXY_DEFAULT_HOST,
): Promise<void> {
  const app = createWebApp();
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      log.success(`progrok web app running at ${url}`);
      log.dim(`REST proxy available at ${url}/v1`);
      log.info("Press Ctrl+C to stop.\n");
      void openUrl(url);
      resolve();
    });
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(new Error(`Web app failed: ${error.message}`));
    });
    process.once("SIGINT", () => {
      log.info("\nprogrok web app stopped.");
      server.close(() => process.exit(0));
    });
  });
}
