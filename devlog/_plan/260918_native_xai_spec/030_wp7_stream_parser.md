# wp7 — 스트리밍 파서 구현 PRD

## 0. 목적과 범위

이 단계는 xAI의 Chat Completions SSE와 Responses SSE를 바이트 스트림에서 `AdapterEvent`로 환원하는 순수 코어를 만든다. HTTP, OAuth, 재시도, Express 응답 쓰기는 이 단계에 넣지 않는다. 입력은 모두 `unknown`으로 취급하며, 정상 종료는 명시적 terminal 프레임으로만 인정한다.

의존 순서는 `020_wp6_transport_core.md` 다음, `040_wp8_proxy_rewrite.md` 이전이다. wp8은 이 단계의 공개 함수만 사용해야 하며 reducer 내부 상태를 직접 읽지 않는다.

구조 결정은 다음과 같다.

- 바이트 경계와 UTF-8/SSE framing은 `src/wire/sse.ts`만 소유한다.
- Chat/Responses 의미 해석은 각각 별도 reducer가 소유한다.
- tool-call wire 검증과 증분 조립은 `src/wire/tool-calls.ts` 한 곳이 소유한다.
- 요청·메시지·도구의 공통 DTO는 `src/core/types.ts`가 소유한다.
- 공개 오류 code/detail과 unknown 오류의 안전한 축약은 `src/core/errors.ts`가 소유한다.
- reducer의 출력 계약은 `src/core/events.ts`의 discriminated union 하나다.
- 첫 terminal 이벤트가 성공/불완전/실패의 최종 권위자다. 이후 프레임은 해석하지 않는다.
- EOF는 terminal이 아니다. terminal 없이 EOF가 오면 반드시 `stream_truncated` 오류다.

거절한 대안:

- HTTP 핸들러 안에서 `TextDecoder`, JSON 파싱, tool-call 조립을 함께 하는 방식은 테스트 경계를 없애므로 거절한다.
- `data:` 한 줄마다 바로 tool call을 내보내는 방식은 마지막 조각에서 wire shape가 깨졌을 때 이미 실행 가능한 호출이 노출되므로 거절한다. terminal 시점까지 버퍼링하고 완전 검증한 뒤 방출한다.
- EOF를 묵시적 성공으로 바꾸는 호환 모드는 이번 단계에 두지 않는다. 로드맵 원칙 `000_plan.md:30-31`을 따른다.

## 1. 위협 모델과 불변식

자산은 프로세스 메모리, downstream에 노출되는 tool call, terminal 상태의 정확성이다. 공격자 또는 고장 난 upstream은 무한 길이 한 줄, 잘못된 UTF-8, 거대한 arguments, index 충돌, terminal 뒤 추가 데이터, 잘린 JSON을 보낼 수 있다.

반드시 지킬 불변식:

1. SSE residual과 현재 event의 합산 보유량은 `maxBufferedBytes`를 넘지 않는다.
2. tool arguments의 합산 UTF-8 바이트는 `maxToolCallBytes`를 넘지 않는다.
3. `TextDecoder`는 `fatal: true`로 동작하며 잘못된 UTF-8을 replacement character로 숨기지 않는다.
4. terminal은 `done | incomplete | error` 중 정확히 하나만 방출한다.
5. terminal 뒤 입력은 읽거나 방출하지 않는다.
6. Chat `tool_calls`의 claimed field는 타입이 틀리면 무시하지 않고 terminal error로 끝낸다.
7. 완성된 tool call은 non-blank name, string id, JSON object인 arguments를 가져야 한다.
8. 로그/오류에는 arguments 원문, 토큰, 응답 본문을 넣지 않는다. 진단은 field 이름과 value type만 담는다.

기본 상한은 `DEFAULT_MAX_SSE_BUFFER_BYTES = 1 * 1024 * 1024`, `DEFAULT_MAX_TOOL_CALL_BYTES = 8 * 1024 * 1024`로 둔다. 상한은 옵션으로 낮출 수 있지만 무제한 값은 허용하지 않는다.

## 2. 변경 파일 manifest

| 상태 | 정확한 경로 | 책임 |
|---|---|---|
| NEW | `src/core/types.ts` | 요청·메시지·도구의 canonical DTO |
| NEW | `src/core/errors.ts` | typed 오류 code/detail과 unknown 오류의 안전한 축약 |
| NEW | `src/core/events.ts` | `AdapterEvent`, terminal 타입, terminal 판별 |
| NEW | `src/wire/sse.ts` | UTF-8 바이트 디코딩, line/event framing, residual byte budget |
| NEW | `src/wire/tool-calls.ts` | Chat/Responses tool-call 증분 조립과 fail-closed 검증 |
| NEW | `src/wire/chat-stream.ts` | Chat SSE 의미 reducer |
| NEW | `src/wire/responses-stream.ts` | Responses SSE 의미 reducer |
| NEW | `tests/sse.test.ts` | split UTF-8/CRLF/multiline/budget/EOF framing 검증 |
| NEW | `tests/tool-calls.test.ts` | 증분 조립, 충돌, 타입 및 JSON 완결성 검증 |
| NEW | `tests/chat-stream.test.ts` | finish_reason, `[DONE]`, strict EOF, first-terminal 검증 |
| NEW | `tests/responses-stream.test.ts` | output item/delta/completed/incomplete/failed 검증 |
| NEW | `tests/core-errors.test.ts` | typed 오류 보존과 unknown 오류의 비노출 축약 검증 |

이 단계에는 MODIFY와 DELETE가 없다. 현재 `src/`에는 `core/`와 `wire/`가 없으므로 기존 구현을 우회하거나 중복 소유자를 만들지 않는다.

## 3. NEW — canonical core 계약

### 3.1 `src/core/types.ts`

wp11의 HTTP/WS surface를 포함한 후속 단계는 아래 타입을 import하고 같은 DTO를 다시 선언하지 않는다. `ResponsesRequest`에 index signature를 두지 않는 이유는 wp11의 `Omit<ResponsesRequest, "stream" | "background">`가 WebSocket create에서 두 필드를 실제로 금지하게 하기 위해서다.

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

export type MessageRole = "system" | "developer" | "user" | "assistant" | "tool";

export type MessageContentPart =
  | { type: "text" | "input_text" | "output_text"; text: string }
  | { type: "image_url" | "input_image"; image_url: string; detail?: "auto" | "low" | "high" };

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface CanonicalMessage {
  role: MessageRole;
  content: string | readonly MessageContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: readonly ToolCall[];
}

export interface FunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: JsonObject;
    strict?: boolean;
  };
}

export type HostedTool =
  | ({ type: "web_search" } & JsonObject)
  | ({ type: "x_search" } & JsonObject)
  | ({ type: "code_interpreter" } & JsonObject)
  | ({ type: "file_search" } & JsonObject)
  | ({ type: "mcp" } & JsonObject);

export type ToolDefinition = FunctionTool | HostedTool;

export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export interface ChatCompletionsRequest {
  model: string;
  messages: readonly CanonicalMessage[];
  tools?: readonly ToolDefinition[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export type ResponsesInputItem =
  | CanonicalMessage
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

export interface ResponsesRequest {
  model?: string;
  input: string | readonly ResponsesInputItem[];
  instructions?: string;
  tools?: readonly ToolDefinition[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean;
  stream?: boolean;
  background?: boolean;
  store?: boolean;
  previous_response_id?: string;
  conversation?: string | { id: string };
  include?: readonly string[];
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  metadata?: Readonly<Record<string, string>>;
}
```

`CanonicalMessage`는 두 API가 공유하는 최소 공통 계약이다. endpoint 전용 필드가 생기면 해당 surface에 좁은 타입을 두되 이 파일의 동일 개념을 복제하지 않는다. passthrough를 위해 `[key: string]: unknown`을 붙이는 방식은 금지한다. 새 wire 필드는 boundary decoder에서 검증한 뒤 이 canonical 계약에 명시적으로 추가한다.

### 3.2 `src/core/errors.ts`

오류 detail은 공개 가능한 필드만 가진다. unknown `Error.message`, stack, cause, response body, URL, header는 그대로 내보내지 않는다.

```ts
export type AdapterErrorCode =
  | "invalid_utf8"
  | "sse_buffer_limit"
  | "malformed_sse_json"
  | "invalid_wire_shape"
  | "invalid_tool_call"
  | "tool_call_buffer_limit"
  | "stream_truncated"
  | "upstream_error";

export interface SafeErrorDiagnostic {
  field?: string;
  valueType?: string;
  callIndex?: number;
}

export interface AdapterErrorDetail {
  code: AdapterErrorCode;
  message: string;
  status?: number;
  retryable: false;
  diagnostic?: SafeErrorDiagnostic;
}

export class AdapterError extends Error {
  readonly retryable = false as const;

  constructor(
    readonly code: AdapterErrorCode,
    message: string,
    readonly options: {
      status?: number;
      diagnostic?: SafeErrorDiagnostic;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AdapterError";
  }
}

export function toSafeErrorDetail(
  error: unknown,
  fallback: Pick<AdapterErrorDetail, "code" | "message">,
): AdapterErrorDetail {
  if (!(error instanceof AdapterError)) {
    return {
      ...fallback,
      retryable: false,
      diagnostic: {
        valueType: error === null ? "null" : Array.isArray(error) ? "array" : typeof error,
      },
    };
  }
  return {
    code: error.code,
    message: error.message.slice(0, 512),
    retryable: false,
    ...(error.options.status !== undefined ? { status: error.options.status } : {}),
    ...(error.options.diagnostic ? { diagnostic: error.options.diagnostic } : {}),
  };
}
```

`AdapterError` 생성자는 호출자가 이미 공개용으로 정제한 message만 받는다. `toSafeErrorDetail`은 typed 오류만 그 message를 보존하고 나머지는 caller가 준 고정 fallback으로 치환한다. `cause`는 디버깅용 chain에만 남고 반환 detail에는 포함하지 않는다.

### 3.3 `src/core/events.ts`

아래 타입을 그대로 공개 계약으로 만든다. `unknown` wire payload를 이 타입으로 cast하지 말고 reducer가 검증 후 생성한다.

```ts
import type { AdapterErrorDetail } from "./errors.js";

export interface AdapterUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  raw?: Record<string, unknown>;
}

export type AdapterTerminalEvent =
  | {
      type: "done";
      protocol: "chat" | "responses";
      finishReason?: string;
      responseId?: string;
      usage?: AdapterUsage;
    }
  | {
      type: "incomplete";
      protocol: "responses";
      reason: string;
      responseId?: string;
      usage?: AdapterUsage;
    }
  | ({ type: "error" } & AdapterErrorDetail);

export type AdapterEvent =
  | { type: "heartbeat" }
  | { type: "text_delta"; text: string; itemId?: string }
  | { type: "reasoning_delta"; text: string; itemId?: string }
  | { type: "tool_call_start"; id: string; name: string; itemId?: string }
  | { type: "tool_call_delta"; id: string; arguments: string }
  | { type: "tool_call_end"; id: string }
  | AdapterTerminalEvent;

export function isTerminalEvent(event: AdapterEvent): event is AdapterTerminalEvent {
  return event.type === "done" || event.type === "incomplete" || event.type === "error";
}
```

`raw` usage는 protocol renderer가 원형 필드를 보존할 때만 사용한다. 이 객체도 wp8의 요청별 메모리 상한에 포함해야 한다.

## 4. NEW — `src/wire/sse.ts`

### 공개 시그니처

```ts
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

export async function* decodeServerSentEvents(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  options: DecodeSseOptions = {},
): AsyncGenerator<SseEvent>;
```

### 핵심 본문 골격

```ts
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
  let retainedBytes = 0;
  let eventName: string | undefined;
  let eventId: string | undefined;
  let retry: number | undefined;
  let dataLines: string[] = [];

  const dispatch = (): SseEvent | undefined => {
    if (dataLines.length === 0) return undefined;
    const event: SseEvent = { data: dataLines.join("\n") };
    if (eventName !== undefined) event.event = eventName;
    if (eventId !== undefined) event.id = eventId;
    if (retry !== undefined) event.retry = retry;
    eventName = undefined;
    retry = undefined;
    dataLines = [];
    retainedBytes = Buffer.byteLength(residual, "utf8");
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
    if (field === "data") dataLines.push(value);
    else if (field === "event") eventName = value;
    else if (field === "id" && !value.includes("\0")) eventId = value;
    else if (field === "retry" && /^\d+$/.test(value)) retry = Number(value);
    return undefined;
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
      residual += decoded;
      retainedBytes = Buffer.byteLength(residual, "utf8")
        + dataLines.reduce((sum, line) => sum + Buffer.byteLength(line, "utf8"), 0);
      if (retainedBytes > maxBufferedBytes) {
        throw new SseDecodeError("sse_buffer_limit", "upstream SSE event exceeded the safe byte limit");
      }

      let newline: number;
      while ((newline = residual.indexOf("\n")) >= 0) {
        const line = residual.slice(0, newline);
        residual = residual.slice(newline + 1);
        const event = consumeLine(line);
        retainedBytes = Buffer.byteLength(residual, "utf8")
          + dataLines.reduce((sum, item) => sum + Buffer.byteLength(item, "utf8"), 0);
        if (retainedBytes > maxBufferedBytes) {
          throw new SseDecodeError("sse_buffer_limit", "upstream SSE event exceeded the safe byte limit");
        }
        if (event) yield event;
      }
    }

    try {
      residual += decoder.decode();
    } catch {
      throw new SseDecodeError("invalid_utf8", "upstream SSE ended inside a UTF-8 sequence");
    }
    if (residual.length > 0) consumeLine(residual);
    const finalEvent = dispatch();
    if (finalEvent) yield finalEvent;
  } finally {
    residual = "";
    dataLines = [];
  }
}
```

구현 시 `dataLines.reduce`의 반복 계산은 `dataBytes` 누적으로 바꿔도 된다. 단, 검증은 실제 UTF-8 byte 기준이어야 하며 JS code unit 길이를 쓰면 안 된다. EOF에서 완성된 마지막 SSE event를 한 번 내보내는 것은 framing 동작일 뿐 성공 판정이 아니다.

## 5. NEW — `src/wire/tool-calls.ts`

### 공개 시그니처

```ts
import type { AdapterEvent } from "../core/events.js";

export const DEFAULT_MAX_TOOL_CALL_BYTES = 8 * 1024 * 1024;

export class ToolCallWireError extends Error {
  constructor(
    readonly code: "invalid_tool_call" | "tool_call_buffer_limit",
    message: string,
    readonly diagnostic?: { field?: string; valueType?: string; callIndex?: number },
  ) {
    super(message);
    this.name = "ToolCallWireError";
  }
}

export interface ToolCallAssemblerOptions {
  maxBytes?: number;
}

export class ToolCallAssembler {
  constructor(options?: ToolCallAssemblerOptions);
  ingestChat(rawToolCalls: unknown): void;
  ingestResponsesItem(rawItem: unknown): void;
  ingestResponsesDelta(rawEvent: Record<string, unknown>): void;
  completeResponsesItem(rawItem: unknown): void;
  flush(): AdapterEvent[];
  clear(): void;
  get pendingCount(): number;
}
```

### 내부 상태와 검증 골격

```ts
interface PendingCall {
  key: string;
  index?: number;
  itemId?: string;
  id?: string;
  name?: string;
  arguments: string;
  sawArgumentsString: boolean;
  bytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueType(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

function optionalStreamString(
  value: unknown,
  field: string,
  alreadyKnown: boolean,
  callIndex?: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (alreadyKnown) return undefined; // 이미 검증된 필드의 continuation padding만 허용
  throw new ToolCallWireError("invalid_tool_call", `invalid ${field}`, {
    field,
    valueType: valueType(value),
    callIndex,
  });
}

function assertArgumentsObject(raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ToolCallWireError("invalid_tool_call", "tool arguments were incomplete JSON", {
      field: "function.arguments",
      valueType: "string",
    });
  }
  if (!isRecord(parsed)) {
    throw new ToolCallWireError("invalid_tool_call", "tool arguments must decode to an object", {
      field: "function.arguments",
      valueType: valueType(parsed),
    });
  }
}
```

`ingestChat` 구현 규칙:

1. `rawToolCalls === null | undefined`는 absent로 처리한다.
2. 그 외에는 배열이어야 한다. 각 원소는 object여야 한다.
3. `index`가 있으면 0 이상의 safe integer여야 한다.
4. `type`이 있으면 정확히 `"function"`이어야 한다.
5. `function`이 있으면 object여야 한다.
6. `id`, `function.name`, `function.arguments`는 present할 때 string이어야 한다. 다만 이미 같은 call에 정상 string이 저장된 뒤 continuation에서 온 null/undefined 또는 non-string padding은 해당 필드에 한해 무시한다.
7. 동일 index가 서로 다른 non-empty id/name을 주장하거나 동일 id가 서로 다른 index에 묶이면 즉시 오류다.
8. arguments 추가 전에 다음 합산 byte를 계산하고 상한을 넘으면 저장하지 않고 `tool_call_buffer_limit`을 던진다.

Responses 규칙:

- `response.output_item.added`의 `item.type === "function_call"`이면 `item.id`, `item.call_id`, `item.name`, `item.arguments`를 검증해 pending call을 만든다. 외부 호출 id는 `call_id`를 우선하고 없으면 `id`를 사용한다.
- `response.function_call_arguments.delta`는 `item_id` 또는 0 이상 safe integer `output_index`로 기존 call을 찾아 `delta: string`을 추가한다. 대상이 없으면 오류다.
- `response.output_item.done`의 function call item은 저장값과 충돌하지 않는지 검증하고 final snapshot의 arguments가 있으면 delta 누적값과 동일하거나 누적값을 prefix로 포함해야 한다. 불일치는 오류다.

`flush()`는 모든 pending call을 먼저 전부 검증한 뒤에만 이벤트 배열을 만든다. 하나라도 실패하면 아무 tool event도 반환하지 않는다.

```ts
flush(): AdapterEvent[] {
  const calls = [...this.calls.values()];
  for (const call of calls) {
    if (!call.id || !call.name || call.name.trim().length === 0 || !call.sawArgumentsString) {
      throw new ToolCallWireError("invalid_tool_call", "tool call was incomplete");
    }
    assertArgumentsObject(call.arguments);
  }
  const events = calls.flatMap<AdapterEvent>((call) => [
    { type: "tool_call_start", id: call.id!, name: call.name!, ...(call.itemId ? { itemId: call.itemId } : {}) },
    ...(call.arguments.length > 0
      ? [{ type: "tool_call_delta", id: call.id!, arguments: call.arguments } as AdapterEvent]
      : []),
    { type: "tool_call_end", id: call.id! },
  ]);
  this.clear();
  return events;
}
```

## 6. NEW — `src/wire/chat-stream.ts`

### 공개 시그니처와 핵심 골격

```ts
import type { AdapterEvent, AdapterUsage } from "../core/events.js";
import { decodeServerSentEvents, SseDecodeError, type DecodeSseOptions } from "./sse.js";
import { ToolCallAssembler, ToolCallWireError, type ToolCallAssemblerOptions } from "./tool-calls.js";

export interface ReduceChatStreamOptions extends DecodeSseOptions, ToolCallAssemblerOptions {}

export async function* reduceChatStream(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  options: ReduceChatStreamOptions = {},
): AsyncGenerator<AdapterEvent> {
  const tools = new ToolCallAssembler({ maxBytes: options.maxBytes });
  let terminal = false;
  let finishReason: string | undefined;
  let usage: AdapterUsage | undefined;

  const done = (): AdapterEvent => ({
    type: "done",
    protocol: "chat",
    ...(finishReason ? { finishReason } : {}),
    ...(usage ? { usage } : {}),
  });

  try {
    for await (const frame of decodeServerSentEvents(source, options)) {
      if (terminal) return;
      const payload = frame.data.trim();
      if (payload === "[DONE]") {
        for (const event of tools.flush()) yield event;
        terminal = true;
        yield done();
        return;
      }

      let raw: unknown;
      try { raw = JSON.parse(payload); }
      catch {
        terminal = true;
        yield { type: "error", code: "malformed_sse_json", message: "malformed Chat SSE data", retryable: false };
        return;
      }
      if (!isRecord(raw)) continue;
      if (raw.error !== undefined && raw.error !== null) {
        terminal = true;
        yield { type: "error", code: "upstream_error", message: safeUpstreamMessage(raw.error), retryable: false };
        return;
      }
      usage = parseUsage(raw.usage) ?? usage;
      if (raw.choices === undefined) continue;
      if (!Array.isArray(raw.choices) || !isRecord(raw.choices[0])) {
        terminal = true;
        yield invalidWire("choices", raw.choices);
        return;
      }
      const choice = raw.choices[0];
      if (isRecord(choice.delta)) {
        if (typeof choice.delta.content === "string" && choice.delta.content.length > 0) {
          yield { type: "text_delta", text: choice.delta.content };
        }
        if (typeof choice.delta.reasoning_content === "string" && choice.delta.reasoning_content.length > 0) {
          yield { type: "reasoning_delta", text: choice.delta.reasoning_content };
        }
        tools.ingestChat(choice.delta.tool_calls);
        if (choice.delta.tool_calls !== undefined && choice.delta.tool_calls !== null) yield { type: "heartbeat" };
      }
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        if (typeof choice.finish_reason !== "string" || choice.finish_reason.length === 0) {
          terminal = true;
          yield invalidWire("choices[0].finish_reason", choice.finish_reason);
          return;
        }
        finishReason = choice.finish_reason;
        for (const event of tools.flush()) yield event;
        terminal = true;
        yield done();
        return;
      }
    }
  } catch (error) {
    terminal = true;
    yield mapWireError(error);
    return;
  } finally {
    tools.clear();
  }

  if (!terminal) {
    yield {
      type: "error",
      code: "stream_truncated",
      message: "Chat SSE ended without finish_reason or [DONE]",
      retryable: false,
    };
  }
}
```

`isRecord`, `parseUsage`, `safeUpstreamMessage`, `invalidWire`, `mapWireError`는 이 파일의 private 함수로 둔다. `safeUpstreamMessage`는 문자열 message만 최대 512자로 잘라 사용하고 객체 전체를 stringify하지 않는다.

first-terminal 규칙 때문에 `finish_reason`이 먼저 오면 그 프레임이 terminal이며 뒤의 usage-only frame과 `[DONE]`은 읽지 않는다. xAI가 usage를 terminal 뒤에만 보내는 실측이 나오면 이 규칙을 완화하지 말고 terminal frame의 usage 보존을 xAI에 확인하거나 별도 정책 변경 문서로 처리한다.

## 7. NEW — `src/wire/responses-stream.ts`

### 공개 시그니처와 상태기계

```ts
import type { AdapterEvent, AdapterUsage } from "../core/events.js";
import { decodeServerSentEvents, type DecodeSseOptions } from "./sse.js";
import { ToolCallAssembler, type ToolCallAssemblerOptions } from "./tool-calls.js";

export interface ReduceResponsesStreamOptions extends DecodeSseOptions, ToolCallAssemblerOptions {}

export async function* reduceResponsesStream(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  options: ReduceResponsesStreamOptions = {},
): AsyncGenerator<AdapterEvent> {
  const tools = new ToolCallAssembler({ maxBytes: options.maxBytes });
  let terminal = false;
  const openItems = new Set<string>();

  try {
    for await (const frame of decodeServerSentEvents(source, options)) {
      if (terminal) return;
      let raw: unknown;
      try { raw = JSON.parse(frame.data); }
      catch {
        terminal = true;
        yield malformedResponsesFrame();
        return;
      }
      if (!isRecord(raw) || typeof raw.type !== "string") {
        terminal = true;
        yield invalidWire("type", isRecord(raw) ? raw.type : raw);
        return;
      }

      switch (raw.type) {
        case "response.output_item.added": {
          if (!isRecord(raw.item) || typeof raw.item.id !== "string") throw invalidShape("item");
          openItems.add(raw.item.id);
          if (raw.item.type === "function_call") tools.ingestResponsesItem(raw.item);
          break;
        }
        case "response.output_text.delta":
          if (typeof raw.delta !== "string") throw invalidShape("delta");
          if (raw.delta.length > 0) yield { type: "text_delta", text: raw.delta, ...itemId(raw) };
          break;
        case "response.reasoning_text.delta":
        case "response.reasoning_summary_text.delta":
          if (typeof raw.delta !== "string") throw invalidShape("delta");
          if (raw.delta.length > 0) yield { type: "reasoning_delta", text: raw.delta, ...itemId(raw) };
          break;
        case "response.function_call_arguments.delta":
          tools.ingestResponsesDelta(raw);
          yield { type: "heartbeat" };
          break;
        case "response.output_item.done":
          if (!isRecord(raw.item) || typeof raw.item.id !== "string" || !openItems.delete(raw.item.id)) {
            throw invalidShape("item.id");
          }
          if (raw.item.type === "function_call") tools.completeResponsesItem(raw.item);
          break;
        case "response.completed": {
          if (!isRecord(raw.response)) throw invalidShape("response");
          for (const event of tools.flush()) yield event;
          terminal = true;
          yield {
            type: "done",
            protocol: "responses",
            ...(typeof raw.response.id === "string" ? { responseId: raw.response.id } : {}),
            ...(parseUsage(raw.response.usage) ? { usage: parseUsage(raw.response.usage)! } : {}),
          };
          return;
        }
        case "response.incomplete":
          terminal = true;
          yield incompleteEvent(raw);
          return;
        case "response.failed":
        case "error":
          terminal = true;
          yield upstreamErrorEvent(raw);
          return;
        default:
          // 알려진 lifecycle 중 canonical 출력이 없는 이벤트는 heartbeat로 진행만 알린다.
          yield { type: "heartbeat" };
      }
    }
  } catch (error) {
    terminal = true;
    yield mapWireError(error);
    return;
  } finally {
    tools.clear();
  }

  if (!terminal) {
    yield {
      type: "error",
      code: "stream_truncated",
      message: "Responses SSE ended without response.completed, response.incomplete, response.failed, or error",
      retryable: false,
    };
  }
}
```

추가 규칙:

- `response.completed`에서 `openItems.size > 0`이면 완료 snapshot의 `response.output`으로 닫힌 item과 일치하는지 검증한다. 일치 확인이 안 되면 `invalid_wire_shape`다.
- `response.output_item.done`만으로 전체 turn을 완료하지 않는다.
- `response.completed` 안의 function call snapshot도 `ToolCallAssembler`에 대조한다. delta 경로와 completed snapshot이 서로 다르면 실패한다.
- terminal 뒤 `response.failed`나 `error`가 와도 첫 terminal이 권위자이므로 읽지 않는다.

## 8. NEW 테스트 파일

### `tests/sse.test.ts`

반드시 다음 케이스를 table-driven test로 구현한다.

- 한 UTF-8 다중 byte 문자를 모든 가능한 byte 경계에서 분할해도 동일한 data가 나온다.
- 잘못된 UTF-8과 중간 byte EOF는 `invalid_utf8`이다.
- `\n`, `\r\n`, comment, `data:` 여러 줄, final blank line 없는 event를 처리한다.
- residual 한 줄과 multiline data 합산이 상한을 1 byte 넘으면 `sse_buffer_limit`이다.
- event dispatch 후 budget이 해제되어 다음 작은 event를 받을 수 있다.

### `tests/tool-calls.test.ts`

- index 기준으로 id/name/arguments가 여러 delta에 나뉘어도 한 call로 조립된다.
- id-only로 시작하고 뒤에 index가 붙는 alias가 같은 call을 가리킨다.
- null continuation padding은 해당 필드의 정상 string을 이미 본 경우에만 허용된다.
- non-array, non-object call, 음수/소수/unsafe index, non-object function, non-string id/name/arguments, blank name은 각각 fail-closed다.
- 동일 index의 id/name 충돌과 동일 id의 index 충돌은 실패한다.
- arguments가 JSON object가 아니거나 잘린 JSON이면 `flush()`가 실패하며 tool event는 0개다.
- byte 상한 초과 시 기존 buffer를 더 키우지 않고 `tool_call_buffer_limit`이다.

### `tests/chat-stream.test.ts`

- text delta 뒤 `finish_reason: "stop"`이 오면 `text_delta`, `done` 순서이며 이후 `[DONE]`은 처리하지 않는다.
- `[DONE]`이 먼저 오면 done이고 이후 frame은 무시한다.
- tool call은 terminal 전에는 외부에 보이지 않고 terminal에서 start/delta/end 뒤 done 순서로 나온다.
- malformed JSON, malformed choices, malformed tool call은 error 하나로 terminal이다.
- text가 있었어도 terminal 없는 EOF는 `stream_truncated`다.
- terminal 없는 pending tool call EOF는 `stream_truncated`이며 tool event는 없다.

### `tests/responses-stream.test.ts`

- `output_item.added -> output_text.delta -> output_item.done -> response.completed`를 canonical text와 done으로 바꾼다.
- function call added/delta/done/completed를 terminal에서 한 번만 방출한다.
- delta와 done/completed snapshot 불일치는 error다.
- `response.incomplete`, `response.failed`, `error`는 각각 첫 terminal이다.
- output item done만 있고 EOF면 `stream_truncated`다.
- completed 뒤 failed를 붙여도 done 하나만 나온다.

### `tests/core-errors.test.ts`

- `AdapterError`의 code/status/diagnostic은 `toSafeErrorDetail`에 보존되고 `cause`와 stack은 결과에 없다.
- 일반 `Error`, string, object, null은 원문을 노출하지 않고 caller가 준 고정 fallback message를 반환한다.
- typed message는 512자에서 잘리고 `retryable`은 항상 `false`다.

테스트 helper는 각 테스트 파일 안의 작은 `chunks(...strings): AsyncIterable<Uint8Array>`로 둔다. 프로덕션 소스에 테스트 전용 export를 추가하지 않는다.

## 9. 구현 순서

1. `types.ts`, `errors.ts`, `events.ts`를 먼저 추가하고 `core-errors.test.ts`와 typecheck를 통과시킨다.
2. `sse.ts`와 `sse.test.ts`를 red-green으로 완성한다.
3. `tool-calls.ts`와 해당 테스트를 완성한다.
4. Chat reducer와 테스트를 완성한다.
5. Responses reducer와 테스트를 완성한다.
6. 전체 wp7 테스트, typecheck, 기존 전체 테스트를 순서대로 실행한다.

## 10. 검증 명령

```bash
cd /Users/jun/Developer/progrok
node --import tsx --test tests/core-errors.test.ts
node --import tsx --test tests/sse.test.ts
node --import tsx --test tests/tool-calls.test.ts
node --import tsx --test tests/chat-stream.test.ts
node --import tsx --test tests/responses-stream.test.ts
npm run typecheck
npm test
```

추가 수동 fixture 검증:

```bash
node --import tsx -e 'import { reduceChatStream } from "./src/wire/chat-stream.ts"; const e=new TextEncoder(); const s=(async function*(){yield e.encode("data: {\\"choices\\":[{\\"delta\\":{\\"content\\":\\"ok\\"}}]}\\n\\n");})(); for await (const x of reduceChatStream(s)) console.log(x.type)'
```

이 명령은 `text_delta` 다음 `error`를 출력해야 한다. EOF를 성공으로 추정하면 실패다.

## 11. 완료 조건

- manifest의 12개 NEW 파일이 존재하고 다른 파일은 바뀌지 않는다.
- 다섯 focused test 명령과 `npm run typecheck`, `npm test`가 exit 0이다.
- 모든 reducer 경로가 정확히 하나의 terminal을 내거나 호출자가 generator를 중단한다.
- terminal 없는 EOF, malformed tool call, byte budget 초과가 성공으로 바뀌지 않는다.
- 오류/진단에 tool arguments 원문이나 전체 upstream payload가 포함되지 않는다.
- wp11이 `ResponsesRequest`를 `src/core/types.ts`에서 import할 수 있고, unknown 오류는 `src/core/errors.ts`의 고정 fallback 경계를 우회하지 않는다.
- wp8이 `reduceChatStream`, `reduceResponsesStream`, `AdapterEvent` 외의 내부 상태에 의존하지 않아도 된다.
