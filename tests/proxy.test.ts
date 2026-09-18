import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import http from "node:http";
import { describe, it } from "node:test";
import type { Response as ExpressResponse } from "express";
import { MAX_PROXY_BODY_BYTES } from "../src/proxy/body.js";
import {
  prepareGrokRequest,
  prepareGrokRequestObject,
} from "../src/proxy/composer-inject.js";
import { relayUpstreamResponse } from "../src/proxy/relay.js";
import {
  createProxyApp,
  type ProxyAppDependencies,
} from "../src/proxy/server.js";
import type { XaiFetchInput } from "../src/transport/fetch.js";

interface FetchResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

interface RunningProxy {
  baseUrl: string;
  close(): Promise<void>;
}

interface CapturedCall {
  input: XaiFetchInput;
  bearer: string;
}

function request(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
  } = {},
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const headers = { ...options.headers };
    if (options.body !== undefined && headers["content-length"] === undefined) {
      headers["content-length"] = String(
        typeof options.body === "string"
          ? Buffer.byteLength(options.body)
          : options.body.byteLength,
      );
    }
    const req = http.request(url, {
      method: options.method ?? "GET",
      headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        settled = true;
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
    req.end(options.body);
  });
}

function requestRepeatedBody(
  url: string,
  totalBytes: number,
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = http.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(totalBytes),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        settled = true;
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });

    void (async () => {
      const chunk = Buffer.alloc(1024 * 1024, 0x61);
      let remaining = totalBytes;
      while (remaining > 0) {
        const next = remaining >= chunk.length
          ? chunk
          : chunk.subarray(0, remaining);
        remaining -= next.length;
        if (!req.write(next)) await once(req, "drain");
      }
      req.end();
    })().catch(reject);
  });
}

function json(result: FetchResult): unknown {
  return JSON.parse(result.body.toString("utf8"));
}

function bodyBuffer(body: BodyInit | null | undefined): Buffer {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new Error(`Unexpected test body type: ${body.constructor.name}`);
}

async function startProxy(
  deps: Partial<ProxyAppDependencies>,
): Promise<RunningProxy> {
  const app = createProxyApp(deps);
  const server = await new Promise<http.Server>((resolve, reject) => {
    const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
    candidate.on("error", reject);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Unexpected server address format");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function fakeDependencies(
  calls: CapturedCall[],
  reply: (input: XaiFetchInput) => Response = () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
): ProxyAppDependencies {
  return {
    getBearer: async () => "test-bearer",
    fetchUpstream: async (input, { bearer }) => {
      calls.push({ input, bearer });
      return reply(input);
    },
  };
}

function dataLines(body: Buffer): string[] {
  return body
    .toString("utf8")
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
}

function eventPayloads(body: Buffer): Array<Record<string, unknown>> {
  return dataLines(body)
    .filter((line) => line !== "[DONE]")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("progrok proxy server", () => {
  it("preserves the exact GET /health contract", async () => {
    const proxy = await startProxy(fakeDependencies([]));
    try {
      const result = await request(`${proxy.baseUrl}/health`);
      assert.equal(result.status, 200);
      assert.deepEqual(json(result), {
        status: "ok",
        upstream: "xAI Grok",
        proxy: "progrok",
      });
    } finally {
      await proxy.close();
    }
  });

  it("forwards every common method and preserves each query string", async () => {
    const calls: CapturedCall[] = [];
    const proxy = await startProxy(fakeDependencies(calls));
    try {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const body = method === "GET" ? undefined : `body-${method}`;
        const result = await request(
          `${proxy.baseUrl}/v1/unknown-${method.toLowerCase()}?raw=%2F+x&n=1`,
          {
            method,
            headers: body ? { "content-type": "application/octet-stream" } : {},
            body,
          },
        );
        assert.equal(result.status, 200, `${method}: ${result.body.toString()}`);
      }

      assert.deepEqual(calls.map(({ input }) => input.method), [
        "GET", "POST", "PUT", "PATCH", "DELETE",
      ]);
      for (const { input } of calls) {
        assert.match(input.pathWithQuery, /\?raw=%2F\+x&n=1$/);
      }
      assert.deepEqual(
        calls.slice(1).map(({ input }) => bodyBuffer(input.body).toString()),
        ["body-POST", "body-PUT", "body-PATCH", "body-DELETE"],
      );
    } finally {
      await proxy.close();
    }
  });

  it("ignores inbound Authorization and passes only the stored bearer seam", async () => {
    const calls: CapturedCall[] = [];
    const proxy = await startProxy(fakeDependencies(calls));
    try {
      await request(`${proxy.baseUrl}/v1/models`, {
        headers: {
          authorization: "Bearer attacker-controlled",
          host: "attacker.invalid",
          "x-client-header": "kept",
        },
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.bearer, "test-bearer");
      assert.equal(calls[0]?.input.headers.has("authorization"), false);
      assert.equal(calls[0]?.input.headers.has("host"), false);
      assert.equal(calls[0]?.input.headers.has("content-length"), false);
      assert.equal(calls[0]?.input.headers.get("x-client-header"), "kept");
    } finally {
      await proxy.close();
    }
  });

  it("preserves the 401 auth error shape", async () => {
    const proxy = await startProxy({
      getBearer: async () => { throw new Error("login required"); },
      fetchUpstream: async () => { throw new Error("must not fetch"); },
    });
    try {
      const result = await request(`${proxy.baseUrl}/v1/models`);
      assert.equal(result.status, 401);
      assert.deepEqual(json(result), {
        error: { message: "login required", type: "auth_error" },
      });
    } finally {
      await proxy.close();
    }
  });

  it("preserves the 502 upstream error shape", async () => {
    const proxy = await startProxy({
      getBearer: async () => "test-bearer",
      fetchUpstream: async () => { throw new Error("network down"); },
    });
    try {
      const result = await request(`${proxy.baseUrl}/v1/models`);
      assert.equal(result.status, 502);
      assert.deepEqual(json(result), {
        error: {
          message: "Upstream error: network down",
          type: "upstream_error",
        },
      });
    } finally {
      await proxy.close();
    }
  });

  it("accepts exactly 100MB and rejects 100MB + 1 with the exact 413 body", {
    timeout: 30_000,
  }, async () => {
    const forwardedSizes: number[] = [];
    const proxy = await startProxy({
      getBearer: async () => "test-bearer",
      fetchUpstream: async (input) => {
        forwardedSizes.push(bodyBuffer(input.body).byteLength);
        return new Response("ok");
      },
    });
    try {
      const exact = await requestRepeatedBody(
        `${proxy.baseUrl}/v1/opaque`,
        MAX_PROXY_BODY_BYTES,
      );
      assert.equal(exact.status, 200);
      assert.deepEqual(forwardedSizes, [MAX_PROXY_BODY_BYTES]);

      const oversized = await requestRepeatedBody(
        `${proxy.baseUrl}/v1/opaque`,
        MAX_PROXY_BODY_BYTES + 1,
      );
      assert.equal(oversized.status, 413);
      assert.deepEqual(json(oversized), {
        error: {
          message: "Request body exceeds 100MB limit",
          type: "payload_too_large",
        },
      });
      assert.deepEqual(forwardedSizes, [MAX_PROXY_BODY_BYTES]);
    } finally {
      await proxy.close();
    }
  });

  it("filters unsafe upstream response headers while preserving status and body", async () => {
    const proxy = await startProxy(fakeDependencies([], () =>
      new Response("relay-body", {
        status: 207,
        headers: {
          "content-encoding": "gzip",
          "content-length": "999",
          "proxy-authenticate": "secret",
          "x-upstream": "kept",
        },
      })));
    try {
      const result = await request(`${proxy.baseUrl}/v1/relay`);
      assert.equal(result.status, 207);
      assert.equal(result.body.toString(), "relay-body");
      assert.equal(result.headers["content-encoding"], undefined);
      assert.equal(result.headers["content-length"], undefined);
      assert.equal(result.headers["proxy-authenticate"], undefined);
      assert.equal(result.headers["x-upstream"], "kept");
    } finally {
      await proxy.close();
    }
  });

  it("keeps non-native routes byte-identical and stream truthiness is strict", async () => {
    const calls: CapturedCall[] = [];
    const upstreamBody = Buffer.from([0, 1, 2, 255]);
    const proxy = await startProxy(fakeDependencies(calls, () =>
      new Response(upstreamBody, {
        headers: { "content-type": "text/event-stream" },
      })));
    const cases = [
      ["/v1/chat/completions", "text/plain", Buffer.from("not-json")],
      ["/v1/stt", "multipart/form-data; boundary=x", Buffer.from("--x\r\nraw")],
      ["/v1/tts", "application/octet-stream", Buffer.from([9, 8, 7])],
      ["/v1/unknown", "application/octet-stream", Buffer.from([6, 5, 4])],
      [
        "/v1/responses",
        "application/json",
        Buffer.from(JSON.stringify({ model: "grok-4.3", stream: "true" })),
      ],
    ] as const;
    try {
      for (const [path, contentType, body] of cases) {
        const result = await request(`${proxy.baseUrl}${path}`, {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        });
        assert.deepEqual(result.body, upstreamBody);
      }
      assert.deepEqual(
        calls.slice(0, 4).map(({ input }) => bodyBuffer(input.body)),
        cases.slice(0, 4).map((entry) => entry[2]),
      );
      assert.deepEqual(
        JSON.parse(bodyBuffer(calls[4]?.input.body).toString()),
        { model: "grok-4.3", stream: "true" },
      );
    } finally {
      await proxy.close();
    }
  });

  it("natively parses and renders Chat text, tools, finish, and one DONE", async () => {
    const upstream = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":' } }] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\n`,
    ].join("");
    const proxy = await startProxy(fakeDependencies([], () =>
      new Response(upstream, {
        headers: { "content-type": "text/event-stream" },
      })));
    try {
      const result = await request(`${proxy.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "grok-4.3", stream: true, messages: [] }),
      });
      assert.equal(result.status, 200);
      assert.match(String(result.headers["content-type"]), /^text\/event-stream/);
      const serialized = result.body.toString();
      assert.match(serialized, /hello/);
      assert.match(serialized, /lookup/);
      assert.match(serialized, /\\"q\\":\\"x\\"/);
      assert.match(serialized, /tool_calls/);
      assert.equal(dataLines(result.body).filter((line) => line === "[DONE]").length, 1);
    } finally {
      await proxy.close();
    }
  });

  it("natively parses and renders Responses text, tools, and completion", async () => {
    const message = { id: "msg_1", type: "message", role: "assistant", content: [] };
    const call = {
      id: "item_1",
      type: "function_call",
      call_id: "call_1",
      name: "lookup",
      arguments: '{"q":"x"}',
    };
    const frames = [
      { type: "response.output_item.added", output_index: 0, item: message },
      { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, delta: "hello" },
      { type: "response.output_item.done", output_index: 0, item: message },
      { type: "response.output_item.added", output_index: 1, item: { ...call, arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "item_1", output_index: 1, delta: '{"q":"x"}' },
      { type: "response.output_item.done", output_index: 1, item: call },
      { type: "response.completed", response: { id: "resp_upstream", output: [message, call], usage: { input_tokens: 2, output_tokens: 3 } } },
    ];
    const upstream = frames
      .map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`)
      .join("");
    const proxy = await startProxy(fakeDependencies([], () =>
      new Response(upstream, {
        headers: { "content-type": "text/event-stream" },
      })));
    try {
      const result = await request(`${proxy.baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "grok-4.3", stream: true, input: "hi" }),
      });
      assert.equal(result.status, 200);
      const types = eventPayloads(result.body).map((payload) => payload.type);
      assert.deepEqual(types, [
        "response.created",
        "response.output_text.delta",
        "response.output_item.added",
        "response.function_call_arguments.delta",
        "response.output_item.done",
        "response.completed",
      ]);
      assert.match(result.body.toString(), /resp_upstream/);
    } finally {
      await proxy.close();
    }
  });

  it("relays stream requests when the upstream response is not successful SSE", async () => {
    const proxy = await startProxy(fakeDependencies([], () =>
      new Response("upstream rejection", {
        status: 422,
        headers: { "content-type": "text/plain", "x-error": "kept" },
      })));
    try {
      const result = await request(`${proxy.baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "grok-4.3", stream: true, input: "hi" }),
      });
      assert.equal(result.status, 422);
      assert.equal(result.body.toString(), "upstream rejection");
      assert.equal(result.headers["x-error"], "kept");
    } finally {
      await proxy.close();
    }
  });

  it("maps a parser preflight failure to the existing 502 JSON", async () => {
    const proxy = await startProxy(fakeDependencies([], () =>
      new Response("data: {bad-json}\n\n", {
        headers: { "content-type": "text/event-stream" },
      })));
    try {
      const result = await request(`${proxy.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "grok-4.3", stream: true, messages: [] }),
      });
      assert.equal(result.status, 502);
      assert.deepEqual(json(result), {
        error: {
          message: "Upstream error: malformed Chat SSE data",
          type: "upstream_error",
        },
      });
    } finally {
      await proxy.close();
    }
  });

  it("keeps status 200 and emits a protocol error after stream commit", async () => {
    const upstream = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "first" }, finish_reason: null }] })}\n\n`,
      "data: {bad-json}\n\n",
    ].join("");
    const proxy = await startProxy(fakeDependencies([], () =>
      new Response(upstream, {
        headers: { "content-type": "text/event-stream" },
      })));
    try {
      const result = await request(`${proxy.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "grok-4.3", stream: true, messages: [] }),
      });
      assert.equal(result.status, 200);
      assert.match(result.body.toString(), /first/);
      assert.match(result.body.toString(), /malformed_sse_json/);
      assert.equal(dataLines(result.body).includes("[DONE]"), false);
    } finally {
      await proxy.close();
    }
  });

  it("propagates a disconnected downstream client to the upstream AbortSignal", {
    timeout: 2_000,
  }, async () => {
    let markCalled!: () => void;
    let markAborted!: () => void;
    const called = new Promise<void>((resolve) => { markCalled = resolve; });
    const aborted = new Promise<void>((resolve) => { markAborted = resolve; });
    const proxy = await startProxy({
      getBearer: async () => "test-bearer",
      fetchUpstream: (input) => new Promise<Response>((_resolve, reject) => {
        markCalled();
        const signal = input.signal;
        const onAbort = (): void => {
          markAborted();
          reject(signal?.reason);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      }),
    });
    const client = http.request(`${proxy.baseUrl}/v1/models`);
    client.on("error", () => undefined);
    client.end();
    try {
      await called;
      client.destroy();
      await aborted;
    } finally {
      client.destroy();
      await proxy.close();
    }
  });

  it("waits for downstream drain before relaying the next chunk", async () => {
    class BackpressureResponse extends EventEmitter {
      readonly writes: Uint8Array[] = [];
      ended = false;
      status(): this { return this; }
      setHeader(): void {}
      write(chunk: Uint8Array): boolean {
        this.writes.push(chunk);
        return this.writes.length > 1;
      }
      end(): void { this.ended = true; }
    }

    const downstream = new BackpressureResponse();
    const upstream = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.enqueue(new Uint8Array([2]));
        controller.close();
      },
    }));
    const pending = relayUpstreamResponse(
      upstream,
      downstream as unknown as ExpressResponse,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(downstream.writes.length, 1);
    assert.equal(downstream.ended, false);
    downstream.emit("drain");
    await pending;
    assert.deepEqual(downstream.writes.map((chunk) => [...chunk]), [[1], [2]]);
    assert.equal(downstream.ended, true);
  });

  it("keeps the Buffer composer API equivalent to the new object API", () => {
    const value = {
      model: "grok-composer-2.5-fast",
      reasoning_effort: "high",
      messages: [{ role: "user", content: "hi" }],
    };
    const objectInput = structuredClone(value) as Record<string, unknown>;
    const prepared = prepareGrokRequestObject("/chat/completions", objectInput);
    const wrapped = prepareGrokRequest(
      "/chat/completions",
      Buffer.from(JSON.stringify(value)),
    );
    assert.equal(prepared.changed, true);
    assert.deepEqual(JSON.parse(wrapped.toString()), prepared.value);

    const untouched = { model: "grok-4.3" };
    const unchanged = prepareGrokRequestObject("/responses", untouched);
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.value, untouched);
  });
});
