import { createServer, type Server } from "node:http";
import {
  XAI_OAUTH_CALLBACK_HOST,
  XAI_OAUTH_CALLBACK_PORT,
  XAI_OAUTH_CALLBACK_PATH,
  XAI_OAUTH_CORS_ORIGINS,
  XAI_OAUTH_TIMEOUT_MS,
} from "./constants.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface CallbackResult {
  code: string;
  state: string;
}

export function startCallbackServer(
  expectedState: string,
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    let server: Server | undefined;

    const timeout = setTimeout(() => {
      server?.close();
      reject(new Error("OAuth callback timed out (5 minutes)"));
    }, XAI_OAUTH_TIMEOUT_MS);

    server = createServer((req, res) => {
      const url = new URL(
        req.url || "/",
        `http://${XAI_OAUTH_CALLBACK_HOST}`,
      );

      if (req.method === "OPTIONS") {
        const origin = req.headers.origin || "";
        try {
          const originHost = new URL(origin).hostname;
          if (XAI_OAUTH_CORS_ORIGINS.includes(originHost)) {
            res.writeHead(204, {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Methods": "GET",
              "Access-Control-Allow-Headers": "Content-Type",
            });
          } else {
            res.writeHead(204);
          }
        } catch {
          res.writeHead(204);
        }
        res.end();
        return;
      }

      if (url.pathname !== XAI_OAUTH_CALLBACK_PATH) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        const desc = url.searchParams.get("error_description") || error;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<html><body><h2>Login failed</h2><p>${escapeHtml(desc)}</p><p>You can close this tab.</p></body></html>`,
        );
        clearTimeout(timeout);
        server?.close();
        reject(new Error(`OAuth error: ${desc}`));
        return;
      }

      if (!code || state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Invalid callback</h2></body></html>");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body style="font-family:system-ui;text-align:center;padding:60px">` +
          `<h2>Logged in to progrok</h2>` +
          `<p>You can close this tab and return to the terminal.</p>` +
          `</body></html>`,
      );

      clearTimeout(timeout);
      server?.close();
      resolve({ code, state });
    });

    server.listen(XAI_OAUTH_CALLBACK_PORT, XAI_OAUTH_CALLBACK_HOST, () => {});

    server.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      reject(new Error(`Callback server failed: ${err.message}`));
    });
  });
}
