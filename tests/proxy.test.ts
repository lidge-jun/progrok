import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createProxyApp } from "../src/proxy/server.js";
import { ALLOWED_PROXY_PATHS } from "../src/auth/constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FetchResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function fetch(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: options.method ?? "GET",
      headers: options.headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function json(result: FetchResult): unknown {
  return JSON.parse(result.body);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("progrok proxy server", () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    const app = createProxyApp();

    await new Promise<void>((resolve, reject) => {
      // Port 0 lets the OS pick a free port
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr === null || typeof addr === "string") {
          reject(new Error("Unexpected server address format"));
          return;
        }
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
      server.on("error", reject);
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  // -------------------------------------------------------------------------
  // GET /health
  // -------------------------------------------------------------------------

  it("GET /health returns 200 with expected JSON payload", async () => {
    const res = await fetch(`${baseUrl}/health`);

    assert.equal(res.status, 200);

    const body = json(res) as Record<string, string>;
    assert.deepStrictEqual(body, {
      status: "ok",
      upstream: "xAI Grok",
      proxy: "progrok",
    });
  });

  // -------------------------------------------------------------------------
  // Unknown path under /v1
  // -------------------------------------------------------------------------

  it("GET /v1/unknown-path returns 404 with path_not_allowed error", async () => {
    const res = await fetch(`${baseUrl}/v1/unknown-path`);

    assert.equal(res.status, 404);

    const body = json(res) as { error: { message: string; type: string } };
    assert.equal(body.error.type, "path_not_allowed");
    assert.ok(
      body.error.message.includes("/v1/unknown-path"),
      `Expected error message to mention the requested path, got: ${body.error.message}`,
    );
  });

  // -------------------------------------------------------------------------
  // Auth guard on an allowed path
  // -------------------------------------------------------------------------

  it("POST /v1/responses reaches the proxy handler (401 if no auth, or upstream response if auth exists)", async () => {
    const res = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.3", input: [{ role: "user", content: "test" }] }),
    });

    assert.notEqual(res.status, 404, "Allowed path should not return 404");
    assert.ok(res.body.length > 0, "Expected a non-empty response body");
  });

  // -------------------------------------------------------------------------
  // ALLOWED_PROXY_PATHS contains expected values
  // -------------------------------------------------------------------------

  it("ALLOWED_PROXY_PATHS contains the expected set of paths", () => {
    const expected = [
      "/responses",
      "/chat/completions",
      "/completions",
      "/embeddings",
      "/models",
    ];

    for (const path of expected) {
      assert.ok(
        ALLOWED_PROXY_PATHS.has(path),
        `Expected ALLOWED_PROXY_PATHS to contain "${path}"`,
      );
    }

    assert.equal(
      ALLOWED_PROXY_PATHS.size,
      expected.length,
      `Expected ALLOWED_PROXY_PATHS to have exactly ${expected.length} entries, got ${ALLOWED_PROXY_PATHS.size}`,
    );
  });
});
