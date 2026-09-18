import WebSocket from "ws";
import { getValidBearer } from "../auth/token-store.js";
import {
  isTerminalEvent,
  type AdapterEvent,
} from "../core/events.js";
import type { ResponsesRequest } from "../core/types.js";
import { reduceResponsesStream } from "../wire/responses-stream.js";

const RESPONSES_WS_URL = "wss://api.x.ai/v1/responses";

export type ResponsesWsCreate = Omit<
  ResponsesRequest,
  "stream" | "background"
> & {
  type: "response.create";
  generate?: boolean;
  previous_response_id?: string;
};

export interface ResponsesWsError {
  type: "error";
  status?: number;
  error: { code?: string; message?: string; param?: string };
}

export interface ResponsesWsSession {
  send(request: ResponsesWsCreate): Promise<void>;
  events(): AsyncIterable<AdapterEvent | ResponsesWsError>;
  close(code?: number, reason?: string): Promise<void>;
}

export interface ResponsesWsDeps {
  getBearer(): Promise<string>;
  createSocket(url: string, headers: Record<string, string>): WebSocket;
}

const defaultDeps: ResponsesWsDeps = {
  getBearer: getValidBearer,
  createSocket: (url, headers) => new WebSocket(url, { headers }),
};

const encoder = new TextEncoder();

interface TurnReducer {
  push(wire: unknown): void;
  close(): void;
  finishProtocolError(): void;
  done: Promise<void>;
}

function createTurnReducer(emit: (event: AdapterEvent) => void): TurnReducer {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let suppressTruncated = false;
  const source = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const done = (async () => {
    for await (const event of reduceResponsesStream(source)) {
      if (!suppressTruncated) emit(event);
      if (isTerminalEvent(event)) closed = true;
    }
  })();
  void done.finally(() => {
    closed = true;
  });

  const close = (): void => {
    if (closed) return;
    closed = true;
    controller.close();
  };

  return {
    push(wire) {
      if (closed) {
        throw new Error("Responses event arrived after the turn ended");
      }
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(wire)}\n\n`),
      );
    },
    close,
    finishProtocolError() {
      suppressTruncated = true;
      close();
    },
    done,
  };
}

function protocolError(code: string, message: string): ResponsesWsError {
  return { type: "error", error: { code, message } };
}

function parseMessage(data: WebSocket.RawData): unknown {
  try {
    return JSON.parse(data.toString()) as unknown;
  } catch {
    return protocolError(
      "invalid_websocket_json",
      "xAI Responses WebSocket returned invalid JSON",
    );
  }
}

function decodeProtocolError(wire: unknown): ResponsesWsError | undefined {
  if (wire === null || typeof wire !== "object" || Array.isArray(wire)) {
    return undefined;
  }
  const object = wire as Record<string, unknown>;
  if (object.type !== "error") return undefined;
  const rawError =
    object.error !== null &&
    typeof object.error === "object" &&
    !Array.isArray(object.error)
      ? (object.error as Record<string, unknown>)
      : {};
  return {
    type: "error",
    ...(typeof object.status === "number" ? { status: object.status } : {}),
    error: {
      ...(typeof rawError.code === "string" ? { code: rawError.code } : {}),
      ...(typeof rawError.message === "string"
        ? { message: rawError.message }
        : {}),
      ...(typeof rawError.param === "string" ? { param: rawError.param } : {}),
    },
  };
}

function validateCreate(request: ResponsesWsCreate): void {
  const wire = request as unknown as Record<string, unknown>;
  if (wire.type !== "response.create") {
    throw new TypeError("Responses WebSocket request type must be response.create");
  }
  if ("stream" in wire || "background" in wire) {
    throw new TypeError(
      "Responses WebSocket requests do not accept stream or background",
    );
  }
}

export async function connectResponsesWebSocket(
  deps: ResponsesWsDeps = defaultDeps,
): Promise<ResponsesWsSession> {
  const bearer = await deps.getBearer();
  const socket = deps.createSocket(RESPONSES_WS_URL, {
    Authorization: `Bearer ${bearer}`,
  });

  await new Promise<void>((resolve, reject) => {
    const opened = (): void => {
      cleanup();
      resolve();
    };
    const failed = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const closed = (code: number, reason: Buffer): void => {
      cleanup();
      reject(
        new Error(
          `Responses WebSocket closed before open (${code}: ${reason.toString()})`,
        ),
      );
    };
    const cleanup = (): void => {
      socket.off("open", opened);
      socket.off("error", failed);
      socket.off("close", closed);
    };
    socket.once("open", opened);
    socket.once("error", failed);
    socket.once("close", closed);
  });

  const queue: Array<AdapterEvent | ResponsesWsError> = [];
  const waiters: Array<
    (value: IteratorResult<AdapterEvent | ResponsesWsError>) => void
  > = [];
  let ended = false;
  let ending: Promise<void> | undefined;
  let sendTail = Promise.resolve();
  let activeTurn: TurnReducer | undefined;

  const push = (value: AdapterEvent | ResponsesWsError): void => {
    if (ended) return;
    const waiter = waiters.shift();
    if (waiter) waiter({ value, done: false });
    else queue.push(value);
  };

  const finish = (): Promise<void> => {
    if (ending) return ending;
    ending = (async () => {
      activeTurn?.close();
      await activeTurn?.done.catch(() => undefined);
      ended = true;
      for (const waiter of waiters.splice(0)) {
        waiter({ value: undefined, done: true });
      }
    })();
    return ending;
  };

  socket.on("message", (data) => {
    const wire = parseMessage(data);
    const error = decodeProtocolError(wire);
    if (error) {
      push(error);
      activeTurn?.finishProtocolError();
      return;
    }
    if (!activeTurn) {
      push(
        protocolError(
          "event_without_active_turn",
          "Responses event arrived without an active turn",
        ),
      );
      return;
    }
    try {
      activeTurn.push(wire);
    } catch (error) {
      activeTurn.finishProtocolError();
      push(
        protocolError(
          "invalid_turn_state",
          error instanceof Error ? error.message : "invalid turn state",
        ),
      );
    }
  });
  socket.on("error", (error) => {
    push(protocolError("websocket_error", error.message));
    activeTurn?.finishProtocolError();
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1011, "websocket error");
    }
    void finish();
  });
  socket.once("close", () => {
    void finish();
  });

  return {
    async send(request) {
      validateCreate(request);
      sendTail = sendTail.then(async () => {
        if (ended || socket.readyState !== WebSocket.OPEN) {
          throw new Error("Responses WebSocket is not open");
        }
        if (activeTurn) await activeTurn.done;
        activeTurn = createTurnReducer(push);
        try {
          await new Promise<void>((resolve, reject) => {
            socket.send(JSON.stringify(request), (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        } catch (error) {
          activeTurn.finishProtocolError();
          await activeTurn.done;
          throw error;
        }
      });
      await sendTail;
    },

    async *events() {
      while (!ended || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        const next = await new Promise<
          IteratorResult<AdapterEvent | ResponsesWsError>
        >((resolve) => waiters.push(resolve));
        if (next.done) return;
        yield next.value;
      }
    },

    async close(code = 1000, reason = "client close") {
      if (socket.readyState === WebSocket.CLOSED) {
        await finish();
        return;
      }
      if (socket.readyState !== WebSocket.CLOSING) {
        socket.close(code, reason);
      }
      await new Promise<void>((resolve) => socket.once("close", resolve));
      await finish();
    },
  };
}
