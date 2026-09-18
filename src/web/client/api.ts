import type { ResponsesRequest } from "../../core/types.js";
import type { EphemeralClientSecret } from "../../voice/protocol.js";
import type {
  ImageResult,
  ModelRecord,
  VideoJob,
} from "./contracts.js";

const LOCAL_AUTHORIZATION = "Bearer progrok-local";
const MAX_SSE_EVENT_BYTES = 1024 * 1024;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function readError(response: Response): Promise<Error> {
  const text = (await response.text()).slice(0, 4096);
  try {
    const body = asRecord(JSON.parse(text), "error response");
    const error = typeof body.error === "object" && body.error !== null
      ? asRecord(body.error, "error response.error")
      : body;
    const message = typeof error.message === "string"
      ? error.message
      : `HTTP ${response.status}`;
    return new Error(message);
  } catch {
    return new Error(text || `HTTP ${response.status}`);
  }
}

async function fetchJson(
  input: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
  });
  if (!response.ok) throw await readError(response);
  return response.json() as Promise<unknown>;
}

export async function listModels(
  signal?: AbortSignal,
): Promise<ModelRecord[]> {
  const body = asRecord(await fetchJson("/v1/models", {
    headers: { Authorization: LOCAL_AUTHORIZATION },
    signal,
  }), "/v1/models response");
  if (!Array.isArray(body.data)) {
    throw new TypeError("/v1/models response omitted data[]");
  }
  return body.data.map((entry, index) => {
    const model = asRecord(entry, `model[${index}]`);
    if (typeof model.id !== "string" || model.id.length === 0) {
      throw new TypeError(`model[${index}] omitted id`);
    }
    return {
      id: model.id,
      ...(typeof model.object === "string" ? { object: model.object } : {}),
      ...(typeof model.owned_by === "string"
        ? { owned_by: model.owned_by }
        : {}),
    };
  });
}

export async function* decodeSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let residual = "";
  let dataLines: string[] = [];
  let dataBytes = 0;

  const assertBudget = (): void => {
    if (byteLength(residual) + dataBytes > MAX_SSE_EVENT_BYTES) {
      throw new Error("Responses SSE event exceeded the safe byte limit");
    }
  };

  const dispatch = (): unknown | undefined => {
    if (dataLines.length === 0) return undefined;
    const data = dataLines.join("\n");
    dataLines = [];
    dataBytes = 0;
    if (data === "[DONE]") return undefined;
    try {
      return JSON.parse(data) as unknown;
    } catch {
      throw new Error("Responses SSE contained malformed JSON");
    }
  };

  const consumeLine = (rawLine: string): unknown | undefined => {
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
      assertBudget();
    }
    return undefined;
  };

  const consumeDecoded = (decoded: string): unknown[] => {
    const events: unknown[] = [];
    let start = 0;
    for (;;) {
      const newline = decoded.indexOf("\n", start);
      if (newline < 0) break;
      const event = consumeLine(residual + decoded.slice(start, newline));
      residual = "";
      if (event !== undefined) events.push(event);
      start = newline + 1;
    }
    residual += decoded.slice(start);
    assertBudget();
    return events;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let decoded: string;
      try {
        decoded = decoder.decode(value, { stream: true });
      } catch {
        throw new Error("Responses SSE contained invalid UTF-8");
      }
      for (const event of consumeDecoded(decoded)) yield event;
    }
    let finalDecoded: string;
    try {
      finalDecoded = decoder.decode();
    } catch {
      throw new Error("Responses SSE ended inside a UTF-8 sequence");
    }
    for (const event of consumeDecoded(finalDecoded)) yield event;
    if (residual.length > 0) {
      const line = residual;
      residual = "";
      const event = consumeLine(line);
      if (event !== undefined) yield event;
    }
    const finalEvent = dispatch();
    if (finalEvent !== undefined) yield finalEvent;
  } finally {
    dataLines = [];
    residual = "";
    reader.releaseLock();
  }
}

export async function* streamResponses(
  request: ResponsesRequest,
  signal: AbortSignal,
): AsyncGenerator<unknown> {
  const response = await fetch("/v1/responses", {
    method: "POST",
    headers: {
      Authorization: LOCAL_AUTHORIZATION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw await readError(response);
  if (!response.body) throw new Error("Responses stream has no body");
  yield* decodeSse(response.body);
}

export async function mintClientSecret(
  signal?: AbortSignal,
): Promise<EphemeralClientSecret> {
  const body = asRecord(await fetchJson("/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: LOCAL_AUTHORIZATION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expires_after: { seconds: 300 } }),
    cache: "no-store",
    signal,
  }), "client secret response");
  if (
    typeof body.value !== "string" ||
    body.value.length === 0 ||
    !Number.isSafeInteger(body.expires_at)
  ) {
    throw new TypeError("Invalid realtime client secret response");
  }
  return { value: body.value, expires_at: body.expires_at as number };
}

export async function generateImages(
  input: { model: string; prompt: string; count: number },
  signal?: AbortSignal,
): Promise<ImageResult[]> {
  const body = asRecord(await fetchJson("/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: LOCAL_AUTHORIZATION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      n: input.count,
      response_format: "b64_json",
    }),
    signal,
  }), "image response");
  if (!Array.isArray(body.data)) {
    throw new TypeError("Image response omitted data[]");
  }
  return body.data.map((entry, index) => {
    const image = asRecord(entry, `image[${index}]`);
    const url = typeof image.url === "string"
      ? image.url
      : typeof image.b64_json === "string"
        ? `data:image/png;base64,${image.b64_json}`
        : undefined;
    if (!url) throw new TypeError(`image[${index}] omitted url and b64_json`);
    return {
      url,
      ...(typeof image.revised_prompt === "string"
        ? { revisedPrompt: image.revised_prompt }
        : {}),
    };
  });
}

export async function submitVideo(
  input: {
    model: string;
    prompt: string;
    duration: number;
    aspectRatio: string;
    resolution: string;
  },
  signal?: AbortSignal,
): Promise<string> {
  const body = asRecord(await fetchJson("/v1/videos/generations", {
    method: "POST",
    headers: {
      Authorization: LOCAL_AUTHORIZATION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      duration: input.duration,
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
    }),
    signal,
  }), "video response");
  if (typeof body.request_id !== "string" || body.request_id.length === 0) {
    throw new TypeError("Video response omitted request_id");
  }
  return body.request_id;
}

export async function readVideoJob(
  requestId: string,
  signal?: AbortSignal,
): Promise<VideoJob> {
  const body = asRecord(await fetchJson(
    `/v1/videos/${encodeURIComponent(requestId)}`,
    {
      headers: { Authorization: LOCAL_AUTHORIZATION },
      signal,
    },
  ), "video job response");
  const status = body.status;
  if (
    status !== "pending" &&
    status !== "done" &&
    status !== "failed" &&
    status !== "expired"
  ) {
    throw new TypeError(`Unknown video status: ${String(status)}`);
  }
  const video = typeof body.video === "object" && body.video !== null
    ? asRecord(body.video, "video job video")
    : undefined;
  const error = typeof body.error === "object" && body.error !== null
    ? asRecord(body.error, "video job error")
    : undefined;
  return {
    requestId,
    status,
    ...(typeof body.progress === "number" ? { progress: body.progress } : {}),
    ...(typeof video?.url === "string" ? { videoUrl: video.url } : {}),
    ...(typeof error?.message === "string"
      ? { error: error.message }
      : typeof body.error === "string"
        ? { error: body.error }
        : {}),
  };
}
