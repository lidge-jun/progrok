import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { XaiFetchInput } from "../src/transport/fetch.js";

const originalHome = process.env.HOME;
const originalFetch = globalThis.fetch;
const originalDeploymentKey = process.env.GROK_DEPLOYMENT_KEY;
const tempHome = mkdtempSync(join(tmpdir(), "progrok-transport-test-"));
process.env.HOME = tempHome;

const {
  XAI_PUBLIC_API_BASE_URL,
  XAI_PUBLIC_API_ORIGIN,
  XAI_SESSION_API_BASE_URL,
  normalizeXaiPath,
  resolveCliChatProxyUrl,
  resolveDeploymentConfigUrl,
  resolveUpstreamBase,
  resolveUpstreamUrl,
} = await import("../src/transport/base-url.js");
const { buildUpstreamHeaders } = await import(
  "../src/transport/headers.js"
);
const {
  classifyReplay,
  isRetryableStatus,
  retryDelayMs,
  sleepWithAbort,
} = await import("../src/transport/retry.js");
const {
  createCliChatProxyTransport,
  createXaiTransport,
  executeXaiFetch,
  xaiFetch,
} = await import("../src/transport/fetch.js");

const authFile = join(tempHome, ".progrok", "auth.json");
const tokenEndpoint = "https://auth.x.ai/oauth2/token";

function requestInput(
  overrides: Partial<XaiFetchInput> = {},
): XaiFetchInput {
  return {
    pathWithQuery: "/v1/models",
    method: "GET",
    headers: new Headers(),
    ...overrides,
  };
}

function saveAuth(accessToken: string, refreshToken = "refresh-token"): void {
  mkdirSync(join(tempHome, ".progrok"), { recursive: true });
  writeFileSync(
    authFile,
    JSON.stringify({
      accessToken,
      refreshToken,
      expiresAt: Date.now() + 60 * 60 * 1000,
      tokenEndpoint,
    }),
  );
}

afterEach(() => {
  rmSync(authFile, { force: true });
  globalThis.fetch = originalFetch;
  if (originalDeploymentKey === undefined) {
    delete process.env.GROK_DEPLOYMENT_KEY;
  } else {
    process.env.GROK_DEPLOYMENT_KEY = originalDeploymentKey;
  }
});

after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tempHome, { recursive: true, force: true });
});

describe("transport base URL policy", () => {
  it("keeps public OAuth and API-key traffic on api.x.ai", () => {
    assert.equal(XAI_PUBLIC_API_ORIGIN, "https://api.x.ai");
    assert.equal(XAI_PUBLIC_API_BASE_URL, "https://api.x.ai/v1");
    assert.equal(resolveUpstreamBase("oauth"), XAI_PUBLIC_API_BASE_URL);
    assert.equal(resolveUpstreamBase("api-key"), XAI_PUBLIC_API_BASE_URL);
    assert.equal(
      resolveUpstreamUrl("/v1/models?limit=2", "oauth"),
      "https://api.x.ai/v1/models?limit=2",
    );
    assert.equal(
      resolveUpstreamUrl("billing", "oauth"),
      "https://api.x.ai/v1/billing",
    );
    assert.equal(
      resolveUpstreamUrl("/v1/user", "api-key"),
      "https://api.x.ai/v1/user",
    );
  });

  it("preserves versioned paths and discards an untrusted absolute host", () => {
    assert.equal(normalizeXaiPath("models"), "/v1/models");
    assert.equal(normalizeXaiPath("/v2/phone-numbers"), "/v2/phone-numbers");
    assert.equal(
      resolveUpstreamUrl(
        "https://evil.invalid/v2/phone-numbers?x=1#ignored",
        "oauth",
      ),
      "https://api.x.ai/v2/phone-numbers?x=1",
    );
  });

  it("rejects deployment and feedback paths before public fetch", () => {
    assert.throws(
      () => resolveUpstreamUrl("/v1/deployment/config", "oauth"),
      /GROK_DEPLOYMENT_KEY/,
    );
    assert.throws(
      () => resolveUpstreamUrl("/v1/feedback/rating", "api-key"),
      /automatic routing is disabled/,
    );
    assert.throws(
      () => resolveUpstreamUrl("/v1/%66eedback/rating", "oauth"),
      /automatic routing is disabled/,
    );
    assert.throws(
      () => resolveUpstreamUrl("/v1/%ZZ", "oauth"),
      /invalid percent-encoding/,
    );
  });

  it("exposes cli-chat-proxy only through explicit resolver names", () => {
    assert.equal(
      XAI_SESSION_API_BASE_URL,
      "https://cli-chat-proxy.grok.com/v1",
    );
    assert.equal(
      resolveCliChatProxyUrl("/v1/models", { explicitOptIn: true }).href,
      "https://cli-chat-proxy.grok.com/v1/models",
    );
    assert.equal(
      resolveDeploymentConfigUrl("deployment-key", {
        explicitOptIn: true,
      }).href,
      "https://cli-chat-proxy.grok.com/v1/deployment/config",
    );
  });
});

describe("transport headers", () => {
  it("drops caller auth, hop-by-hop, and untyped x-grok headers", () => {
    const headers = buildUpstreamHeaders({
      incoming: {
        Authorization: "Bearer caller-secret",
        Host: "evil.invalid",
        Connection: "keep-alive",
        "Content-Length": "999",
        "Content-Type": "application/json",
        "x-grok-user-id": "caller-user",
        "x-grok-req-id": "caller-request",
      },
      auth: { kind: "oauth", bearer: "stored-secret" },
      trace: {
        requestId: "trusted-request",
        conversationId: "conversation-1",
        turnIndex: 0,
        transientRetry: true,
      },
      clientVersion: "3.0.0-test",
    });

    assert.equal(headers.get("authorization"), "Bearer stored-secret");
    assert.equal(headers.get("host"), null);
    assert.equal(headers.get("connection"), null);
    assert.equal(headers.get("content-length"), null);
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("x-grok-user-id"), null);
    assert.equal(headers.get("x-grok-req-id"), "trusted-request");
    assert.equal(headers.get("x-grok-conv-id"), "conversation-1");
    assert.equal(headers.get("x-grok-turn-idx"), "0");
    assert.equal(headers.get("x-grok-transient-retry"), "true");
    assert.equal(headers.get("x-xai-token-auth"), "xai-grok-cli");
  });

  it("does not add the OAuth marker for API or deployment keys", () => {
    for (const kind of ["api-key", "deployment-key"] as const) {
      const headers = buildUpstreamHeaders({
        auth: { kind, bearer: "key" },
        clientVersion: "test",
      });
      assert.equal(headers.get("x-xai-token-auth"), null);
      assert.match(headers.get("x-grok-req-id") ?? "", /^[0-9a-f-]{36}$/i);
    }
  });
});

describe("transport replay classification", () => {
  it("replays safe methods and keyed writes only", () => {
    for (const method of ["GET", "head", "OPTIONS"]) {
      assert.equal(classifyReplay(method, new Headers()), "replayable");
    }
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      assert.equal(classifyReplay(method, new Headers()), "not-replayable");
      assert.equal(
        classifyReplay(method, new Headers({ "Idempotency-Key": "once" })),
        "replayable",
      );
    }
  });

  it("limits status retries and Retry-After delays", () => {
    const policy = {
      replay: "replayable" as const,
      maxAttempts: 3,
      baseDelayMs: 400,
      maxDelayMs: 5_000,
      retry429: true,
      retry5xx: true,
    };
    for (const status of [429, 500, 502, 503, 504, 520, 521, 522]) {
      assert.equal(isRetryableStatus(status, policy), true, String(status));
    }
    for (const status of [400, 401, 507]) {
      assert.equal(isRetryableStatus(status, policy), false, String(status));
    }
    assert.equal(
      retryDelayMs(0, new Headers({ "Retry-After": "1" }), policy, 0),
      1_000,
    );
    assert.equal(
      retryDelayMs(0, new Headers({ "Retry-After": "60" }), policy, 0),
      undefined,
    );
    assert.equal(
      retryDelayMs(
        0,
        new Headers({ "Retry-After": "Thu, 01 Jan 1970 00:00:03 GMT" }),
        policy,
        1_000,
      ),
      2_000,
    );
  });

  it("aborts sleep without waiting for the delay", async () => {
    const controller = new AbortController();
    const pending = sleepWithAbort(60_000, controller.signal);
    controller.abort(new DOMException("caller stopped", "AbortError"));
    await assert.rejects(pending, { name: "AbortError" });
  });
});

describe("transport fetch execution", () => {
  it("retries a GET network failure before response headers", async () => {
    let calls = 0;
    const response = await executeXaiFetch(requestInput(), {
      bearer: "oauth-token",
      fetchImpl: async () => {
        calls += 1;
        if (calls < 3) throw new TypeError("ECONNRESET");
        return new Response("ok");
      },
    });
    assert.equal(await response.text(), "ok");
    assert.equal(calls, 3);
  });

  it("does not retry an unkeyed POST network failure", async () => {
    let calls = 0;
    await assert.rejects(
      executeXaiFetch(
        requestInput({ method: "POST", body: JSON.stringify({ input: "x" }) }),
        {
          bearer: "oauth-token",
          fetchImpl: async () => {
            calls += 1;
            throw new TypeError("ECONNRESET");
          },
        },
      ),
      /ECONNRESET/,
    );
    assert.equal(calls, 1);
  });

  it("cancels a retryable response body before replay", async () => {
    let calls = 0;
    let cancelled = 0;
    const response = await executeXaiFetch(requestInput(), {
      bearer: "oauth-token",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(
            new ReadableStream({
              cancel() {
                cancelled += 1;
              },
            }),
            { status: 429, headers: { "Retry-After": "0" } },
          );
        }
        return new Response("ok");
      },
    });
    assert.equal(await response.text(), "ok");
    assert.equal(calls, 2);
    assert.equal(cancelled, 1);
  });

  it("returns an over-cap Retry-After response without replay", async () => {
    let calls = 0;
    const response = await executeXaiFetch(requestInput(), {
      bearer: "oauth-token",
      fetchImpl: async () => {
        calls += 1;
        return new Response("later", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      },
    });
    assert.equal(response.status, 429);
    assert.equal(calls, 1);
  });

  it("stops retry backoff as soon as the caller aborts", async () => {
    const controller = new AbortController();
    let calls = 0;
    const pending = executeXaiFetch(
      requestInput({ signal: controller.signal }),
      {
        bearer: "oauth-token",
        fetchImpl: async () => {
          calls += 1;
          return new Response("busy", {
            status: 429,
            headers: { "Retry-After": "5" },
          });
        },
      },
    );
    controller.abort(new DOMException("caller stopped", "AbortError"));
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(calls, 1);
  });

  it("never retries a body stream failure after headers commit", async () => {
    let calls = 0;
    const response = await executeXaiFetch(requestInput(), {
      bearer: "oauth-token",
      fetchImpl: async () => {
        calls += 1;
        let pulls = 0;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1;
              if (pulls === 1) {
                controller.enqueue(new TextEncoder().encode("first"));
              } else {
                controller.error(new Error("mid-stream reset"));
              }
            },
          }),
        );
      },
    });
    const reader = response.body?.getReader();
    assert.ok(reader);
    assert.equal(new TextDecoder().decode((await reader.read()).value), "first");
    await assert.rejects(reader.read(), /mid-stream reset/);
    assert.equal(calls, 1);
  });

  it("applies timeout only until response headers arrive", async () => {
    process.env.GROK_DEPLOYMENT_KEY = "deployment-secret";
    let fetchSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_input, init) => {
      fetchSignal = init?.signal ?? undefined;
      return new Response("stream remains readable");
    }) as typeof globalThis.fetch;
    const transport = createCliChatProxyTransport({
      explicitOptIn: true,
      credential: {
        kind: "deployment-key",
        env: "GROK_DEPLOYMENT_KEY",
      },
      timeoutMs: 5,
    });
    const response = await transport.fetch(
      requestInput({ pathWithQuery: "/v1/deployment/config" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(fetchSignal?.aborted, false);
    assert.equal(await response.text(), "stream remains readable");
  });

  it("surfaces a header timeout without retrying it", async () => {
    process.env.GROK_DEPLOYMENT_KEY = "deployment-secret";
    let calls = 0;
    globalThis.fetch = (async (_input, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    }) as typeof globalThis.fetch;
    const transport = createCliChatProxyTransport({
      explicitOptIn: true,
      credential: {
        kind: "deployment-key",
        env: "GROK_DEPLOYMENT_KEY",
      },
      timeoutMs: 5,
    });
    await assert.rejects(
      transport.fetch(
        requestInput({ pathWithQuery: "/v1/deployment/config" }),
      ),
      { name: "TimeoutError" },
    );
    assert.equal(calls, 1);
  });
});

describe("transport bearer and dedicated client seams", () => {
  it("refreshes once after 401 and replays with the new bearer", async () => {
    saveAuth("old-access");
    let refreshes = 0;
    globalThis.fetch = (async () => {
      refreshes += 1;
      return new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof globalThis.fetch;
    const authorizations: string[] = [];
    const response = await xaiFetch(requestInput(), {
      fetchImpl: async (_input, init) => {
        authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
        return new Response(authorizations.length === 1 ? "unauthorized" : "ok", {
          status: authorizations.length === 1 ? 401 : 200,
        });
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(authorizations, ["Bearer old-access", "Bearer new-access"]);
    assert.equal(refreshes, 1);
  });

  it("returns a second 401 without a third upstream request", async () => {
    saveAuth("old-access-2", "refresh-token-2");
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ access_token: "new-access-2", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof globalThis.fetch;
    let calls = 0;
    const response = await createXaiTransport({
      fetchImpl: async () => {
        calls += 1;
        return new Response("unauthorized", { status: 401 });
      },
    }).fetch(requestInput());
    assert.equal(response.status, 401);
    assert.equal(calls, 2);
  });

  it("keeps deployment keys on the opt-in config-only client", async () => {
    assert.throws(
      () =>
        createCliChatProxyTransport({
          explicitOptIn: false,
          credential: { kind: "oauth" },
        } as unknown as Parameters<typeof createCliChatProxyTransport>[0]),
      /explicit opt-in/,
    );

    process.env.GROK_DEPLOYMENT_KEY = "deployment-secret";
    const calls: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response("ok");
    }) as typeof globalThis.fetch;
    const transport = createCliChatProxyTransport({
      explicitOptIn: true,
      credential: {
        kind: "deployment-key",
        env: "GROK_DEPLOYMENT_KEY",
      },
    });

    await assert.rejects(
      transport.fetch(requestInput({ pathWithQuery: "/v1/models" })),
      /restricted to \/v1\/deployment\/config/,
    );
    await assert.rejects(
      transport.fetch(requestInput({ pathWithQuery: "/v1/feedback" })),
      /automatic routing is disabled/,
    );
    const response = await transport.fetch(
      requestInput({ pathWithQuery: "/v1/deployment/config" }),
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]?.url,
      "https://cli-chat-proxy.grok.com/v1/deployment/config",
    );
    assert.equal(
      calls[0]?.headers.get("authorization"),
      "Bearer deployment-secret",
    );
    assert.equal(calls[0]?.headers.get("x-xai-token-auth"), null);
  });
});
