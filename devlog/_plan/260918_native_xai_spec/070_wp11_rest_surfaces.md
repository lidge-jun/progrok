# wp11 — 나머지 REST 표면과 Responses WebSocket을 타입드 클라이언트로 고정한다

## 결론

wp11은 `src/surfaces/`를 xAI 비-Voice API의 단일 소유자로 만든다. 각 파일은 경로와 wire 타입만 소유하고, 인증·base URL·401 refresh·재시도·오류 본문 제한은 wp5/wp6의 전송 계층에 맡긴다. Responses WebSocket은 HTTP 프록시에 억지로 넣지 않고 직접 연결하는 타입드 세션으로 제공한다. `~/.progrok/auth.json`, 기존 CLI, `/health`, D2 제한(`/deployment/config`, `/feedback*`)을 제외한 HTTP `/v1/*` 패스스루는 바꾸지 않는다.

이 문서의 독자는 wp11 구현자다. 구현자는 아래 파일 순서대로 작업하고, 각 NEW 블록의 공개 시그니처와 핵심 흐름을 그대로 구현한 뒤 명시된 테스트를 통과시킨다.

## 근거와 판정

- 로컬 SSOT: `001_endpoint_inventory.md:35-141`, 특히 Responses WS(`:54-63`), 모델·미디어·저장(`:105-135`), 오류(`:137-141`).
- 2026-09-18 라이브 판정: `001_endpoint_inventory.md:143-166`. OAuth 레인의 base URL은 `https://api.x.ai/v1`이며 Voice와 일반 추론 모두 이 호스트를 쓴다.
- Responses WS 공식 가이드: <https://docs.x.ai/developers/advanced-api-usage/websocket-mode> (2026-09-02 갱신). `response.create`, 직렬 처리, `previous_response_id`, 25분 상한, `generate:false`, 전용 오류를 확인했다.
- OpenAPI: <https://api.x.ai/api-docs/openapi.json> (2026-09-18 조회). OpenAPI에만 나타나는 표면은 아래 레지스트리에서 `evidence: "openapi-only"`로 표시한다.
- 참고 구현:
  - `/Users/jun/Developer/ima2-gen/lib/grokRuntime.ts:20-35,55-92` — base URL·credential·401 재실행 분리.
  - `/Users/jun/Developer/ima2-gen/lib/grokUpstreamRetry.ts:115-163` — 재실행 가능한 요청만 제한적으로 재시도.
  - `/Users/jun/Developer/opencodex/src/images/xai-client.ts:85-173` — 호출자 abort와 timeout 합성, redirect 차단, bounded body read.
  - `/Users/jun/Developer/opencodex/src/images/xai-video-client.ts:65-165` — submit/poll 분리와 terminal 상태 정규화.

### OpenAPI 전용 표면

다음 경로는 `001_endpoint_inventory.md`가 OpenAPI 전용으로 분류했거나 인벤토리 본문에 없고 2026-09-18 OpenAPI에서만 확인됐다. “지원 안 함”이 아니라 근거의 종류를 뜻한다.

| 표면 | 경로 |
|---|---|
| Responses input items | `GET /v1/responses/{response_id}/input_items` |
| Embeddings | `POST /v1/embeddings`, `GET /v1/embedding-models[/{model_id}]` |
| Skills | `GET/POST /v1/skills`, `GET/DELETE /v1/skills/{skill_id}`, `GET /v1/skills/{skill_id}/content` |
| Account | `GET /v1/me` |
| Files 확장 | `GET /v1/files/{file_id}/content`, `POST /v1/files/{file_id}/public-url`, `POST /v1/files/{file_id}/public-url/revoke` |

Batches는 공식 REST 레퍼런스에 있지만 현재 OpenAPI JSON의 `paths`에는 없다. 레지스트리에는 `evidence: "official-guide"`로 둔다. 이 차이는 테스트가 임의로 한쪽을 삭제하지 못하게 명시적으로 보존한다.

## 구조 결정

### 현재와 목표

```text
현재
commands/* ── getValidBearer() ── fetch(api.x.ai) ── ad-hoc cast
proxy/*    ── getValidBearer() ── fetch(api.x.ai) ── byte relay

목표
commands/* ── surfaces/* ── transport/fetch.ts ── auth/token-store.ts
proxy/*    ───────────────── transport/fetch.ts ── auth/token-store.ts
responses-ws.ts ── ws + auth bearer ── wire/responses-stream.ts
```

선택한 이동은 “표면별 타입드 클라이언트”다. 하나의 거대한 `xai-client.ts`는 서로 다른 multipart/binary/async/WS 수명주기를 섞으므로 거절한다. OpenAPI 전체 코드를 생성하는 방식도 현재 패키지 규모에 비해 생성물과 드리프트 비용이 크므로 거절한다. 결과적으로 의존 방향은 `commands/proxy → surfaces → transport → auth`이며 `surfaces`는 CLI나 Express를 import하지 않는다.

wp6 완료 시 `src/transport/fetch.ts`는 다음 최소 계약을 제공해야 한다. 이름이 다르게 구현됐다면 wp11 코딩 전에 wp6 문서를 먼저 이 계약으로 정정한다.

```ts
export interface XaiTransport {
  request(
    path: string,
    init?: RequestInit,
    policy?: { replayable?: boolean },
  ): Promise<Response>;
}

export function createXaiTransport(options?: {
  signal?: AbortSignal;
  timeoutMs?: number;
}): XaiTransport;
```

`request()`는 `/v1` 상대 경로만 받고, bearer·base URL·manual redirect·401 한 번 refresh를 소유한다. 표면 클라이언트는 bearer를 직접 읽거나 retry loop를 만들지 않는다.

wp11 구현 전 precondition은 다음과 같다.

- wp7이 소유한 `src/core/types.ts`, `src/core/events.ts`, `src/wire/responses-stream.ts`가 존재해야 한다. wp11은 이 파일들을 생성하거나 수정하지 않고 `ResponsesRequest`, `AdapterEvent`, `reduceResponsesStream`을 import한다.
- wp10이 `package.json`과 `package-lock.json`에 `ws`/`@types/ws`를 추가한 상태여야 한다. wp11은 manifest나 lockfile을 수정하거나 설치 명령을 다시 실행하지 않는다.

## 변경 매니페스트

| 상태 | 정확한 경로 | 책임 |
|---|---|---|
| NO CHANGE — precondition (wp10 소유) | `package.json` | `ws`와 `@types/ws`가 이미 선언돼 있어야 함 |
| NO CHANGE — precondition (wp10 소유) | `package-lock.json` | wp10이 생성한 exact dependency graph를 재사용 |
| NEW | `src/surfaces/client.ts` | JSON/multipart/binary 공통 경계와 bounded 오류 파싱 |
| NEW | `src/surfaces/index.ts` | wp11 surface 모듈의 단일 public boundary export |
| NEW | `src/surfaces/registry.ts` | 엔드포인트·근거·전송 종류 SSOT |
| NEW | `src/surfaces/responses-ws.ts` | Responses WS 세션, 직렬 turn, 25분 종료 분류 |
| NEW | `src/surfaces/batches.ts` | batch create/list/get/requests/results/cancel |
| NEW | `src/surfaces/files.ts` | upload/list/get/delete/content/public URL |
| NEW | `src/surfaces/collections.ts` | `POST /v1/documents/search`만 소유 |
| NEW | `src/surfaces/embeddings.ts` | embeddings와 embedding-models |
| NEW | `src/surfaces/skills.ts` | OpenAPI-only skill CRUD/content |
| NEW | `src/surfaces/models.ts` | 모델 카탈로그 4종 + embedding 모델 조회 |
| NEW | `src/surfaces/misc.ts` | tokenize-text와 `/v1/me` |
| NEW | `src/surfaces/images.ts` | image generate/edit 타입드 래퍼 |
| NEW | `src/surfaces/videos.ts` | video submit/edit/extend/poll 타입드 래퍼 |
| NEW | `tests/rest-surfaces.test.ts` | 경로·메서드·wire parse·OpenAPI 표식 검증 |
| NEW | `tests/responses-ws.test.ts` | turn 직렬화·이벤트·오류·종료 검증 |
| NEW | `tests/media-surfaces.test.ts` | image/video 요청 형태와 terminal 상태 검증 |

DELETE는 없다. `src/commands/image.ts`, `src/commands/video.ts`, `src/commands/models.ts`, `src/commands/capabilities.ts`의 전환은 wp12가 소유한다. wp11에서 먼저 건드리면 두 단계의 diff 소유권이 겹친다.

## NO CHANGE — 의존성 precondition (wp10 소유)

wp10 완료 결과로 `package.json`에 `ws: ^8.18.3`, `@types/ws: ^8.18.1`이 있고 `package-lock.json`이 동기화돼 있어야 한다. wp11은 두 파일을 수정하지 않으며 `npm install ws`도 실행하지 않는다. 항목이 없거나 lock이 맞지 않으면 wp11 변경으로 보충하지 말고 wp10 precondition 실패로 중단한다.

## NEW — 공통 경계

### `src/surfaces/client.ts`

wire 입력은 항상 `unknown`으로 시작한다. 얇은 클라이언트의 타입은 성공 응답을 설명하지만, JSON cast만으로 신뢰 경계를 통과시키지 않는다.

```ts
import type { XaiTransport } from "../transport/fetch.js";

export type JsonObject = Record<string, unknown>;
export type Decoder<T> = (wire: unknown) => T;

export class XaiSurfaceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "XaiSurfaceError";
  }
}

export function expectObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

export function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

async function readError(response: Response): Promise<XaiSurfaceError> {
  const text = (await response.text()).slice(0, 4096);
  let code: string | undefined;
  let message = text || `xAI returned HTTP ${response.status}`;
  try {
    const root = expectObject(JSON.parse(text), "error response");
    const error = expectObject(root.error, "error response.error");
    if (typeof error.code === "string") code = error.code;
    if (typeof error.message === "string") message = error.message;
  } catch {
    // Bounded raw text above remains the safe fallback.
  }
  return new XaiSurfaceError(response.status, code, message);
}

export async function requestJson<T>(
  transport: XaiTransport,
  path: string,
  init: RequestInit,
  decode: Decoder<T>,
  policy?: { replayable?: boolean },
): Promise<T> {
  const response = await transport.request(path, init, policy);
  if (!response.ok) throw await readError(response);
  const wire: unknown = await response.json();
  return decode(wire);
}

export async function requestBytes(
  transport: XaiTransport,
  path: string,
  init: RequestInit = {},
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const response = await transport.request(path, init);
  if (!response.ok) throw await readError(response);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
  };
}

export async function requestVoid(
  transport: XaiTransport,
  path: string,
  init: RequestInit,
): Promise<void> {
  const response = await transport.request(path, init);
  if (!response.ok) throw await readError(response);
  await response.body?.cancel();
}

export function jsonBody(value: unknown): Pick<RequestInit, "headers" | "body"> {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}
```

### `src/surfaces/registry.ts`

```ts
export type SurfaceEvidence =
  | "inventory"
  | "official-guide"
  | "openapi-only";

export interface SurfaceDescriptor {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "WS" | "*";
  path: string;
  family: string;
  transport: "json" | "multipart" | "binary" | "async" | "websocket" | "passthrough";
  evidence: SurfaceEvidence;
}

export const SURFACE_REGISTRY = [
  { method: "POST", path: "/v1/chat/completions", family: "chat", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/chat/deferred-completion/{request_id}", family: "chat", transport: "async", evidence: "inventory" },
  { method: "POST", path: "/v1/responses", family: "responses", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/responses/compact", family: "responses", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/responses/{response_id}", family: "responses", transport: "json", evidence: "inventory" },
  { method: "DELETE", path: "/v1/responses/{response_id}", family: "responses", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/responses/{response_id}/input_items", family: "responses", transport: "json", evidence: "openapi-only" },
  { method: "WS", path: "wss://api.x.ai/v1/responses", family: "responses", transport: "websocket", evidence: "official-guide" },
  { method: "POST", path: "/v1/completions", family: "legacy", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/messages", family: "legacy", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/complete", family: "legacy", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/tts", family: "voice", transport: "binary", evidence: "inventory" },
  { method: "GET", path: "/v1/tts/voices", family: "voice", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/tts/voices/{voice_id}", family: "voice", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/stt", family: "voice", transport: "multipart", evidence: "inventory" },
  { method: "POST", path: "/v1/realtime/client_secrets", family: "voice", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/custom-voices", family: "voice", transport: "multipart", evidence: "inventory" },
  { method: "GET", path: "/v1/custom-voices", family: "voice", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/custom-voices/{voice_id}", family: "voice", transport: "json", evidence: "inventory" },
  { method: "PATCH", path: "/v1/custom-voices/{voice_id}", family: "voice", transport: "json", evidence: "inventory" },
  { method: "DELETE", path: "/v1/custom-voices/{voice_id}", family: "voice", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/custom-voices/{voice_id}/audio", family: "voice", transport: "binary", evidence: "inventory" },
  { method: "POST", path: "/v2/phone-numbers", family: "voice", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/realtime/calls/{call_id}/refer", family: "voice", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/realtime/calls/{call_id}/hangup", family: "voice", transport: "json", evidence: "inventory" },
  { method: "WS", path: "wss://api.x.ai/v1/realtime", family: "voice", transport: "websocket", evidence: "inventory" },
  { method: "WS", path: "wss://api.x.ai/v1/tts", family: "voice", transport: "websocket", evidence: "inventory" },
  { method: "WS", path: "wss://api.x.ai/v1/stt", family: "voice", transport: "websocket", evidence: "inventory" },
  { method: "POST", path: "/v1/batches", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "GET", path: "/v1/batches", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "GET", path: "/v1/batches/{batch_id}", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "GET", path: "/v1/batches/{batch_id}/requests", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "POST", path: "/v1/batches/{batch_id}/requests", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "GET", path: "/v1/batches/{batch_id}/results", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "POST", path: "/v1/batches/{batch_id}:cancel", family: "batches", transport: "json", evidence: "official-guide" },
  { method: "POST", path: "/v1/files", family: "files", transport: "multipart", evidence: "inventory" },
  { method: "GET", path: "/v1/files", family: "files", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/files/{file_id}", family: "files", transport: "json", evidence: "inventory" },
  { method: "DELETE", path: "/v1/files/{file_id}", family: "files", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/files/{file_id}/content", family: "files", transport: "binary", evidence: "openapi-only" },
  { method: "POST", path: "/v1/files/{file_id}/public-url", family: "files", transport: "json", evidence: "openapi-only" },
  { method: "POST", path: "/v1/files/{file_id}/public-url/revoke", family: "files", transport: "json", evidence: "openapi-only" },
  { method: "POST", path: "/v1/documents/search", family: "collections", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/embeddings", family: "embeddings", transport: "json", evidence: "openapi-only" },
  { method: "GET", path: "/v1/embedding-models", family: "embeddings", transport: "json", evidence: "openapi-only" },
  { method: "GET", path: "/v1/embedding-models/{model_id}", family: "embeddings", transport: "json", evidence: "openapi-only" },
  { method: "GET", path: "/v1/skills", family: "skills", transport: "json", evidence: "openapi-only" },
  { method: "POST", path: "/v1/skills", family: "skills", transport: "multipart", evidence: "openapi-only" },
  { method: "GET", path: "/v1/skills/{skill_id}", family: "skills", transport: "json", evidence: "openapi-only" },
  { method: "DELETE", path: "/v1/skills/{skill_id}", family: "skills", transport: "json", evidence: "openapi-only" },
  { method: "GET", path: "/v1/skills/{skill_id}/content", family: "skills", transport: "binary", evidence: "openapi-only" },
  { method: "GET", path: "/v1/models", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/models/{model_id}", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/language-models", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/language-models/{model_id}", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/image-generation-models", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/image-generation-models/{model_id}", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/video-generation-models", family: "models", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/video-generation-models/{model_id}", family: "models", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/tokenize-text", family: "misc", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/api-key", family: "misc", transport: "json", evidence: "inventory" },
  { method: "GET", path: "/v1/me", family: "misc", transport: "json", evidence: "openapi-only" },
  { method: "POST", path: "/v1/images/generations", family: "images", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/images/edits", family: "images", transport: "json", evidence: "inventory" },
  { method: "POST", path: "/v1/videos/generations", family: "videos", transport: "async", evidence: "inventory" },
  { method: "POST", path: "/v1/videos/edits", family: "videos", transport: "async", evidence: "inventory" },
  { method: "POST", path: "/v1/videos/extensions", family: "videos", transport: "async", evidence: "inventory" },
  { method: "GET", path: "/v1/videos/{request_id}", family: "videos", transport: "async", evidence: "inventory" },
  { method: "*", path: "/v1/*", family: "proxy", transport: "passthrough", evidence: "inventory" },
] as const satisfies readonly SurfaceDescriptor[];
```

마지막 `/v1/*` 항목은 wp6 D2 제한을 통과한 일반 fallback만 뜻한다. `/deployment/config`와 `/feedback*`를 다시 자동 등록하는 wildcard가 아니다.

## NEW — Responses WebSocket

### `src/surfaces/responses-ws.ts`

HTTP Responses DTO는 wp7의 canonical 타입을 재사용한다. WS 입력은 HTTP create body에 `type`과 선택적 `generate`를 더하고 `stream`/`background`를 금지한다.

```ts
import WebSocket from "ws";
import { getValidBearer } from "../auth/token-store.js";
import type { AdapterEvent } from "../core/events.js";
import type { ResponsesRequest } from "../core/types.js";
import { reduceResponsesStream } from "../wire/responses-stream.js";

export type ResponsesWsCreate = Omit<ResponsesRequest, "stream" | "background"> & {
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

function createTurnReducer(emit: (event: AdapterEvent) => void) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let suppressTruncated = false;
  const source = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const done = (async () => {
    for await (const event of reduceResponsesStream(source)) {
      if (!suppressTruncated) emit(event);
    }
  })();
  return {
    push(wire: unknown) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(wire)}\n\n`));
    },
    close() { controller.close(); },
    finishProtocolError() { suppressTruncated = true; controller.close(); },
    done,
  };
}

export async function connectResponsesWebSocket(
  deps: ResponsesWsDeps = defaultDeps,
): Promise<ResponsesWsSession> {
  const bearer = await deps.getBearer();
  const socket = deps.createSocket("wss://api.x.ai/v1/responses", {
    Authorization: `Bearer ${bearer}`,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  const queue: Array<AdapterEvent | ResponsesWsError> = [];
  const waiters: Array<(value: IteratorResult<AdapterEvent | ResponsesWsError>) => void> = [];
  let ended = false;
  let sendTail = Promise.resolve();
  let activeTurn: ReturnType<typeof createTurnReducer> | undefined;

  const push = (value: AdapterEvent | ResponsesWsError) => {
    const waiter = waiters.shift();
    if (waiter) waiter({ value, done: false });
    else queue.push(value);
  };

  socket.on("message", (data) => {
    const wire: unknown = JSON.parse(data.toString());
    const object = wire as { type?: unknown };
    if (object.type === "error") {
      push(wire as ResponsesWsError);
      activeTurn?.finishProtocolError();
      return;
    }
    if (!activeTurn) throw new Error("Responses event arrived without an active turn");
    activeTurn.push(wire);
  });
  socket.once("close", () => {
    activeTurn?.close();
    ended = true;
    for (const waiter of waiters.splice(0)) waiter({ value: undefined, done: true });
  });

  return {
    async send(request) {
      sendTail = sendTail.then(async () => {
        if (activeTurn) await activeTurn.done;
        activeTurn = createTurnReducer(push);
        await new Promise<void>((resolve, reject) => {
          socket.send(JSON.stringify(request), (error) => error ? reject(error) : resolve());
        });
      });
      await sendTail;
    },
    async *events() {
      while (!ended || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        const next = await new Promise<IteratorResult<AdapterEvent | ResponsesWsError>>(
          (resolve) => waiters.push(resolve),
        );
        if (next.done) return;
        yield next.value;
      }
    },
    async close(code = 1000, reason = "client close") {
      if (socket.readyState === WebSocket.CLOSED) return;
      socket.close(code, reason);
      await new Promise<void>((resolve) => socket.once("close", () => resolve()));
    },
  };
}
```

구현 시 추가할 규칙:

1. WS JSON은 turn마다 만든 synthetic SSE byte stream(`data: <json>\n\n`)에 넣고 wp7의 실제 공개 API `reduceResponsesStream(source)`를 정확히 한 번 실행한다. 별도 단일-event decoder를 만들지 않는다.
2. 두 번째 `response.create`는 첫 turn의 `response.completed|response.failed|response.incomplete` terminal event 전까지 `activeTurn.done`에서 대기한다. reducer state를 turn 사이에 재사용하지 않는다.
3. `previous_response_not_found`는 자동으로 full context를 재구성하지 않는다. 호출자가 `previous_response_id`를 제거하고 전체 input으로 재시작하게 typed error를 반환한다.
4. `websocket_connection_limit_reached`는 25분 정상 수명 만료로 분류한다. `store=true`면 호출자가 새 연결에서 이어갈 수 있지만 클라이언트가 임의 재전송하지 않는다.
5. `generate:false` warmup도 response ID를 terminal 결과로 노출한다.
6. 한 연결에서 multiplex하지 않는다. 병렬 turn은 별도 세션을 열어야 한다.

## NEW — JSON·multipart 표면

### `src/surfaces/batches.ts`

```ts
import type { XaiTransport } from "../transport/fetch.js";
import { expectObject, expectString, jsonBody, requestJson, requestVoid } from "./client.js";

export interface BatchInfo {
  batch_id: string;
  name: string;
  state: Record<string, unknown>;
  raw: Record<string, unknown>;
}
export interface PageOptions { limit?: number; paginationToken?: string; }
export interface BatchRequest { batch_request_id: string; batch_request: Record<string, unknown>; }

function decodeBatch(wire: unknown): BatchInfo {
  const raw = expectObject(wire, "batch");
  return {
    batch_id: expectString(raw.batch_id, "batch.batch_id"),
    name: expectString(raw.name, "batch.name"),
    state: expectObject(raw.state, "batch.state"),
    raw,
  };
}

export class BatchesClient {
  constructor(private readonly transport: XaiTransport) {}

  create(name: string): Promise<BatchInfo> {
    return requestJson(this.transport, "/batches", { method: "POST", ...jsonBody({ name }) }, decodeBatch);
  }
  get(batchId: string): Promise<BatchInfo> {
    return requestJson(this.transport, `/batches/${encodeURIComponent(batchId)}`, {}, decodeBatch);
  }
  list(options: PageOptions = {}): Promise<unknown> {
    return requestJson(this.transport, withPage("/batches", options), {}, (wire) => expectObject(wire, "batches"));
  }
  listRequests(batchId: string, options: PageOptions = {}): Promise<unknown> {
    return requestJson(this.transport, withPage(`/batches/${encodeURIComponent(batchId)}/requests`, options), {}, (wire) => expectObject(wire, "batch requests"));
  }
  addRequests(batchId: string, requests: readonly BatchRequest[]): Promise<void> {
    return requestVoid(this.transport, `/batches/${encodeURIComponent(batchId)}/requests`, { method: "POST", ...jsonBody({ batch_requests: requests }) });
  }
  results(batchId: string, options: PageOptions = {}): Promise<unknown> {
    return requestJson(this.transport, withPage(`/batches/${encodeURIComponent(batchId)}/results`, options), {}, (wire) => expectObject(wire, "batch results"));
  }
  cancel(batchId: string): Promise<BatchInfo> {
    return requestJson(this.transport, `/batches/${encodeURIComponent(batchId)}:cancel`, { method: "POST" }, decodeBatch);
  }
}

function withPage(path: string, options: PageOptions): string {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.paginationToken) query.set("pagination_token", options.paginationToken);
  const encoded = query.toString();
  return encoded.length === 0 ? path : `${path}?${encoded}`;
}
```

### `src/surfaces/files.ts`

```ts
import type { XaiTransport } from "../transport/fetch.js";
import { expectObject, expectString, jsonBody, requestBytes, requestJson } from "./client.js";

export interface XaiFile {
  id: string;
  filename: string;
  bytes: number;
  created_at: number;
  expires_at?: number | null;
  public_url?: string | null;
  raw: Record<string, unknown>;
}
export interface UploadFileInput {
  file: Blob;
  filename: string;
  purpose?: string;
  expiresAfterSeconds?: number;
}

function decodeFile(wire: unknown): XaiFile {
  const raw = expectObject(wire, "file");
  if (typeof raw.bytes !== "number" || typeof raw.created_at !== "number") throw new Error("invalid file metadata");
  return {
    id: expectString(raw.id, "file.id"),
    filename: expectString(raw.filename, "file.filename"),
    bytes: raw.bytes,
    created_at: raw.created_at,
    expires_at: typeof raw.expires_at === "number" || raw.expires_at === null ? raw.expires_at : undefined,
    public_url: typeof raw.public_url === "string" || raw.public_url === null ? raw.public_url : undefined,
    raw,
  };
}

export class FilesClient {
  constructor(private readonly transport: XaiTransport) {}

  upload(input: UploadFileInput): Promise<XaiFile> {
    const form = new FormData();
    if (input.purpose) form.append("purpose", input.purpose);
    if (input.expiresAfterSeconds !== undefined) form.append("expires_after", String(input.expiresAfterSeconds));
    form.append("file", input.file, input.filename); // file은 마지막 필드
    return requestJson(this.transport, "/files", { method: "POST", body: form }, decodeFile);
  }
  list(options: { limit?: number; paginationToken?: string } = {}): Promise<unknown> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.paginationToken) query.set("pagination_token", options.paginationToken);
    const encoded = query.toString();
    return requestJson(this.transport, encoded ? `/files?${encoded}` : "/files", {}, (wire) => expectObject(wire, "files"));
  }
  get(fileId: string): Promise<XaiFile> {
    return requestJson(this.transport, `/files/${encodeURIComponent(fileId)}`, {}, decodeFile);
  }
  delete(fileId: string): Promise<{ id: string; deleted: boolean }> {
    return requestJson(this.transport, `/files/${encodeURIComponent(fileId)}`, { method: "DELETE" }, (wire) => {
      const raw = expectObject(wire, "deleted file");
      return { id: expectString(raw.id, "deleted file.id"), deleted: raw.deleted === true };
    });
  }
  download(fileId: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    return requestBytes(this.transport, `/files/${encodeURIComponent(fileId)}/content`);
  }
  createPublicUrl(fileId: string, expiresAfter?: number): Promise<{ public_url: string; expires_at?: number | null }> {
    return requestJson(this.transport, `/files/${encodeURIComponent(fileId)}/public-url`, { method: "POST", ...jsonBody({ expires_after: expiresAfter }) }, (wire) => {
      const raw = expectObject(wire, "public URL");
      return { public_url: expectString(raw.public_url, "public URL.public_url"), expires_at: typeof raw.expires_at === "number" || raw.expires_at === null ? raw.expires_at : undefined };
    });
  }
  revokePublicUrl(fileId: string): Promise<{ id: string; revoked: boolean }> {
    return requestJson(this.transport, `/files/${encodeURIComponent(fileId)}/public-url/revoke`, { method: "POST" }, (wire) => {
      const raw = expectObject(wire, "revoke public URL");
      return { id: expectString(raw.id, "revoke.id"), revoked: raw.revoked === true };
    });
  }
}
```

### `src/surfaces/collections.ts`

```ts
import type { XaiTransport } from "../transport/fetch.js";
import { expectObject, jsonBody, requestJson } from "./client.js";

export interface DocumentsSearchRequest {
  query: string;
  source: Record<string, unknown>;
  limit?: number;
  filter?: string;
  instructions?: string;
  retrieval_mode?: unknown;
  group_by?: unknown;
}

export class CollectionsSearchClient {
  constructor(private readonly transport: XaiTransport) {}
  search(request: DocumentsSearchRequest): Promise<{ matches: unknown[] }> {
    return requestJson(this.transport, "/documents/search", { method: "POST", ...jsonBody(request) }, (wire) => {
      const raw = expectObject(wire, "documents search");
      if (!Array.isArray(raw.matches)) throw new Error("documents search.matches must be an array");
      return { matches: raw.matches };
    });
  }
}
```

이 클라이언트에 collection 생성·수정·문서 추가를 넣지 않는다. 그것은 `management-api.x.ai`와 Management API key를 요구하는 별도 제품 경계다.

### `src/surfaces/embeddings.ts`

```ts
import type { XaiTransport } from "../transport/fetch.js";
import { expectObject, expectString, jsonBody, requestJson } from "./client.js";

export interface EmbeddingRequest {
  model: string;
  input: string | string[] | number[] | number[][];
  dimensions?: number;
  encoding_format?: "float" | "base64";
  user?: string;
}
export interface EmbeddingResponse {
  object: string;
  model: string;
  data: unknown[];
  usage?: unknown;
}

export class EmbeddingsClient {
  constructor(private readonly transport: XaiTransport) {}
  create(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return requestJson(this.transport, "/embeddings", { method: "POST", ...jsonBody(request) }, (wire) => {
      const raw = expectObject(wire, "embeddings");
      if (!Array.isArray(raw.data)) throw new Error("embeddings.data must be an array");
      return { object: expectString(raw.object, "embeddings.object"), model: expectString(raw.model, "embeddings.model"), data: raw.data, usage: raw.usage };
    });
  }
  listModels(): Promise<unknown> {
    return requestJson(this.transport, "/embedding-models", {}, (wire) => expectObject(wire, "embedding models"));
  }
  getModel(modelId: string): Promise<unknown> {
    return requestJson(this.transport, `/embedding-models/${encodeURIComponent(modelId)}`, {}, (wire) => expectObject(wire, "embedding model"));
  }
}
```

### `src/surfaces/skills.ts`

```ts
import type { XaiTransport } from "../transport/fetch.js";
import { expectObject, expectString, requestBytes, requestJson } from "./client.js";

export interface XaiSkill {
  id: string;
  name: string;
  description: string;
  default_version: string;
  latest_version: string;
  created_at: number;
  raw: Record<string, unknown>;
}
export interface SkillUploadFile { path: string; data: Blob; }

function decodeSkill(wire: unknown): XaiSkill {
  const raw = expectObject(wire, "skill");
  if (typeof raw.created_at !== "number") throw new Error("skill.created_at must be a number");
  return {
    id: expectString(raw.id, "skill.id"),
    name: expectString(raw.name, "skill.name"),
    description: expectString(raw.description, "skill.description"),
    default_version: expectString(raw.default_version, "skill.default_version"),
    latest_version: expectString(raw.latest_version, "skill.latest_version"),
    created_at: raw.created_at,
    raw,
  };
}

export class SkillsClient {
  constructor(private readonly transport: XaiTransport) {}
  list(): Promise<unknown> {
    return requestJson(this.transport, "/skills", {}, (wire) => expectObject(wire, "skills"));
  }
  upload(files: readonly SkillUploadFile[]): Promise<XaiSkill> {
    const form = new FormData();
    for (const file of files) form.append("files", file.data, file.path);
    return requestJson(this.transport, "/skills", { method: "POST", body: form }, decodeSkill);
  }
  get(skillId: string): Promise<XaiSkill> {
    return requestJson(this.transport, `/skills/${encodeURIComponent(skillId)}`, {}, decodeSkill);
  }
  delete(skillId: string): Promise<{ id: string; deleted: boolean }> {
    return requestJson(this.transport, `/skills/${encodeURIComponent(skillId)}`, { method: "DELETE" }, (wire) => {
      const raw = expectObject(wire, "deleted skill");
      return { id: expectString(raw.id, "deleted skill.id"), deleted: raw.deleted === true };
    });
  }
  downloadContent(skillId: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    return requestBytes(this.transport, `/skills/${encodeURIComponent(skillId)}/content`);
  }
}
```

## NEW — 모델·기타 표면

### `src/surfaces/models.ts`

모델 이름은 정적 배열로 소유하지 않는다. 런타임 응답이 권위다.

```ts
import type { XaiTransport } from "../transport/fetch.js";
import { expectObject, expectString, requestJson } from "./client.js";

export type ModelFamily = "models" | "language-models" | "image-generation-models" | "video-generation-models" | "embedding-models";
export interface XaiModel {
  id: string;
  aliases: string[];
  raw: Record<string, unknown>;
}

function decodeModel(wire: unknown): XaiModel {
  const raw = expectObject(wire, "model");
  return { id: expectString(raw.id, "model.id"), aliases: Array.isArray(raw.aliases) ? raw.aliases.filter((v): v is string => typeof v === "string") : [], raw };
}

export class ModelsClient {
  constructor(private readonly transport: XaiTransport) {}
  async list(family: ModelFamily = "models"): Promise<XaiModel[]> {
    const raw = await requestJson(this.transport, `/${family}`, {}, (wire) => expectObject(wire, family));
    const values = family === "models" ? raw.data : raw.models;
    if (!Array.isArray(values)) throw new Error(`${family} list is missing its array`);
    return values.map(decodeModel);
  }
  get(family: ModelFamily, modelId: string): Promise<XaiModel> {
    return requestJson(this.transport, `/${family}/${encodeURIComponent(modelId)}`, {}, decodeModel);
  }
}
```

요청의 “models 4종”은 `models`, `language-models`, `image-generation-models`, `video-generation-models`다. `embedding-models`는 embeddings 표면의 동반 카탈로그지만 같은 구현을 재사용한다.

### `src/surfaces/misc.ts`

```ts
import type { XaiTransport } from "../transport/fetch.js";
import { expectObject, expectString, jsonBody, requestJson } from "./client.js";

export interface MeResponse {
  user_id: string;
  team_id: string;
  zdr_status: string;
  team_blocked: boolean;
  oauth?: unknown;
  api_key?: unknown;
}

export class MiscClient {
  constructor(private readonly transport: XaiTransport) {}
  tokenize(input: { model: string; text: string; user?: string }): Promise<unknown[]> {
    return requestJson(this.transport, "/tokenize-text", { method: "POST", ...jsonBody(input) }, (wire) => {
      const raw = expectObject(wire, "tokenize response");
      if (!Array.isArray(raw.token_ids)) throw new Error("tokenize response.token_ids must be an array");
      return raw.token_ids;
    });
  }
  me(): Promise<MeResponse> {
    return requestJson(this.transport, "/me", {}, (wire) => {
      const raw = expectObject(wire, "me");
      return {
        user_id: expectString(raw.user_id, "me.user_id"),
        team_id: expectString(raw.team_id, "me.team_id"),
        zdr_status: expectString(raw.zdr_status, "me.zdr_status"),
        team_blocked: raw.team_blocked === true,
        oauth: raw.oauth,
        api_key: raw.api_key,
      };
    });
  }
}
```

## NEW — 이미지와 비디오 표면

### `src/surfaces/images.ts`

```ts
import type { XaiTransport } from "../transport/fetch.js";
import { expectObject, jsonBody, requestJson } from "./client.js";

export interface ImageRequest {
  model: string;
  prompt: string;
  n?: number;
  response_format?: "url" | "b64_json";
  aspect_ratio?: string;
  resolution?: string;
  image?: unknown;
  images?: unknown[];
}
export interface ImageResponse { data: unknown[]; usage?: unknown; }

export class ImagesClient {
  constructor(private readonly transport: XaiTransport) {}
  create(request: ImageRequest): Promise<ImageResponse> {
    const edit = request.image !== undefined || request.images !== undefined;
    return requestJson(this.transport, edit ? "/images/edits" : "/images/generations", { method: "POST", ...jsonBody(request) }, (wire) => {
      const raw = expectObject(wire, "image response");
      if (!Array.isArray(raw.data)) throw new Error("image response.data must be an array");
      return { data: raw.data, usage: raw.usage };
    });
  }
}
```

### `src/surfaces/videos.ts`

```ts
import type { XaiTransport } from "../transport/fetch.js";
import { expectObject, expectString, jsonBody, requestJson } from "./client.js";

export type VideoOperation = "generations" | "edits" | "extensions";
export interface VideoStartResponse { requestId: string; }
export interface VideoPollResponse {
  status: "pending" | "done" | "failed" | "expired";
  progress?: number;
  video?: { url: string; duration?: number };
  error?: unknown;
  raw: Record<string, unknown>;
}

export class VideosClient {
  constructor(private readonly transport: XaiTransport) {}
  start(operation: VideoOperation, request: Record<string, unknown>): Promise<VideoStartResponse> {
    return requestJson(this.transport, `/videos/${operation}`, { method: "POST", ...jsonBody(request) }, (wire) => {
      const raw = expectObject(wire, "video start");
      return { requestId: expectString(raw.request_id, "video start.request_id") };
    }, { replayable: false });
  }
  poll(requestId: string): Promise<VideoPollResponse> {
    return requestJson(this.transport, `/videos/${encodeURIComponent(requestId)}`, {}, (wire) => {
      const raw = expectObject(wire, "video poll");
      const status = raw.status === "done" || raw.status === "failed" || raw.status === "expired" ? raw.status : "pending";
      const videoRaw = raw.video === undefined ? undefined : expectObject(raw.video, "video poll.video");
      return {
        status,
        progress: typeof raw.progress === "number" ? raw.progress : undefined,
        video: videoRaw ? { url: expectString(videoRaw.url, "video.url"), duration: typeof videoRaw.duration === "number" ? videoRaw.duration : undefined } : undefined,
        error: raw.error,
        raw,
      };
    });
  }
}
```

submit은 비멱등이므로 transport가 네트워크 reset이나 5xx를 자동 재실행하지 않게 `request(path, init, { replayable: false })`를 전달해야 한다. poll/list/get 같은 GET만 wp6 기본 retry를 허용한다. 이 세 번째 인자는 wp6 `XaiTransport` 계약의 일부이며 wp11이 별도 retry option을 만들지 않는다.

## 테스트 설계

### `tests/rest-surfaces.test.ts`

- fake `XaiTransport`가 기록한 method/path/body를 검사한다.
- 모든 path parameter에 `encodeURIComponent`가 적용됐는지 공격 문자열(`../`, `/`, `?`)로 검증한다.
- JSON 성공 본문은 `unknown` decoder를 지나며, 필수 top-level 필드 누락 시 실패한다.
- 오류 본문은 4096자로 제한되고 `status`, `code`, `message`를 보존한다.
- files/skills multipart에서 `Content-Type`을 직접 설정하지 않고 `file/files`가 마지막에 들어가는지 검사한다.
- `SURFACE_REGISTRY`에서 위 OpenAPI-only 경로가 모두 `openapi-only`인지, batches는 `official-guide`인지 검사한다.
- collections client가 management host 경로를 전혀 노출하지 않는지 검사한다.

### `tests/responses-ws.test.ts`

- fake socket open 전에는 connect가 resolve되지 않는다.
- Authorization bearer가 socket upgrade header에만 들어가고 event payload에는 나타나지 않는다.
- `response.create`에서 `stream`/`background`가 타입상 허용되지 않는다(`@ts-expect-error` fixture는 `src/` 밖이므로 별도 `tsc` fixture 대신 runtime key rejection test를 둔다).
- 두 turn이 동시에 제출되면 첫 terminal event 전까지 두 번째 socket send가 발생하지 않는다.
- raw WS JSON event가 turn 단위 synthetic SSE byte stream으로 들어가 wp7 `reduceResponsesStream`을 거쳐 `AdapterEvent`가 된다.
- `previous_response_not_found`, `websocket_connection_limit_reached`가 code를 잃지 않는다.
- close와 abort가 iterator를 반드시 종료한다.

### `tests/media-surfaces.test.ts`

- image reference가 없으면 `/images/generations`, 하나라도 있으면 `/images/edits`다.
- video `generations|edits|extensions`가 정확한 경로로 보내지고 `request_id` 없이는 실패한다.
- poll의 unknown/processing 상태는 `pending`, done/failed/expired는 terminal로 유지한다.
- 비멱등 submit이 재실행 불가 정책으로 transport에 전달됐는지 검사한다.

## 구현 순서와 검증

1. wp7의 core/reducer 파일과 wp10의 `ws` manifest/lock 상태가 충족됐는지 읽기 전용으로 확인한다. 누락 시 해당 소유 단계로 돌려보낸다.
2. `client.ts`, `index.ts`, `registry.ts`와 REST 클라이언트를 추가한다.
3. REST와 media 단위 테스트를 먼저 통과시킨다.
4. Responses WS 세션과 fake-socket 테스트를 추가한다.
5. 타입체크·빌드·전체 테스트를 실행한다.

명령:

```bash
npm run typecheck
node --test-concurrency=1 --import tsx --experimental-test-module-mocks --test tests/rest-surfaces.test.ts tests/media-surfaces.test.ts tests/responses-ws.test.ts
npm run build
npm test
```

라이브 검증은 API 비용과 계정 상태를 쓰므로 wp14에서 명시적 승인과 함께 수행한다. wp11 완료 판정에는 fake transport/WS 테스트로 충분하다.

## 공개 계약과 마이그레이션

- `~/.progrok/auth.json`: 필드 추가·삭제·이름 변경 없음. `getValidBearer()`를 통해 같은 파일을 읽는다.
- CLI: 명령·옵션·출력 변경 없음. wp12 전까지 새 클라이언트는 내부 API다.
- `/health`: `src/proxy/server.ts:42-44`의 `{ status:"ok", upstream:"xAI Grok", proxy:"progrok" }`를 그대로 유지한다.
- `/v1/*`: `src/proxy/server.ts:46-48`의 일반 HTTP 경로 릴레이를 유지한다. wp6가 고정한 `/deployment/config` 별도 credential과 `/feedback*` 자동 라우팅 금지를 wp11이 우회하지 않는다.
- WebSocket: 로컬 프록시가 WS를 대리하지 않는 기존 계약을 유지한다. 새 클라이언트는 `wss://api.x.ai/v1/responses`에 직접 연결한다.
- npm API: `src/surfaces/*`는 아직 `package.json` exports에 넣지 않는다. 외부 공개 SDK로 약속하지 않으며, wp12 내부 CLI가 직접 import한다.

따라서 사용자 마이그레이션은 없다. 내부 호출자는 wp12에서 direct `fetch`를 표면 클라이언트로 옮긴다.

## 완료 조건

- 매니페스트의 NEW 파일만 생성됐고, `package.json`/`package-lock.json`은 wp10 결과에서 변경되지 않았다.
- 모든 표면이 `SURFACE_REGISTRY`에 있고 근거 종류가 명시됐다.
- OpenAPI-only 경로가 일반 공식 문서 경로로 잘못 표시되지 않았다.
- Responses WS가 `response.create`, `previous_response_id`, 25분 종료, serial turn을 테스트로 증명한다.
- multipart와 binary가 JSON 공통 경로에 강제로 들어가지 않는다.
- 비멱등 media submit은 자동 재시도되지 않는다.
- `npm run typecheck`, 집중 테스트, `npm run build`, `npm test`가 모두 exit 0이다.
- auth 파일, 기존 CLI, `/health`, D2 제한 외 `/v1/*` 계약에 diff가 없다.
