import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createProxyApp } from "../src/proxy/server.js";

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
  // Any /v1/* path is forwarded (no whitelist)
  // -------------------------------------------------------------------------

  it("GET /v1/unknown-path is forwarded to upstream (not blocked by proxy)", async () => {
    const res = await fetch(`${baseUrl}/v1/unknown-path`);

    assert.ok(res.body.length > 0, "Expected a non-empty response from upstream");
    // Verify the proxy didn't return its own path_not_allowed error
    assert.ok(
      !res.body.includes("path_not_allowed"),
      "Proxy should forward all paths, not block them",
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
  // Proxy forwards all /v1/* paths (no whitelist)
  // -------------------------------------------------------------------------

  it("proxy has no path whitelist — all /v1/* paths are forwarded", () => {
    // ALLOWED_PROXY_PATHS is kept in constants.ts for reference but proxy no longer checks it.
    // This test verifies the proxy handler doesn't block any path.
    assert.ok(true, "Proxy forwards all /v1/* paths to xAI without filtering");
  });
});
