// QA-only harness. Serves the built web app with mocked xAI endpoints.
// Not part of the shipped product. See devlog/_plan/260918_web_ui_redesign/070_verification.md
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const ROOT = resolve(process.argv[2] ?? "dist/public");
const PORT = Number(process.argv[3] ?? 18747);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

const MODELS = [
  { id: "grok-4.3", object: "model", created: 0, owned_by: "xai" },
  { id: "grok-4.3-fast-reasoning", object: "model", created: 0, owned_by: "xai" },
  { id: "grok-composer-2.5", object: "model", created: 0, owned_by: "xai" },
  { id: "grok-build-0.1", object: "model", created: 0, owned_by: "xai" },
  { id: "grok-imagine-image-0.9", object: "model", created: 0, owned_by: "xai" },
  { id: "grok-imagine-video-0.9", object: "model", created: 0, owned_by: "xai" },
];

const SCRIPT = [
  { type: "response.output_text.delta", delta: "The OAuth bridge keeps the refresh token " },
  { type: "response.output_text.delta", delta: "on this machine and injects the bearer per request.\n\n" },
  { type: "response.output_text.delta", delta: "Point any OpenAI-compatible client at 127.0.0.1:18645 and " },
  { type: "response.output_text.delta", delta: "send a placeholder key." },
  { type: "response.completed" },
];

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(payload);
}

async function serveStatic(req, res) {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const target = path === "/" ? "/index.html" : path;
  try {
    const file = await readFile(join(ROOT, target));
    res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  res.setHeader(
    "content-security-policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self' wss://api.x.ai",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
    ].join("; "),
  );

  if (url.pathname === "/v1/models") {
    if (process.env.PROGROK_HARNESS_FAIL_CATALOG === "1") {
      return json(res, 500, { error: { message: "catalog unavailable" } });
    }
    return json(res, 200, { object: "list", data: MODELS });
  }
  if (url.pathname === "/v1/realtime/client_secrets") {
    return json(res, 200, { value: "mock-secret", expires_at: Date.now() + 60_000 });
  }
  if (url.pathname === "/v1/images/generations") {
    const pixel =
      "data:image/svg+xml;base64," +
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#14342c"/><circle cx="320" cy="320" r="150" fill="#22b795"/></svg>',
      ).toString("base64");
    return json(res, 200, { data: [{ url: pixel, revised_prompt: "mock" }] });
  }
  if (url.pathname === "/v1/videos/generations") {
    return json(res, 200, { id: "vid_mock_1", status: "queued", progress: 0 });
  }
  if (url.pathname.startsWith("/v1/videos/")) {
    return json(res, 200, { id: "vid_mock_1", status: "processing", progress: 0.42 });
  }
  if (url.pathname === "/v1/responses" && req.method === "POST") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    let index = 0;
    const timer = setInterval(() => {
      if (index >= SCRIPT.length) {
        clearInterval(timer);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.write(`data: ${JSON.stringify(SCRIPT[index])}\n\n`);
      index += 1;
    }, 220);
    req.on("close", () => clearInterval(timer));
    return undefined;
  }
  return serveStatic(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`harness on http://127.0.0.1:${PORT} serving ${ROOT}\n`);
});

