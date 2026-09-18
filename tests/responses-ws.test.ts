import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import {
  connectResponsesWebSocket,
  type ResponsesWsCreate,
  type ResponsesWsDeps,
} from "../src/surfaces/responses-ws.js";

class FakeSocket extends EventEmitter {
  readyState = WebSocket.CONNECTING;
  readonly sent: string[] = [];

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }

  message(value: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(value)));
  }

  send(
    data: string,
    callback: (error?: Error) => void,
  ): void {
    this.sent.push(data);
    callback();
  }

  close(code = 1000, reason = "client close"): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSING;
    queueMicrotask(() => {
      this.readyState = WebSocket.CLOSED;
      this.emit("close", code, Buffer.from(reason));
    });
  }
}

function dependencies(socket: FakeSocket): {
  deps: ResponsesWsDeps;
  upgrades: Array<{ url: string; headers: Record<string, string> }>;
} {
  const upgrades: Array<{ url: string; headers: Record<string, string> }> = [];
  return {
    upgrades,
    deps: {
      async getBearer() {
        return "bearer-secret";
      },
      createSocket(url, headers) {
        upgrades.push({ url, headers });
        return socket as unknown as WebSocket;
      },
    },
  };
}

function request(input: string, previous?: string): ResponsesWsCreate {
  return {
    type: "response.create",
    model: "grok-4.6",
    input,
    ...(previous ? { previous_response_id: previous } : {}),
  };
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("Responses WebSocket", () => {
  it("waits for open and keeps bearer only in the upgrade header", async () => {
    const socket = new FakeSocket();
    const { deps, upgrades } = dependencies(socket);
    let connected = false;
    const pending = connectResponsesWebSocket(deps).then((session) => {
      connected = true;
      return session;
    });
    await tick();
    assert.equal(connected, false);
    assert.deepEqual(upgrades, [
      {
        url: "wss://api.x.ai/v1/responses",
        headers: { Authorization: "Bearer bearer-secret" },
      },
    ]);

    socket.open();
    const session = await pending;
    await session.send(request("hello"));
    assert.equal(socket.sent.length, 1);
    assert.equal(socket.sent[0]?.includes("bearer-secret"), false);
    await session.close();
  });

  it("serializes turns until the prior terminal and reduces each turn independently", async () => {
    const socket = new FakeSocket();
    const { deps } = dependencies(socket);
    const pending = connectResponsesWebSocket(deps);
    await tick();
    socket.open();
    const session = await pending;

    await session.send(request("first"));
    const second = session.send(request("second", "resp_1"));
    await tick();
    assert.equal(socket.sent.length, 1);

    socket.message({
      type: "response.output_item.added",
      output_index: 0,
      item: { id: "item_1", type: "message" },
    });
    socket.message({
      type: "response.output_text.delta",
      item_id: "item_1",
      delta: "hello",
    });
    socket.message({
      type: "response.output_item.done",
      output_index: 0,
      item: { id: "item_1", type: "message" },
    });
    socket.message({
      type: "response.completed",
      response: {
        id: "resp_1",
        output: [{ id: "item_1", type: "message" }],
      },
    });
    await second;
    assert.equal(socket.sent.length, 2);

    socket.message({
      type: "response.completed",
      response: { id: "resp_2", output: [] },
    });
    const iterator = session.events()[Symbol.asyncIterator]();
    assert.deepEqual(await iterator.next(), {
      value: { type: "text_delta", text: "hello", itemId: "item_1" },
      done: false,
    });
    assert.deepEqual(await iterator.next(), {
      value: { type: "done", protocol: "responses", responseId: "resp_1" },
      done: false,
    });
    assert.deepEqual(await iterator.next(), {
      value: { type: "done", protocol: "responses", responseId: "resp_2" },
      done: false,
    });

    const secondWire = JSON.parse(socket.sent[1] ?? "null") as Record<
      string,
      unknown
    >;
    assert.equal(secondWire.previous_response_id, "resp_1");
    await session.close();
    assert.equal((await iterator.next()).done, true);
  });

  it("preserves protocol error codes without replaying a turn", async () => {
    const socket = new FakeSocket();
    const { deps } = dependencies(socket);
    const pending = connectResponsesWebSocket(deps);
    await tick();
    socket.open();
    const session = await pending;
    const iterator = session.events()[Symbol.asyncIterator]();

    await session.send(request("missing prior", "missing"));
    socket.message({
      type: "error",
      status: 404,
      error: {
        code: "previous_response_not_found",
        message: "missing response",
      },
    });
    assert.deepEqual(await iterator.next(), {
      value: {
        type: "error",
        status: 404,
        error: {
          code: "previous_response_not_found",
          message: "missing response",
        },
      },
      done: false,
    });
    assert.equal(socket.sent.length, 1);

    await session.send(request("new connection required"));
    socket.message({
      type: "error",
      error: {
        code: "websocket_connection_limit_reached",
        message: "25 minute connection limit reached",
      },
    });
    const lifetime = await iterator.next();
    assert.equal(
      !lifetime.done && lifetime.value.type === "error"
        ? lifetime.value.error.code
        : undefined,
      "websocket_connection_limit_reached",
    );
    assert.equal(socket.sent.length, 2);
    await session.close();
  });

  it("rejects HTTP-only keys at runtime", async () => {
    const socket = new FakeSocket();
    const { deps } = dependencies(socket);
    const pending = connectResponsesWebSocket(deps);
    await tick();
    socket.open();
    const session = await pending;
    await assert.rejects(
      session.send({ ...request("bad"), stream: true } as ResponsesWsCreate),
      /stream or background/,
    );
    await assert.rejects(
      session.send({ ...request("bad"), background: true } as ResponsesWsCreate),
      /stream or background/,
    );
    assert.equal(socket.sent.length, 0);
    await session.close();
  });

  it("exposes generate:false response IDs and closes an awaiting iterator", async () => {
    const socket = new FakeSocket();
    const { deps } = dependencies(socket);
    const pending = connectResponsesWebSocket(deps);
    await tick();
    socket.open();
    const session = await pending;
    const iterator = session.events()[Symbol.asyncIterator]();
    await session.send({ ...request("warmup"), generate: false });
    socket.message({
      type: "response.completed",
      response: { id: "warm_1", output: [] },
    });
    assert.deepEqual(await iterator.next(), {
      value: { type: "done", protocol: "responses", responseId: "warm_1" },
      done: false,
    });
    const waiting = iterator.next();
    await session.close();
    assert.equal((await waiting).done, true);
  });

  it("terminates the iterator after a socket error", async () => {
    const socket = new FakeSocket();
    const { deps } = dependencies(socket);
    const pending = connectResponsesWebSocket(deps);
    await tick();
    socket.open();
    const session = await pending;
    const iterator = session.events()[Symbol.asyncIterator]();
    await session.send(request("network failure"));
    socket.emit("error", new Error("network lost"));
    const event = await iterator.next();
    assert.equal(
      !event.done && event.value.type === "error"
        ? event.value.error.code
        : undefined,
      "websocket_error",
    );
    assert.equal((await iterator.next()).done, true);
  });
});
