export const DEFAULT_MAX_SSE_BUFFER_BYTES = 1024 * 1024;

export interface SseEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

export interface DecodeSseOptions {
  maxBufferedBytes?: number;
}

export class SseDecodeError extends Error {
  constructor(
    readonly code: "invalid_utf8" | "sse_buffer_limit",
    message: string,
  ) {
    super(message);
    this.name = "SseDecodeError";
  }
}

function toAsyncIterable(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  if (Symbol.asyncIterator in source) return source as AsyncIterable<Uint8Array>;
  return {
    async *[Symbol.asyncIterator]() {
      const reader = (source as ReadableStream<Uint8Array>).getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

export async function* decodeServerSentEvents(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  options: DecodeSseOptions = {},
): AsyncGenerator<SseEvent> {
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_SSE_BUFFER_BYTES;
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes <= 0) {
    throw new RangeError("maxBufferedBytes must be a positive safe integer");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let residual = "";
  let eventName: string | undefined;
  let eventId: string | undefined;
  let retry: number | undefined;
  let dataLines: string[] = [];
  let dataBytes = 0;

  const assertBudget = (): void => {
    const metadataBytes =
      (eventName === undefined ? 0 : byteLength(eventName)) +
      (eventId === undefined ? 0 : byteLength(eventId));
    if (byteLength(residual) + dataBytes + metadataBytes > maxBufferedBytes) {
      throw new SseDecodeError(
        "sse_buffer_limit",
        "upstream SSE event exceeded the safe byte limit",
      );
    }
  };

  const dispatch = (): SseEvent | undefined => {
    const event = dataLines.length === 0
      ? undefined
      : {
          data: dataLines.join("\n"),
          ...(eventName !== undefined ? { event: eventName } : {}),
          ...(eventId !== undefined ? { id: eventId } : {}),
          ...(retry !== undefined ? { retry } : {}),
        };
    eventName = undefined;
    retry = undefined;
    dataLines = [];
    dataBytes = 0;
    return event;
  };

  const consumeLine = (rawLine: string): SseEvent | undefined => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") return dispatch();
    if (line.startsWith(":")) return undefined;

    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") {
      dataBytes += byteLength(value) + (dataLines.length > 0 ? 1 : 0);
      dataLines.push(value);
    } else if (field === "event") {
      eventName = value;
    } else if (field === "id" && !value.includes("\0")) {
      eventId = value;
    } else if (field === "retry" && /^\d+$/.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed)) retry = parsed;
    }
    assertBudget();
    return undefined;
  };

  const consumeDecoded = (decoded: string): SseEvent[] => {
    const events: SseEvent[] = [];
    let start = 0;
    for (;;) {
      const newline = decoded.indexOf("\n", start);
      if (newline < 0) break;
      const line = residual + decoded.slice(start, newline);
      residual = "";
      const event = consumeLine(line);
      if (event) events.push(event);
      start = newline + 1;
    }
    residual += decoded.slice(start);
    assertBudget();
    return events;
  };

  try {
    for await (const chunk of toAsyncIterable(source)) {
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError("SSE source yielded a non-Uint8Array chunk");
      }
      let decoded: string;
      try {
        decoded = decoder.decode(chunk, { stream: true });
      } catch {
        throw new SseDecodeError("invalid_utf8", "upstream SSE contained invalid UTF-8");
      }
      for (const event of consumeDecoded(decoded)) yield event;
    }

    let finalDecoded: string;
    try {
      finalDecoded = decoder.decode();
    } catch {
      throw new SseDecodeError(
        "invalid_utf8",
        "upstream SSE ended inside a UTF-8 sequence",
      );
    }
    for (const event of consumeDecoded(finalDecoded)) yield event;
    if (residual.length > 0) {
      const line = residual;
      residual = "";
      const event = consumeLine(line);
      if (event) yield event;
    }
    const finalEvent = dispatch();
    if (finalEvent) yield finalEvent;
  } finally {
    residual = "";
    dataLines = [];
    dataBytes = 0;
  }
}
