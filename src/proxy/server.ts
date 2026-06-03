import express, { type Request, type Response } from "express";
import {
  XAI_API_BASE_URL,
  PROXY_DEFAULT_PORT,
  PROXY_DEFAULT_HOST,
} from "../auth/constants.js";
import { getValidBearer } from "../auth/token-store.js";
import { log } from "../utils/logger.js";

const MAX_BODY_BYTES = 100 * 1024 * 1024; // 100 MB

const HOP_BY_HOP = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "authorization",
]);

function filterHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && value) {
      out[key] = Array.isArray(value) ? value[0] : value;
    }
  }
  return out;
}

export function createProxyApp(): express.Application {
  const app = express();

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", upstream: "xAI Grok", proxy: "progrok" });
  });

  app.all("/v1/*", (req: Request, res: Response) => {
    void handleProxy(req, res);
  });

  return app;
}

async function handleProxy(req: Request, res: Response): Promise<void> {
  const relPath = req.path.replace(/^\/v1/, "");

  let bearer: string;
  try {
    bearer = await getValidBearer();
  } catch (err) {
    res.status(401).json({
      error: { message: (err as Error).message, type: "auth_error" },
    });
    return;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    totalBytes += buf.length;
    if (totalBytes > MAX_BODY_BYTES) {
      res.status(413).json({
        error: {
          message: `Request body exceeds ${MAX_BODY_BYTES / 1024 / 1024}MB limit`,
          type: "payload_too_large",
        },
      });
      return;
    }
    chunks.push(buf);
  }
  const body = Buffer.concat(chunks);

  const qsIdx = req.url.indexOf("?");
  const qs = qsIdx >= 0 ? req.url.slice(qsIdx) : "";
  const upstreamUrl = `${XAI_API_BASE_URL}${relPath}${qs}`;
  const fwdHeaders = filterHeaders(
    req.headers as Record<string, string>,
  );
  fwdHeaders["Authorization"] = `Bearer ${bearer}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: fwdHeaders,
      body: body.length > 0 ? body : undefined,
    });

    res.status(upstream.status);

    for (const [key, value] of upstream.headers) {
      const lower = key.toLowerCase();
      if (
        !HOP_BY_HOP.has(lower) &&
        lower !== "content-encoding" &&
        lower !== "content-length"
      ) {
        res.setHeader(key, value);
      }
    }

    if (upstream.body) {
      const reader = (
        upstream.body as ReadableStream<Uint8Array>
      ).getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } catch {
        /* stream interrupted */
      }
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({
        error: {
          message: `Upstream error: ${(err as Error).message}`,
          type: "upstream_error",
        },
      });
    }
  }
}

export async function startProxy(
  port = PROXY_DEFAULT_PORT,
  host = PROXY_DEFAULT_HOST,
): Promise<void> {
  const app = createProxyApp();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      log.success("progrok proxy running");
      log.info(`  Listening:    http://${host}:${port}/v1`);
      log.info(`  Forwarding:   ${XAI_API_BASE_URL}`);
      if (host === "0.0.0.0" || host === "::") {
        log.error(
          "  ⚠ Bound to all interfaces — your OAuth token is accessible on the local network!",
        );
      }
      log.dim(
        "  Client auth:  any bearer token (proxy injects your OAuth credential)",
      );
      log.info("\nPress Ctrl+C to stop.\n");
      resolve();
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      reject(new Error(`Proxy failed to start: ${err.message}`));
    });

    process.on("SIGINT", () => {
      log.info("\nprogrok proxy stopped.");
      server.close();
      process.exit(0);
    });
  });
}
