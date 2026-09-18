import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import { describe, it } from "node:test";
import type { Response as ExpressResponse } from "express";
import { relayUpstreamResponse } from "../src/proxy/relay.js";
import { redactSecrets } from "../src/proxy/redact.js";
import { createProxyApp } from "../src/proxy/server.js";

const SECRET = "xai-oauth-abcdefghijklmnopqrstuvwxyz0123456789";

function listen(app: http.RequestListener): Promise<{ url: string; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function body(url: string, init?: http.RequestOptions & { payload?: string }): Promise<{ status: number; text: string }> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: init?.payload ?? "{}" });
  return { status: response.status, text: await response.text() };
}

describe("proxy hardening", () => {
  it("redacts credential-shaped runs rather than echoing them", () => {
    assert.equal(redactSecrets(`token ${SECRET} rejected`), "token [redacted] rejected");
    assert.equal(redactSecrets("Authorization: Bearer abc.def.ghi"), "Authorization: [redacted]");
    assert.ok(!redactSecrets(`eyJhbGciOi.${"a".repeat(20)}.${"b".repeat(20)}`).includes("eyJhbGciOi"));
    assert.equal(redactSecrets("plain upstream failure"), "plain upstream failure");
    assert.ok(redactSecrets("x".repeat(400)).length <= 301);
  });

  it("keeps a credential out of the 401 body when getBearer throws with one", async () => {
    const app = createProxyApp({
      getBearer: async () => { throw new Error(`refresh failed for ${SECRET}`); },
    });
    const server = await listen(app);
    try {
      const res = await body(`${server.url}/v1/models`);
      assert.equal(res.status, 401);
      assert.ok(!res.text.includes(SECRET), "401 body leaked the credential");
      assert.ok(res.text.includes("[redacted]"));
    } finally {
      await server.close();
    }
  });

  it("keeps a credential out of the 502 body when the upstream fetch throws with one", async () => {
    const app = createProxyApp({
      getBearer: async () => "bearer-value",
      fetchUpstream: async () => { throw new Error(`connect failed using ${SECRET}`); },
    });
    const server = await listen(app);
    try {
      const res = await body(`${server.url}/v1/models`);
      assert.equal(res.status, 502);
      assert.ok(!res.text.includes(SECRET), "502 body leaked the credential");
    } finally {
      await server.close();
    }
  });

  it("settles the relay when the client disconnects while the socket is paused", async () => {
    // write() returning false parks the relay until "drain". A client that goes
    // away never drains, so without a close listener this promise never settles.
    const res = new EventEmitter() as unknown as ExpressResponse & EventEmitter;
    Object.assign(res, {
      status() { return res; },
      setHeader() {},
      write() { return false; },
      end() {},
    });
    const upstream = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
    }), { status: 200 });

    const relayed = relayUpstreamResponse(upstream, res);
    setTimeout(() => res.emit("close"), 20);
    const outcome = await Promise.race([
      relayed.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("stranded"), 2000)),
    ]);
    assert.equal(outcome, "settled");
  });
});
