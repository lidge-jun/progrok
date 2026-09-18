import { randomUUID } from "node:crypto";
import WebSocket, { type ClientOptions, type RawData } from "ws";
import { getValidBearerSnapshot } from "../auth/token-manager.js";
import { buildUpstreamHeaders } from "../transport/headers.js";
import { readPackageVersion } from "../utils/version.js";
import {
  XAI_VOICE_WS_ORIGIN,
  VoiceProtocolError,
  ephemeralProtocols,
  parseSttServerEvent,
  parseTtsServerEvent,
  type SttClientControl,
  type SttServerEvent,
  type TtsClientEvent,
  type TtsServerEvent,
} from "./protocol.js";

export { ephemeralProtocols } from "./protocol.js";

export const VOICE_WS_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

/** Shared by both session builders, so it lives with the transport. */
export type StreamingSampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
export const VOICE_WS_MAX_QUEUE_BYTES = 32 * 1024 * 1024;
export const VOICE_WS_OPEN_TIMEOUT_MS = 30_000;

export type VoiceWsAuth =
  | { kind: "oauth" }
  | { kind: "ephemeral"; clientSecret: string };

export type VoiceWsFrame =
  | { kind: "text"; text: string }
  | { kind: "binary"; bytes: Uint8Array }
  | { kind: "close"; code: number; reason: string };

export interface VoiceSocket {
  sendJson(value: unknown): void;
  sendBinary(bytes: Uint8Array): void;
  frames(): AsyncGenerator<VoiceWsFrame>;
  close(code?: number, reason?: string): void;
}

export interface VoiceWsDeps {
  dial?: typeof WebSocket;
  endpointOrigin?: string;
  clientVersion?: string;
}

class VoiceHandshakeError extends Error {
  constructor(readonly status: number) {
    super(`Voice WebSocket handshake failed with HTTP ${status}`);
    this.name = "VoiceHandshakeError";
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function rawBytes(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

async function dialVoiceSocket(
  url: URL,
  protocols: string[],
  options: ClientOptions,
  signal: AbortSignal | undefined,
  Ctor: typeof WebSocket,
): Promise<VoiceSocket> {
  if (signal?.aborted) throw abortReason(signal);

  const ws = new Ctor(url, protocols, options);
  ws.binaryType = "arraybuffer";
  const queue: Array<{ frame: VoiceWsFrame; size: number }> = [];
  let queuedBytes = 0;
  let wake: (() => void) | undefined;
  let terminalError: Error | undefined;
  let framesStarted = false;
  let opened = false;
  let closeRequested = false;

  const notify = (): void => {
    const current = wake;
    wake = undefined;
    current?.();
  };
  const enqueue = (frame: VoiceWsFrame, size: number): void => {
    if (frame.kind !== "close" && queuedBytes + size > VOICE_WS_MAX_QUEUE_BYTES) {
      terminalError = new VoiceProtocolError("queue_limit", "Voice WebSocket receive queue exceeded its byte limit");
      queue.length = 0;
      queuedBytes = 0;
      if (!closeRequested) {
        closeRequested = true;
        ws.close(1009, "voice receive queue exceeded");
      }
      notify();
      return;
    }
    queuedBytes += size;
    queue.push({ frame, size });
    notify();
  };
  const onMessage = (data: RawData, isBinary: boolean): void => {
    const bytes = rawBytes(data);
    enqueue(
      isBinary
        ? { kind: "binary", bytes: bytes.slice() }
        : { kind: "text", text: Buffer.from(bytes).toString("utf8") },
      bytes.byteLength,
    );
  };
  const onClose = (code: number, reason: Buffer): void => {
    signal?.removeEventListener("abort", onAbort);
    enqueue({ kind: "close", code, reason: reason.toString("utf8") }, 0);
  };
  const onAbort = (): void => {
    if (opened) {
      if (!closeRequested) {
        closeRequested = true;
        ws.close(1000, "caller aborted");
      }
      return;
    }
    ws.terminate();
  };
  ws.on("message", onMessage);
  ws.on("close", onClose);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (run: () => void): void => {
        if (settled) return;
        settled = true;
        ws.off("open", onOpen);
        ws.off("unexpected-response", onUnexpectedResponse);
        signal?.removeEventListener("abort", onDialAbort);
        run();
      };
      const onOpen = (): void => finish(() => { opened = true; resolve(); });
      const onError = (): void => {
        if (!opened) finish(() => reject(new Error("Voice WebSocket connection failed")));
      };
      const onUnexpectedResponse = (_request: unknown, response: import("node:http").IncomingMessage): void => {
        response.resume();
        finish(() => reject(new VoiceHandshakeError(response.statusCode ?? 0)));
      };
      const onDialAbort = (): void => finish(() => reject(abortReason(signal!)));
      ws.once("open", onOpen);
      ws.once("error", onError);
      ws.once("unexpected-response", onUnexpectedResponse);
      signal?.addEventListener("abort", onDialAbort, { once: true });
    });
  } catch (error) {
    signal?.removeEventListener("abort", onAbort);
    ws.removeAllListeners();
    ws.on("error", () => undefined);
    if (ws.readyState === WebSocket.OPEN) ws.terminate();
    throw error;
  }

  // WebSocket emits post-open errors before close; retaining a listener prevents
  // EventEmitter from turning a transport failure into an uncaught exception.
  ws.on("error", () => undefined);

  const ensureOpen = (): void => {
    if (ws.readyState !== WebSocket.OPEN || terminalError) throw new Error("Voice WebSocket is not open");
  };
  return {
    sendJson(value) {
      ensureOpen();
      ws.send(JSON.stringify(value));
    },
    sendBinary(bytes) {
      ensureOpen();
      ws.send(bytes, { binary: true });
    },
    async *frames() {
      if (framesStarted) throw new Error("Voice WebSocket frames can only be consumed once");
      framesStarted = true;
      for (;;) {
        if (terminalError) throw terminalError;
        const next = queue.shift();
        if (next) {
          queuedBytes -= next.size;
          yield next.frame;
          if (next.frame.kind === "close") return;
          continue;
        }
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    },
    close(code = 1000, reason = "client close") {
      signal?.removeEventListener("abort", onAbort);
      if (closeRequested || ws.readyState === WebSocket.CLOSED) return;
      closeRequested = true;
      ws.close(code, reason);
    },
  };
}

export async function openVoiceSocket(
  path: string,
  auth: VoiceWsAuth,
  signal: AbortSignal | undefined,
  deps: VoiceWsDeps,
): Promise<VoiceSocket> {
  if (signal?.aborted) throw abortReason(signal);
  const origin = deps.endpointOrigin ?? XAI_VOICE_WS_ORIGIN;
  const url = new URL(path, origin);
  if (!deps.endpointOrigin && (url.protocol !== "wss:" || url.hostname !== "api.x.ai")) {
    throw new Error("Voice WebSocket destination must be api.x.ai over wss");
  }
  const Ctor = deps.dial ?? WebSocket;
  const baseOptions: ClientOptions = {
    maxPayload: VOICE_WS_MAX_MESSAGE_BYTES,
    handshakeTimeout: VOICE_WS_OPEN_TIMEOUT_MS,
    perMessageDeflate: false,
  };
  if (auth.kind === "ephemeral") {
    return dialVoiceSocket(url, ephemeralProtocols(auth.clientSecret), baseOptions, signal, Ctor);
  }

  const connect = async (bearer: string): Promise<VoiceSocket> => {
    const headers = buildUpstreamHeaders({
      auth: { kind: "oauth", bearer },
      clientVersion: deps.clientVersion ?? readPackageVersion(),
      trace: { requestId: randomUUID() },
    });
    return dialVoiceSocket(url, [], { ...baseOptions, headers: Object.fromEntries(headers) }, signal, Ctor);
  };
  const first = await getValidBearerSnapshot({ signal });
  try {
    return await connect(first.bearer);
  } catch (error) {
    if (!(error instanceof VoiceHandshakeError) || error.status !== 401) throw error;
    const refreshed = await getValidBearerSnapshot({
      forceRefresh: true,
      rejectedAccessToken: first.bearer,
      signal,
    });
    return connect(refreshed.bearer);
  }
}
