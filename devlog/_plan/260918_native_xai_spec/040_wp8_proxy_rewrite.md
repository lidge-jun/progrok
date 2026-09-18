# wp8 — 네이티브 코어 기반 프록시 재작성 PRD

## 0. 목적

현재 `src/proxy/server.ts`는 인증 토큰을 넣고 모든 `/v1/*` 요청과 응답 byte를 전달한다. 이 단계는 외부 HTTP 계약을 그대로 유지하면서 JSON 추론 요청을 분류하고, 스트리밍 Chat/Responses 성공 응답만 wp7의 typed event 파이프라인으로 파싱·재직렬화한다. 바이너리, multipart, 저장 API, 신규 미지원 경로는 검증된 backpressure relay로 남긴다.

이 문서는 2026-09-18 현재 소스를 기준으로 한다.

- `src/proxy/server.ts:42-48`의 `/health`, `app.all("/v1/*")` 계약
- `src/proxy/server.ts:56-64`의 401 JSON
- `src/proxy/server.ts:66-84`의 100MB body 상한과 POST transform
- `src/proxy/server.ts:86-138`의 query/header/status/stream relay와 502 JSON
- `src/proxy/composer-inject.ts:184-220`의 fail-safe body transform
- `src/chat/server.ts:15`와 `src/commands/proxy.ts:29`의 `createProxyApp`/`startProxy` 호출

## 1. 구조 결정

선택한 경계:

```text
Express ingress
  -> auth + bounded body read
  -> route-policy (pure)
     -> native Chat/Responses stream: wp6 fetch -> wp7 reducer -> protocol renderer
     -> JSON transform relay: object composer transform -> wp6 fetch -> verified byte relay
     -> opaque relay: original bytes -> wp6 fetch -> verified byte relay
```

거절한 대안:

- 모든 `/v1/*`를 JSON으로 추정하는 방식은 multipart STT와 binary payload를 깨므로 거절한다.
- endpoint allowlist로 미지원 경로를 404 처리하는 방식은 현재의 “all methods, all `/v1/*`” 공개 계약을 깨므로 거절한다.
- upstream 성공 SSE를 그대로 relay하면서 옆에서만 파싱하는 방식은 native parser 오류가 downstream 계약에 반영되지 않아 로드맵 목표를 충족하지 못하므로 거절한다.
- server 한 파일에 route 분류, upstream I/O, SSE 렌더링을 다시 합치는 방식은 wp7에서 만든 경계를 무효화하므로 거절한다.

의존 방향은 `proxy -> transport`, `proxy -> wire`, `proxy -> core`다. `transport`나 `wire`는 Express를 import하지 않는다.

## 2. 경로 처리 매트릭스

route 판정은 method, pathname, content-type, 그리고 bounded body를 JSON object로 파싱한 결과만 사용한다. query string은 판정에서 제외하고 upstream URL에는 byte-for-byte 보존한다.

| Method / path | 조건 | 처리 | 응답 |
|---|---|---|---|
| `POST /v1/chat/completions` | `application/json`, object, `stream === true` | composer object transform 후 네이티브 Chat stream | wp7 Chat reducer -> Chat SSE renderer |
| `POST /v1/responses` | `application/json`, object, `stream === true` | composer/search object transform 후 네이티브 Responses stream | wp7 Responses reducer -> Responses SSE renderer |
| 위 두 POST | JSON object, stream false/absent | JSON transform relay | upstream status/header/body 검증 relay |
| 위 두 POST | malformed JSON 또는 JSON이 아닌 content-type | opaque relay | 원본 body 그대로 relay |
| `GET/DELETE /v1/responses/{id}` | 모두 | opaque relay | 그대로 relay |
| `POST /v1/responses/compact` | 모두 | opaque relay | 그대로 relay; wp11 전까지 native 대상 아님 |
| `POST /v1/tts` | JSON | opaque relay | audio/binary 그대로 relay |
| `POST /v1/stt` | multipart | opaque relay | multipart boundary와 field order 보존 |
| `/v1/images/*`, `/v1/videos/*`, files, batches, collections, skills | 전 메서드 | opaque relay | 그대로 relay |
| `/v1/realtime/*`의 HTTP endpoint | 전 메서드 | opaque relay | 그대로 relay |
| 알 수 없는 모든 `/v1/*` | 전 메서드 | opaque relay | 그대로 relay; local 404 금지 |
| `/health` | GET | local | 정확히 현재 JSON |

WebSocket upgrade는 이번 Express HTTP 단계에서 새로 구현하지 않는다. wp10의 전용 WS 서버가 소유한다. HTTP `/v1/*` 포워딩 범위는 축소하지 않는다.

## 3. 변경 파일 manifest

| 상태 | 정확한 경로 | 책임 |
|---|---|---|
| NEW | `src/proxy/route-policy.ts` | native/json-relay/opaque-relay 순수 판정 |
| NEW | `src/proxy/body.ts` | 모든 메서드 공통 100MB bounded body read |
| NEW | `src/proxy/relay.ts` | 요청/응답 헤더 필터와 backpressure relay |
| NEW | `src/proxy/render-chat.ts` | `AdapterEvent`를 Chat SSE로 직렬화 |
| NEW | `src/proxy/render-responses.ts` | `AdapterEvent`를 Responses SSE로 직렬화 |
| NEW | `src/proxy/native-stream.ts` | reducer 선택, 첫 이벤트 preflight, renderer 구동 |
| MODIFY | `src/proxy/server.ts` | ingress orchestration만 남기고 새 모듈 조립 |
| MODIFY | `src/proxy/composer-inject.ts` | object transform 공개, 기존 Buffer API 호환 유지 |
| MODIFY | `tests/proxy.test.ts` | 실제 xAI 의존 제거, 보존 계약과 route matrix 검증 |
| MODIFY | `tests/composer-inject.test.ts` | object transform과 기존 wrapper 동치 검증 |
| NEW | `tests/proxy-native-stream.test.ts` | Chat/Responses native round-trip와 mid-stream 오류 검증 |

DELETE는 없다. `src/commands/proxy.ts`, `src/chat/server.ts`, `~/.progrok/auth.json` 소유 코드는 건드리지 않는다.

## 4. NEW — `src/proxy/route-policy.ts`

```ts
export type ProxyRouteDecision =
  | { kind: "native-chat"; json: Record<string, unknown> }
  | { kind: "native-responses"; json: Record<string, unknown> }
  | { kind: "json-relay"; json: Record<string, unknown> }
  | { kind: "opaque-relay" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

export function decideProxyRoute(input: {
  method: string;
  relPath: string;
  contentType?: string;
  body: Buffer;
}): ProxyRouteDecision {
  if (input.method.toUpperCase() !== "POST") return { kind: "opaque-relay" };
  if (input.relPath !== "/chat/completions" && input.relPath !== "/responses") {
    return { kind: "opaque-relay" };
  }
  if (!isJsonContentType(input.contentType)) return { kind: "opaque-relay" };

  let parsed: unknown;
  try { parsed = JSON.parse(input.body.toString("utf8")); }
  catch { return { kind: "opaque-relay" }; }
  if (!isRecord(parsed)) return { kind: "opaque-relay" };
  if (parsed.stream !== true) return { kind: "json-relay", json: parsed };
  return input.relPath === "/responses"
    ? { kind: "native-responses", json: parsed }
    : { kind: "native-chat", json: parsed };
}
```

`stream: "true"`, `1`, truthy object는 native로 승격하지 않는다. protocol field를 타입 검증 없이 해석하지 않는다.

## 5. NEW — `src/proxy/body.ts`

```ts
import type { Request } from "express";

export const MAX_PROXY_BODY_BYTES = 100 * 1024 * 1024;

export class PayloadTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Request body exceeds ${limitBytes / 1024 / 1024}MB limit`);
    this.name = "PayloadTooLargeError";
  }
}

export async function readBoundedBody(
  req: Request,
  limitBytes = MAX_PROXY_BODY_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.byteLength;
    if (total > limitBytes) {
      req.resume(); // 나머지는 저장하지 않고 drain하여 413 응답을 전달할 수 있게 한다.
      throw new PayloadTooLargeError(limitBytes);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}
```

`Content-Length`만 믿고 거절하지 않는다. 선언값은 빠른 사전 413에 사용할 수 있지만 실제 stream 누적 검사가 최종 권위자다. GET/DELETE body도 현재처럼 전달하므로 모든 메서드에 같은 상한을 적용한다.

## 6. NEW — `src/proxy/relay.ts`

### 포트와 핵심 본문

```ts
import { once } from "node:events";
import type { Response as ExpressResponse } from "express";

export const HOP_BY_HOP_HEADERS = new Set([
  "host", "content-length", "connection", "keep-alive",
  "proxy-authenticate", "proxy-authorization", "te", "trailers",
  "transfer-encoding", "upgrade", "authorization",
]);

export function filterRequestHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase()) || value === undefined) continue;
    output[key] = Array.isArray(value) ? value[0] ?? "" : value;
  }
  return output;
}

export function copyUpstreamHeaders(upstream: Response, res: ExpressResponse): void {
  for (const [key, value] of upstream.headers) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === "content-length" || lower === "content-encoding") continue;
    res.setHeader(key, value);
  }
}

export async function relayUpstreamResponse(
  upstream: Response,
  res: ExpressResponse,
): Promise<void> {
  res.status(upstream.status);
  copyUpstreamHeaders(upstream, res);
  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await once(res, "drain");
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}
```

wp6의 `executeXaiFetch`가 프록시의 exact upstream seam이다. 프록시는 bearer를 두 번째 인자로 전달하고, replay 가능성은 wp6의 `classifyReplay(method, headers)`가 판정한다. 응답 헤더 이후나 stream 중간 실패는 절대 재시도하지 않는다.

## 7. NEW — protocol renderer

### `src/proxy/render-chat.ts`

```ts
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type { AdapterEvent } from "../core/events.js";

export interface ChatRenderContext {
  model: string;
  id?: string;
  created?: number;
}

function writeData(res: Response, value: unknown): void {
  res.write(`data: ${JSON.stringify(value)}\n\n`);
}

export async function renderChatEvents(
  first: AdapterEvent,
  rest: AsyncIterator<AdapterEvent>,
  res: Response,
  context: ChatRenderContext,
): Promise<void> {
  const id = context.id ?? `chatcmpl_progrok_${randomUUID()}`;
  const created = context.created ?? Math.floor(Date.now() / 1000);
  const toolIndexes = new Map<string, number>();
  let nextToolIndex = 0;

  const render = (event: AdapterEvent): boolean => {
    const base = { id, object: "chat.completion.chunk", created, model: context.model };
    if (event.type === "heartbeat") { res.write(": progrok\n\n"); return false; }
    if (event.type === "text_delta") {
      writeData(res, { ...base, choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }] });
    } else if (event.type === "reasoning_delta") {
      writeData(res, { ...base, choices: [{ index: 0, delta: { reasoning_content: event.text }, finish_reason: null }] });
    } else if (event.type === "tool_call_start") {
      const index = nextToolIndex++;
      toolIndexes.set(event.id, index);
      writeData(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index, id: event.id, type: "function", function: { name: event.name, arguments: "" } }] }, finish_reason: null }] });
    } else if (event.type === "tool_call_delta") {
      writeData(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: toolIndexes.get(event.id), function: { arguments: event.arguments } }] }, finish_reason: null }] });
    } else if (event.type === "done") {
      writeData(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: event.finishReason ?? "stop" }], ...(event.usage ? { usage: event.usage.raw ?? event.usage } : {}) });
      res.write("data: [DONE]\n\n");
      return true;
    } else if (event.type === "error") {
      writeData(res, { error: { message: event.message, type: "upstream_error", code: event.code } });
      return true;
    }
    return false;
  };

  if (render(first)) return;
  for (;;) {
    const next = await rest.next();
    if (next.done || render(next.value)) return;
  }
}
```

`done`은 reducer terminal 하나를 Chat wire의 finish chunk + `[DONE]` 쌍으로 렌더링한다. 이것은 wire 표현 하나이며 두 개의 canonical terminal이 아니다. `error` 뒤 `[DONE]`은 쓰지 않는다.

### `src/proxy/render-responses.ts`

```ts
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type { AdapterEvent } from "../core/events.js";

function writeEvent(res: Response, type: string, payload: Record<string, unknown>): void {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
}

export async function renderResponsesEvents(
  first: AdapterEvent,
  rest: AsyncIterator<AdapterEvent>,
  res: Response,
  model: string,
): Promise<void> {
  const responseId = `resp_progrok_${randomUUID()}`;
  const output: Record<string, unknown>[] = [];
  const itemByCall = new Map<string, Record<string, unknown>>();
  let outputIndex = 0;
  writeEvent(res, "response.created", { response: { id: responseId, object: "response", status: "in_progress", model, output: [] } });

  const render = (event: AdapterEvent): boolean => {
    if (event.type === "heartbeat") { res.write(": progrok\n\n"); return false; }
    if (event.type === "text_delta") {
      writeEvent(res, "response.output_text.delta", { response_id: responseId, output_index: 0, content_index: 0, delta: event.text });
    } else if (event.type === "reasoning_delta") {
      writeEvent(res, "response.reasoning_text.delta", { response_id: responseId, delta: event.text });
    } else if (event.type === "tool_call_start") {
      const item = { id: `fc_${randomUUID()}`, type: "function_call", status: "in_progress", call_id: event.id, name: event.name, arguments: "" };
      itemByCall.set(event.id, item);
      output.push(item);
      writeEvent(res, "response.output_item.added", { response_id: responseId, output_index: outputIndex++, item });
    } else if (event.type === "tool_call_delta") {
      const item = itemByCall.get(event.id);
      if (item) item.arguments = String(item.arguments) + event.arguments;
      writeEvent(res, "response.function_call_arguments.delta", { response_id: responseId, item_id: item?.id, delta: event.arguments });
    } else if (event.type === "tool_call_end") {
      const item = itemByCall.get(event.id);
      if (item) { item.status = "completed"; writeEvent(res, "response.output_item.done", { response_id: responseId, item }); }
    } else if (event.type === "done") {
      writeEvent(res, "response.completed", { response: { id: event.responseId ?? responseId, object: "response", status: "completed", model, output, ...(event.usage ? { usage: event.usage.raw ?? event.usage } : {}) } });
      return true;
    } else if (event.type === "incomplete") {
      writeEvent(res, "response.incomplete", { response: { id: event.responseId ?? responseId, object: "response", status: "incomplete", incomplete_details: { reason: event.reason }, output } });
      return true;
    } else if (event.type === "error") {
      writeEvent(res, "error", { error: { message: event.message, type: "upstream_error", code: event.code } });
      return true;
    }
    return false;
  };

  if (render(first)) return;
  for (;;) {
    const next = await rest.next();
    if (next.done || render(next.value)) return;
  }
}
```

문자열 누적은 wp7의 8MB tool budget 안에서만 도달한다. text 전체 snapshot은 쌓지 않고 delta만 전달한다.

## 8. NEW — `src/proxy/native-stream.ts`

```ts
import type { Response as ExpressResponse } from "express";
import { isTerminalEvent } from "../core/events.js";
import { reduceChatStream } from "../wire/chat-stream.js";
import { reduceResponsesStream } from "../wire/responses-stream.js";
import { copyUpstreamHeaders } from "./relay.js";
import { renderChatEvents } from "./render-chat.js";
import { renderResponsesEvents } from "./render-responses.js";

export type NativeProtocol = "chat" | "responses";

export async function serveNativeStream(input: {
  protocol: NativeProtocol;
  upstream: Response;
  downstream: ExpressResponse;
  model: string;
}): Promise<"handled" | "relay"> {
  const contentType = input.upstream.headers.get("content-type")?.toLowerCase() ?? "";
  if (!input.upstream.ok || !input.upstream.body || !contentType.includes("text/event-stream")) {
    return "relay";
  }
  const events = input.protocol === "chat"
    ? reduceChatStream(input.upstream.body)
    : reduceResponsesStream(input.upstream.body);
  const iterator = events[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) throw new Error("native stream parser produced no terminal event");

  // 첫 event부터 parser error면 HTTP가 아직 commit되지 않았으므로 server가 기존 502 JSON을 쓸 수 있다.
  if (first.value.type === "error") throw Object.assign(new Error(first.value.message), { code: first.value.code });

  input.downstream.status(input.upstream.status);
  copyUpstreamHeaders(input.upstream, input.downstream);
  input.downstream.setHeader("content-type", "text/event-stream; charset=utf-8");
  input.downstream.setHeader("cache-control", "no-cache");
  if (input.protocol === "chat") {
    await renderChatEvents(first.value, iterator, input.downstream, { model: input.model });
  } else {
    await renderResponsesEvents(first.value, iterator, input.downstream, input.model);
  }
  input.downstream.end();
  return "handled";
}
```

`isTerminalEvent` import는 구현에서 generator가 terminal 없이 끝난 경우의 assertion에 사용한다. renderer loop가 EOF를 만나면 마지막 관측 event가 terminal인지 검사하고 아니면 protocol-native `stream_truncated` error를 쓴 뒤 닫는다.

## 9. MODIFY — `src/proxy/composer-inject.ts`

### 현재 코드

현재 `src/proxy/composer-inject.ts:184-220`은 Buffer를 직접 JSON parse하고 transform 후 재직렬화한다.

```ts
export function prepareGrokRequest(relPath: string, body: Buffer): Buffer {
  if (!INJECT_PATHS.has(relPath)) return body;
  if (body.length === 0) return body;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  } catch {
    return body; // not JSON — pass through untouched
  }

  try {
    const composerDisabled =
      process.env["PROGROK_DISABLE_COMPOSER_INJECT"] === "1";
    const searched = injectServerSideSearch(relPath, parsed);
    let stripped = false;
    let injected = false;
    if (!composerDisabled && isComposerModel(parsed["model"])) {
      stripped = stripReasoningEffort(parsed);
      injected = injectToolDiscipline(relPath, parsed);
    }
    if (!searched && !stripped && !injected) return body;
    const notes = [
      searched ? "injected server-side search" : "",
      stripped ? "stripped reasoning_effort" : "",
      injected ? "injected tool-discipline" : "",
    ]
      .filter(Boolean)
      .join(", ");
    log.dim(`[progrok] grok request adjusted (${relPath}): ${notes}`);
    return Buffer.from(JSON.stringify(parsed), "utf8");
  } catch (err) {
    log.dim(`[progrok] grok transform skipped: ${(err as Error).message}`);
    return body;
  }
}
```

### 변경 후

helper들은 유지하고 object API를 canonical owner로 만든다. 기존 Buffer API는 CLI 외 소비 가능성을 고려해 삭제하지 않는다.

```ts
export interface PreparedGrokRequest {
  value: Record<string, unknown>;
  changed: boolean;
}

export function prepareGrokRequestObject(
  relPath: string,
  parsed: Record<string, unknown>,
): PreparedGrokRequest {
  if (!INJECT_PATHS.has(relPath)) return { value: parsed, changed: false };
  try {
    const composerDisabled = process.env["PROGROK_DISABLE_COMPOSER_INJECT"] === "1";
    const searched = injectServerSideSearch(relPath, parsed);
    let stripped = false;
    let injected = false;
    if (!composerDisabled && isComposerModel(parsed["model"])) {
      stripped = stripReasoningEffort(parsed);
      injected = injectToolDiscipline(relPath, parsed);
    }
    const changed = searched || stripped || injected;
    if (changed) {
      const notes = [
        searched ? "injected server-side search" : "",
        stripped ? "stripped reasoning_effort" : "",
        injected ? "injected tool-discipline" : "",
      ].filter(Boolean).join(", ");
      log.dim(`[progrok] grok request adjusted (${relPath}): ${notes}`);
    }
    return { value: parsed, changed };
  } catch (err) {
    log.dim(`[progrok] grok transform skipped: ${(err as Error).message}`);
    return { value: parsed, changed: false };
  }
}

export function prepareGrokRequest(relPath: string, body: Buffer): Buffer {
  if (!INJECT_PATHS.has(relPath) || body.length === 0) return body;
  let parsed: unknown;
  try { parsed = JSON.parse(body.toString("utf8")); }
  catch { return body; }
  if (!isObject(parsed)) return body;
  const prepared = prepareGrokRequestObject(relPath, parsed);
  return prepared.changed ? Buffer.from(JSON.stringify(prepared.value), "utf8") : body;
}
```

## 10. MODIFY — `src/proxy/server.ts`

### 현재 코드와 문제 지점

현재 import와 local owner는 `src/proxy/server.ts:1-37`에 있다.

```ts
import { prepareGrokRequest } from "./composer-inject.js";

const MAX_BODY_BYTES = 100 * 1024 * 1024; // 100 MB

const HOP_BY_HOP = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "authorization",
]);

function filterHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && value) {
      out[key] = Array.isArray(value) ? value[0] : value;
    }
  }
  return out;
}
```

현재 body/transform/upstream stream은 `src/proxy/server.ts:66-128`에 결합돼 있다.

```ts
const chunks: Buffer[] = [];
let totalBytes = 0;
for await (const chunk of req) {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
  totalBytes += buf.length;
  if (totalBytes > MAX_BODY_BYTES) {
    res.status(413).json({
      error: {
        message: `Request body exceeds ${MAX_BODY_BYTES / 1024 / 1024}MB limit`,
        type: "payload_too_large",
      },
    });
    return;
  }
  chunks.push(buf);
}
const body = Buffer.concat(chunks);
const fwdBody =
  req.method === "POST" ? prepareGrokRequest(relPath, body) : body;

const qsIdx = req.url.indexOf("?");
const qs = qsIdx >= 0 ? req.url.slice(qsIdx) : "";
const upstreamUrl = `${XAI_API_BASE_URL}${relPath}${qs}`;
const fwdHeaders = filterHeaders(
  req.headers as Record<string, string>,
);
fwdHeaders["Authorization"] = `Bearer ${bearer}`;

try {
  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers: fwdHeaders,
    body: fwdBody.length > 0 ? new Uint8Array(fwdBody) : undefined,
  });

  res.status(upstream.status);

  for (const [key, value] of upstream.headers) {
    const lower = key.toLowerCase();
    if (
      !HOP_BY_HOP.has(lower) &&
      lower !== "content-encoding" &&
      lower !== "content-length"
    ) {
      res.setHeader(key, value);
    }
  }

  if (upstream.body) {
    const reader = (
      upstream.body as ReadableStream<Uint8Array>
    ).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch (streamErr) {
      log.dim(`[progrok] stream read interrupted: ${(streamErr as Error).message}`);
    }
  }
  res.end();
} catch (err) {
  if (!res.headersSent) {
    res.status(502).json({
      error: {
        message: `Upstream error: ${(err as Error).message}`,
        type: "upstream_error",
      },
    });
  }
}
```

### 변경 후

`createProxyApp()`의 인자 없는 호출은 계속 동작한다. 테스트용 dependency injection은 optional이다.

```ts
import express, { type Request, type Response } from "express";
import { PROXY_DEFAULT_HOST, PROXY_DEFAULT_PORT } from "../auth/constants.js";
import { getValidBearerSnapshot } from "../auth/token-manager.js";
import { executeXaiFetch } from "../transport/fetch.js";
import { log } from "../utils/logger.js";
import { readBoundedBody, PayloadTooLargeError } from "./body.js";
import { prepareGrokRequestObject } from "./composer-inject.js";
import { serveNativeStream } from "./native-stream.js";
import { decideProxyRoute } from "./route-policy.js";
import {
  filterRequestHeaders,
  relayUpstreamResponse,
} from "./relay.js";

export interface ProxyAppDependencies {
  getBearer(): Promise<string>;
  fetchUpstream: typeof executeXaiFetch;
}

const DEFAULT_DEPS: ProxyAppDependencies = {
  getBearer: async () => (await getValidBearerSnapshot()).bearer,
  fetchUpstream: executeXaiFetch,
};

export function createProxyApp(
  deps?: Partial<ProxyAppDependencies>,
): express.Express {
  const resolvedDeps = { ...DEFAULT_DEPS, ...deps };
  const app = express();
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", upstream: "xAI Grok", proxy: "progrok" });
  });
  app.all("/v1/*", (req: Request, res: Response) => {
    void handleProxy(req, res, resolvedDeps);
  });
  return app;
}

async function handleProxy(
  req: Request,
  res: Response,
  deps: ProxyAppDependencies,
): Promise<void> {
  const relPath = req.path.replace(/^\/v1/, "");
  let bearer: string;
  try { bearer = await deps.getBearer(); }
  catch (error) {
    res.status(401).json({ error: { message: (error as Error).message, type: "auth_error" } });
    return;
  }

  let body: Buffer;
  try { body = await readBoundedBody(req); }
  catch (error) {
    if (error instanceof PayloadTooLargeError) {
      res.status(413).json({ error: { message: error.message, type: "payload_too_large" } });
      return;
    }
    throw error;
  }

  const decision = decideProxyRoute({
    method: req.method,
    relPath,
    contentType: req.headers["content-type"],
    body,
  });
  let forwardBody = body;
  if (decision.kind !== "opaque-relay") {
    const prepared = prepareGrokRequestObject(relPath, decision.json);
    forwardBody = Buffer.from(JSON.stringify(prepared.value), "utf8");
  }

  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const controller = new AbortController();
  req.once("aborted", () => controller.abort(new Error("downstream request aborted")));

  try {
    const upstream = await deps.fetchUpstream({
      method: req.method,
      pathWithQuery: `/v1${relPath}${query}`,
      headers: new Headers(filterRequestHeaders(req.headers)),
      body: forwardBody.length > 0 ? new Uint8Array(forwardBody) : undefined,
      signal: controller.signal,
    }, { bearer });
    if (decision.kind === "native-chat" || decision.kind === "native-responses") {
      const model = typeof decision.json.model === "string" ? decision.json.model : "unknown";
      const handled = await serveNativeStream({
        protocol: decision.kind === "native-chat" ? "chat" : "responses",
        upstream,
        downstream: res,
        model,
      });
      if (handled === "handled") return;
    }
    await relayUpstreamResponse(upstream, res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(502).json({
        error: { message: `Upstream error: ${(error as Error).message}`, type: "upstream_error" },
      });
    } else {
      log.dim(`[progrok] stream interrupted after response commit: ${(error as Error).message}`);
      res.end();
    }
  }
}
```

`startProxy`의 시그니처와 로그 문구는 현재 `src/proxy/server.ts:141-174`를 그대로 둔다. 따라서 `src/commands/proxy.ts:29`와 `src/chat/server.ts:15`는 변경하지 않는다.

## 11. MODIFY — 테스트

### `tests/proxy.test.ts`

현재 `tests/proxy.test.ts:53-68`은 인자 없이 app을 만들고 unknown path를 실제 xAI로 보낸다.

```ts
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
```

변경 후에는 매 테스트가 deterministic fake upstream을 주입한다.

```ts
import type { XaiFetchInput } from "../src/transport/fetch.js";

const calls: Array<{ input: XaiFetchInput; bearer: string }> = [];
const app = createProxyApp({
  getBearer: async () => "test-bearer",
  fetchUpstream: async (input, { bearer }) => {
    calls.push({ input, bearer });
    return new globalThis.Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
```

현재 health assertion `tests/proxy.test.ts:81-92`는 한 글자도 바꾸지 않는다. unknown path 테스트는 response non-empty만 보지 말고 captured call의 method, `/v1/unknown-path`, query, body를 검증한다. 추가 케이스:

- GET, POST, PUT, PATCH, DELETE 각각 unknown `/v1/*`가 upstream에 도달한다.
- body가 정확히 100MB이면 전달되고 100MB+1이면 아래 exact JSON이다.

```json
{"error":{"message":"Request body exceeds 100MB limit","type":"payload_too_large"}}
```

- `getBearer` rejection은 status 401과 현재 exact shape `auth_error`다.
- upstream fetch rejection은 status 502와 현재 exact shape `upstream_error`다.
- incoming `Authorization`, `Host`, `Content-Length`는 upstream에 전달되지 않고 `test-bearer`는 `executeXaiFetch`의 두 번째 인자로만 간다.
- upstream `content-encoding`, `content-length`, hop-by-hop header는 downstream에 복사되지 않는다.

### `tests/composer-inject.test.ts`

현재 import `tests/composer-inject.test.ts:3`:

```ts
import { prepareGrokRequest } from "../src/proxy/composer-inject.js";
```

변경 후:

```ts
import {
  prepareGrokRequest,
  prepareGrokRequestObject,
} from "../src/proxy/composer-inject.js";
```

기존 18개 테스트는 삭제하지 않는다. 동일 fixture에 대해 object API 결과를 JSON 직렬화한 값과 Buffer wrapper 결과가 같다는 테스트, changed=false일 때 입력 object identity가 유지된다는 테스트를 추가한다.

### NEW `tests/proxy-native-stream.test.ts`

fake upstream으로 다음을 검증한다.

- Chat SSE text/tool/finish 입력이 유효한 Chat SSE로 재직렬화되고 `[DONE]`이 정확히 한 번이다.
- Responses output item/text/tool/completed가 대응하는 Responses event sequence로 재직렬화된다.
- Chat/Responses `stream !== true`는 body가 parser를 통과하지 않고 relay된다.
- JSON이 아닌 `/chat/completions`, multipart `/stt`, binary `/tts`, unknown path는 byte-identical relay다.
- parser가 첫 event에서 실패하면 HTTP 502 `upstream_error` JSON이다.
- text를 이미 쓴 뒤 malformed frame이면 status를 바꾸거나 재시도하지 않고 protocol error event 후 연결을 닫는다.
- downstream abort는 upstream AbortSignal을 abort한다.
- `res.write()` backpressure 상황에서 drain 전 다음 chunk를 읽지 않는다.

## 12. 공개 계약과 마이그레이션

### `~/.progrok/auth.json`

스키마와 경로를 변경하지 않는다. 현재 `src/auth/token-store.ts:15-22`의 필드 `accessToken`, `refreshToken`, `expiresAt`, `tokenEndpoint`, `email`, `idToken`을 그대로 읽는다. wp5에서 `accountId` 같은 optional 필드가 추가되더라도 unknown key를 보존하는 additive migration만 허용한다. 이 단계에는 파일 rewrite나 one-time migration이 없다.

### CLI

`progrok proxy --port --host`, 기본 port 18645, host `127.0.0.1`, `startProxy(port, host): Promise<void>`를 유지한다. `src/commands/proxy.ts`를 수정하지 않는다. 현재 도움말의 “ALL /v1/*”, SSE, multipart, binary 지원 문구는 route matrix와 일치해야 한다.

### `/health`

status 200과 아래 JSON을 exact deep equality로 유지한다.

```json
{"status":"ok","upstream":"xAI Grok","proxy":"progrok"}
```

새 readiness 필드나 버전 필드를 넣지 않는다. 그것은 기존 consumer의 exact match를 깨뜨릴 수 있다.

### `/v1/*`

path allowlist를 도입하지 않는다. 모든 메서드와 query string을 전달한다. native parser는 두 exact POST stream 경로의 성공 `text/event-stream` 응답에만 적용된다. 나머지는 relay다.

### 오류

- 인증 실패: 기존 401 `{"error":{"message":...,"type":"auth_error"}}`.
- body 상한: 기존 413 `payload_too_large`, message `Request body exceeds 100MB limit`.
- upstream 연결 또는 native parser preflight 실패: 기존 502 `upstream_error` prefix `Upstream error: `.
- upstream이 반환한 4xx/5xx response는 proxy 502로 감싸지 않고 status/header/body를 그대로 relay한다.
- 이미 stream을 commit한 뒤의 실패는 HTTP status를 바꿀 수 없으므로 protocol-native error terminal을 쓴다. 재시도하지 않는다.

클라이언트 설정 변경은 필요 없다. 이 단계는 무중단 additive replacement다.

## 13. 구현 순서

1. route policy와 bounded body reader를 테스트와 함께 추가한다.
2. relay 모듈로 기존 header/body forwarding을 옮기고 기존 proxy tests를 fake upstream 기반으로 바꾼다.
3. composer object API를 추가하고 기존 Buffer API 동치 테스트를 통과시킨다.
4. Chat/Responses renderer를 fixture 기반으로 완성한다.
5. native-stream preflight와 server orchestration을 연결한다.
6. focused tests, typecheck, full tests를 실행한다.
7. 로컬 fake upstream으로 실제 HTTP chunk/backpressure/abort smoke를 수행한다.

## 14. 검증 명령

```bash
cd /Users/jun/Developer/progrok
node --import tsx --test tests/composer-inject.test.ts
node --import tsx --test tests/proxy.test.ts
node --import tsx --test tests/proxy-native-stream.test.ts
npm run typecheck
npm test
npm run build
```

100MB 경계 검증은 큰 fixture를 repository에 추가하지 말고 test에서 chunk를 반복 생성한다. 테스트가 실제 네트워크 `api.x.ai`에 접근하면 실패로 본다.

로컬 smoke는 임시 upstream을 사용한다.

```bash
node --import tsx tests/fixtures/run-proxy-smoke.ts
```

fixture script를 새 tracked 파일로 추가하지 않는다. 테스트 내부 helper 또는 `.tmp/` 일회성 script로 실행하고, 자동화 가능한 검증은 `tests/proxy-native-stream.test.ts`에 남긴다.

## 15. 완료 조건

- manifest의 6개 NEW source, 1개 NEW test, 4개 MODIFY만 변경된다.
- `/health` exact payload, `/v1/*` 전 메서드/query forwarding, 100MB 경계, 401/413/502 shape가 회귀 테스트로 고정된다.
- `POST /v1/chat/completions`와 `POST /v1/responses`의 `stream: true` 성공 SSE만 native parse/render를 탄다.
- multipart, binary, non-stream JSON, unknown path는 손실 없는 relay다.
- request abort와 response backpressure가 upstream read/fetch에 전파된다.
- response header 이후 네트워크/parser 실패를 재시도하지 않는다.
- `~/.progrok/auth.json`, CLI option, default port/host에 마이그레이션이 필요하지 않으며 실제로 수정되지 않는다.
- focused tests, `npm run typecheck`, `npm test`, `npm run build`가 모두 exit 0이다.
