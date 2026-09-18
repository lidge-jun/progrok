import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { createWebApp } from "../src/web/server.js";
import { decodeSse, mintClientSecret } from "../src/web/client/api.js";
import type { ChatMessage } from "../src/web/client/contracts.js";
import { reduceResponseEvent } from "../src/web/client/response-state.js";
import { buildVoiceSocketSpec } from "../src/web/client/voice.js";

describe("progrok web app", () => {
  let server: Server;
  let baseUrl = "";

  before(async () => {
    const app = createWebApp({ publicDir: "src/web/public" });
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Web app did not expose a TCP address"));
          return;
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
      server.once("error", reject);
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("serves a self-contained shell with strict browser security headers", async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /connect-src 'self' wss:\/\/api\.x\.ai/);
    assert.doesNotMatch(csp, /unsafe-inline|cdn\.jsdelivr/);
    assert.equal(response.headers.get("permissions-policy"), "camera=(), geolocation=(), microphone=(self)");
    const html = await response.text();
    assert.match(html, /src="\/assets\/app\.js"/);
    assert.doesNotMatch(html, /https:\/\/.*\.(?:js|css)/);
  });

  it("marks every client-secret response as non-cacheable", async () => {
    const response = await fetch(`${baseUrl}/v1/realtime/client_secrets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("decodes chunk-split CRLF SSE and multiline data", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: message\r\ndata: {\"type\":\"response.output_"));
        controller.enqueue(encoder.encode("text.delta\",\r\ndata: \"delta\":\"hi\"}\r\n\r\ndata: [DONE]\r\n\r\n"));
        controller.close();
      },
    });
    const events: unknown[] = [];
    for await (const event of decodeSse(stream)) events.push(event);
    assert.deepEqual(events, [{ type: "response.output_text.delta", delta: "hi" }]);
  });

  it("reduces text, reasoning, generic tools, citations, and terminal state", () => {
    const message: ChatMessage = {
      id: "m1",
      role: "assistant",
      text: "",
      reasoningSummary: "",
      tools: [],
      status: "streaming",
    };
    reduceResponseEvent(message, {
      type: "response.output_text.delta",
      delta: "answer",
    });
    reduceResponseEvent(message, {
      type: "response.reasoning_summary_text.delta",
      delta: "summary",
    });
    reduceResponseEvent(message, {
      type: "response.output_item.added",
      output_index: 1,
      item: { id: "search-1", type: "web_search_call" },
    });
    reduceResponseEvent(message, {
      type: "response.web_search_call.searching",
      item_id: "search-1",
    });
    reduceResponseEvent(message, {
      type: "response.output_item.done",
      output_index: 1,
      item: {
        id: "search-1",
        type: "web_search_call",
        status: "completed",
        action: {
          sources: [{ title: "xAI docs", url: "https://docs.x.ai/" }],
        },
      },
    });
    const terminal = reduceResponseEvent(message, {
      type: "response.completed",
    });

    assert.equal(terminal, "complete");
    assert.equal(message.text, "answer");
    assert.equal(message.reasoningSummary, "summary");
    assert.deepEqual(message.tools, [{
      id: "search-1",
      type: "web_search_call",
      status: "complete",
      argumentsText: "",
      citations: [{ title: "xAI docs", url: "https://docs.x.ai/" }],
    }]);
  });

  it("does not cache client secrets between mint calls", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      assert.equal(init?.cache, "no-store");
      return new Response(JSON.stringify({
        value: `one-use-${calls}`,
        expires_at: 1_900_000_000 + calls,
      }), { headers: { "content-type": "application/json" } });
    };
    try {
      const first = await mintClientSecret();
      const second = await mintClientSecret();
      assert.equal(calls, 2);
      assert.notEqual(first.value, second.value);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("puts a one-use secret only in the canonical WebSocket subprotocol", () => {
    const secret = { value: "secret-value", expires_at: 123 };
    const realtime = buildVoiceSocketSpec("realtime", secret, {
      model: "grok-voice-think-fast-2.0",
      conversationId: "conversation-1",
    });
    assert.equal(
      realtime.url,
      "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-2.0&conversation_id=conversation-1",
    );
    assert.deepEqual(realtime.protocols, ["xai-client-secret.secret-value"]);
    assert.equal(realtime.url.includes(secret.value), false);

    const stt = buildVoiceSocketSpec("stt", secret, {
      model: "ignored-for-stt",
    });
    const sttUrl = new URL(stt.url);
    assert.equal(sttUrl.origin + sttUrl.pathname, "wss://api.x.ai/v1/stt");
    assert.equal(sttUrl.searchParams.get("sample_rate"), "16000");
    assert.equal(sttUrl.searchParams.get("encoding"), "pcm");
  });
});
