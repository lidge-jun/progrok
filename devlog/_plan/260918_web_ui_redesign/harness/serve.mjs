// QA-only harness. Serves the built web app with mocked xAI endpoints.
// Not part of the shipped product. See devlog/_plan/260918_web_ui_redesign/070_verification.md
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(process.argv[2] ?? "dist/public");
const PORT = Number(process.argv[3] ?? 18747);
const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

const MODELS = [
  { id: "grok-4.6", object: "model", created: 0, owned_by: "xai" },
  { id: "grok-4.5", object: "model", created: 0, owned_by: "xai" },
  { id: "grok-composer-2.5-fast", object: "model", created: 0, owned_by: "xai" },
  { id: "grok-build-0.1", object: "model", created: 0, owned_by: "xai" },
  { id: "grok-imagine-image-2.0", object: "model", created: 0, owned_by: "xai" },
  { id: "grok-imagine-video-1.5", object: "model", created: 0, owned_by: "xai" },
];

const SCRIPT = [
  { type: "response.output_text.delta", delta: "The OAuth bridge keeps the refresh token " },
  { type: "response.output_text.delta", delta: "on this machine and injects the bearer per request.\n\n" },
  { type: "response.output_text.delta", delta: "Point any OpenAI-compatible client at 127.0.0.1:18645 and " },
  { type: "response.output_text.delta", delta: "send a placeholder key." },
  { type: "response.completed" },
];

// "1" fails every catalog read; "once" fails only the first so a retry can succeed.
const CATALOG_FAILURE = process.env.PROGROK_HARNESS_FAIL_CATALOG ?? "";
let catalogFailuresLeft = CATALOG_FAILURE === "once"
  ? 1
  : CATALOG_FAILURE === "1"
  ? Number.POSITIVE_INFINITY
  : 0;

let videoPolls = 0;

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
    if (catalogFailuresLeft > 0) {
      catalogFailuresLeft -= 1;
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
    videoPolls = 0;
    return json(res, 200, { request_id: "vid_mock_1", status: "pending", progress: 0 });
  }
  if (url.pathname.startsWith("/v1/videos/")) {
    videoPolls += 1;
    if (videoPolls < 3) {
      return json(res, 200, { id: "vid_mock_1", status: "pending", progress: videoPolls * 0.3 });
    }
    videoPolls = 0;
    const clip =
      "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=";
    return json(res, 200, {
      request_id: "vid_mock_1",
      status: "done",
      progress: 1,
      video: { url: clip },
    });
  }
  if (url.pathname === "/states.html" || url.pathname === "/states.css") {
    const file = await readFile(join(HARNESS_DIR, url.pathname.slice(1)));
    res.writeHead(200, { "content-type": TYPES[extname(url.pathname)] });
    return res.end(file);
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
