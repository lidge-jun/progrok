import express, { type Request, type Response } from "express";
import {
  XAI_API_BASE_URL,
  PROXY_DEFAULT_PORT,
  PROXY_DEFAULT_HOST,
} from "../auth/constants.js";
import { getValidBearerSnapshot } from "../auth/token-manager.js";
import { executeXaiFetch } from "../transport/fetch.js";
import { log } from "../utils/logger.js";
import { PayloadTooLargeError, readBoundedBody } from "./body.js";
import { prepareGrokRequestObject } from "./composer-inject.js";
import { serveNativeStream } from "./native-stream.js";
import { safeErrorMessage } from "./redact.js";
import { filterRequestHeaders, relayUpstreamResponse } from "./relay.js";
import { decideProxyRoute } from "./route-policy.js";

export interface ProxyAppDependencies {
  getBearer(): Promise<string>;
  fetchUpstream: typeof executeXaiFetch;
}

const DEFAULT_DEPS: ProxyAppDependencies = {
  getBearer: async () => (await getValidBearerSnapshot()).bearer,
  fetchUpstream: executeXaiFetch,
};

function sendUpstreamError(res: Response, error: unknown): void {
  if (res.destroyed) return;
  if (!res.headersSent) {
    res.status(502).json({
      error: {
        message: `Upstream error: ${safeErrorMessage(error)}`,
        type: "upstream_error",
      },
    });
    return;
  }
  log.dim(
    `[progrok] stream interrupted after response commit: ${safeErrorMessage(error)}`,
  );
  res.end();
}

export function createProxyApp(
  deps?: Partial<ProxyAppDependencies>,
): express.Express {
  const resolvedDeps: ProxyAppDependencies = {
    getBearer: deps?.getBearer ?? DEFAULT_DEPS.getBearer,
    fetchUpstream: deps?.fetchUpstream ?? DEFAULT_DEPS.fetchUpstream,
  };
  const app = express();

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", upstream: "xAI Grok", proxy: "progrok" });
  });

  app.all("/v1/*", (req: Request, res: Response) => {
    void handleProxy(req, res, resolvedDeps).catch((error: unknown) => {
      sendUpstreamError(res, error);
    });
  });

  return app;
}

async function handleProxy(
  req: Request,
  res: Response,
  deps: ProxyAppDependencies,
): Promise<void> {
  const relPath = req.path.replace(/^\/v1/, "");

  let bearer: string;
  try {
    bearer = await deps.getBearer();
  } catch (error) {
    res.status(401).json({
      error: { message: safeErrorMessage(error), type: "auth_error" },
    });
    return;
  }

  let body: Buffer;
  try {
    body = await readBoundedBody(req);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      res.status(413).json({
        error: {
          message: error.message,
          type: "payload_too_large",
        },
      });
      return;
    }
    throw error;
  }

  const rawContentType = req.headers["content-type"];
  const decision = decideProxyRoute({
    method: req.method,
    relPath,
    contentType: Array.isArray(rawContentType)
      ? rawContentType[0]
      : rawContentType,
    body,
  });
  let forwardBody = body;
  if (decision.kind !== "opaque-relay") {
    const prepared = prepareGrokRequestObject(relPath, decision.json);
    forwardBody = Buffer.from(JSON.stringify(prepared.value), "utf8");
  }

  const queryIndex = req.url.indexOf("?");
  const query = queryIndex >= 0 ? req.url.slice(queryIndex) : "";
  const controller = new AbortController();
  const abortUpstream = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(new Error("downstream request aborted"));
    }
  };
  req.once("aborted", abortUpstream);
  res.once("close", () => {
    if (!res.writableEnded) abortUpstream();
  });

  try {
    const upstream = await deps.fetchUpstream({
      method: req.method,
      pathWithQuery: `/v1${relPath}${query}`,
      headers: new Headers(filterRequestHeaders(req.headers)),
      body:
        forwardBody.length > 0 ? new Uint8Array(forwardBody) : undefined,
      signal: controller.signal,
    }, { bearer });

    if (decision.kind === "native-chat" || decision.kind === "native-responses") {
      const model = typeof decision.json.model === "string"
        ? decision.json.model
        : "unknown";
      const handled = await serveNativeStream({
        protocol: decision.kind === "native-chat" ? "chat" : "responses",
        upstream,
        downstream: res,
        model,
      });
      if (handled === "handled") return;
    }

    await relayUpstreamResponse(upstream, res);
  } catch (error) {
    sendUpstreamError(res, error);
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
