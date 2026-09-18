# 단계 간 모듈 계약 (SSOT)

## 1. 규칙

이 문서는 `010_wp5_auth_core.md`부터 `120_wp16_release_push.md`까지 열두 단계 문서의 **소유 단계가 직접 선언한 named export**를 추출한 원장이다. 소비 단계가 다른 이름·경로·시그니처를 적었으면 소비 단계가 틀리며, 이 문서에서는 소유 단계의 선언으로 정규화한다. 뒤 단계가 같은 파일을 명시적으로 MODIFY하며 이전 계약을 교체한 경우에는 뒤 단계의 최종 선언을 적는다. 서로 다른 소유 문서가 양립할 수 없는 계약을 선언하고 어느 쪽이 교체인지 밝히지 않은 경우에는 임의로 고르지 않고 §4 미결에 남긴다.

이 원장은 owner 문서가 명시적으로 `export`한 이름만 수록한다. 기존 파일에 이미 있지만 owner 문서가 시그니처를 다시 선언하지 않은 export, private helper, default export, 테스트 파일의 비-export 심볼은 추정하지 않는다. 같은 이름이 public boundary에서 re-export되면 원본 모듈과 boundary 모듈 양쪽의 named export로 각각 센다.

세 가지 BLOCKER 판정은 다음과 같다.

1. **wire 계약:** wp7의 byte-stream API가 canonical이다. `reduceChatStream()`과 `reduceResponsesStream()`은 `ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>`를 받고 내부에서 `decodeServerSentEvents()`를 정확히 한 번 호출한다. 소비자가 decoder를 먼저 호출하고 `AsyncIterable<SseEvent>`를 reducer에 넘기는 사용법과 `SseFrame`이라는 이름은 폐기한다.
2. **오류 타입:** wp7의 실제 export인 `AdapterError`가 canonical이다. `XaiError`는 이 계약에 존재하지 않는다.
3. **Voice protocol:** `src/voice/protocol.ts`는 “기타 이벤트 타입” 같은 포괄 문장으로 축약하지 않는다. 아래에 40개 named export를 전부 적는다.

경로도 계약의 일부다. surface registry owner는 `src/surfaces/registry.ts`, 타입은 `SurfaceDescriptor`이며 `SurfaceRegistryEntry`는 존재하지 않는다. command manifest owner는 `src/commands/command-manifest.ts`이며 `src/cli` 아래가 아니다.

## 2. 모듈별 named export 원장

### wp5 — 인증 코어

#### `src/auth/token-client.ts` (5)

```ts
export interface OAuthTokenPayload { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; id_token?: unknown; token_type?: unknown }
export class OAuthTokenRequestError extends Error {
  constructor(status: number | undefined, oauthError: string | undefined, message: string, options?: { cause?: unknown; retryAfterMs?: number });
  readonly status: number | undefined;
  readonly oauthError: string | undefined;
  readonly retryAfterMs: number | undefined;
}
export interface TokenRequestDeps { fetch?: typeof globalThis.fetch; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; random?: () => number; now?: () => number }
export function postXaiToken(tokenEndpoint: string, fields: Record<string, string>, options?: { signal?: AbortSignal; deps?: TokenRequestDeps }): Promise<OAuthTokenPayload>;
export function refreshXaiToken(tokenEndpoint: string, refreshToken: string, options?: { signal?: AbortSignal; deps?: TokenRequestDeps }): Promise<OAuthTokenPayload>;
```

#### `src/auth/token-manager.ts` (5)

```ts
export interface BearerSnapshot { bearer: string; expiresAt: number; generation: number }
export interface TokenManagerDependencies {
  now(): number;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  load(): TokenData | null;
  save(input: SaveTokenInput): Promise<void>;
}
export function createTokenManager(deps?: TokenManagerDependencies): TokenManager;
export function getValidBearerSnapshot(opts?: { forceRefresh?: boolean; rejectedAccessToken?: string; signal?: AbortSignal }): Promise<BearerSnapshot>;
export function withBearer401Replay<T>(run: (bearer: string) => Promise<T>): Promise<T>;
```

`TokenManager`는 반환형에 쓰이지만 wp5 문서에서는 non-export interface다.

#### `src/auth/constants.ts` (12; wp5 생성 계약 + wp6 추가 계약)

```ts
export const XAI_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
export const XAI_OAUTH_FETCH_TIMEOUT_MS = 30 * 1000;
export const XAI_DEVICE_CODE_POLL_INTERVAL_MS = 5 * 1000;
export const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;
export const XAI_TOKEN_MAX_ATTEMPTS = 3;
export const XAI_TOKEN_RETRY_AFTER_CAP_MS = 60 * 1000;
export const XAI_REFRESH_FLIGHT_STALE_MS = 2 * 60 * 1000;
export const XAI_TERMINAL_FAILURE_TTL_MS = 30 * 1000;
export const XAI_PUBLIC_API_BASE_URL = "https://api.x.ai/v1";
export const XAI_SESSION_API_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
export const XAI_API_BASE_URL = XAI_PUBLIC_API_BASE_URL;
export const DEFAULT_MODEL = "grok-4.3";
```

#### `src/auth/discovery.ts` (1)

```ts
export function fetchOIDCDiscovery(signal?: AbortSignal): Promise<OIDCDiscovery>;
```

#### `src/auth/token-store.ts` (6)

```ts
export interface TokenData {
  accessToken: string; refreshToken?: string; expiresAt?: number; tokenEndpoint?: string;
  email?: string; idToken?: string; accountId?: string; [key: string]: unknown;
}
export function loadTokens(): TokenData | null;
export function saveTokens(input: SaveTokenInput): Promise<void>;
export function deleteTokens(): void;
export function getValidBearer(options?: { forceRefresh?: boolean; rejectedAccessToken?: string; signal?: AbortSignal }): Promise<string>;
export function saveTokensFromOAuthPayload(payload: OAuthTokenPayload, context: { tokenEndpoint: string }): Promise<void>;
```

### wp6 — 전송 코어

#### `src/transport/base-url.ts` (11; wp10이 versioned path 지원을 추가한 최종 계약)

```ts
export const XAI_PUBLIC_API_ORIGIN = "https://api.x.ai";
export const XAI_PUBLIC_API_BASE_URL = `${XAI_PUBLIC_API_ORIGIN}/v1`;
export const XAI_SESSION_API_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
export type PublicApiAuthKind = "oauth" | "api-key";
export type UpstreamAuthKind = PublicApiAuthKind | "deployment-key";
export interface CliChatProxyOptIn { explicitOptIn: true }
export function normalizeXaiPath(pathname: string): string;
export function resolveUpstreamBase(kind: PublicApiAuthKind): string;
export function resolveUpstreamUrl(path: string, kind: PublicApiAuthKind): string;
export function resolveCliChatProxyUrl(pathname: string, optIn: CliChatProxyOptIn): URL;
export function resolveDeploymentConfigUrl(authKind: Extract<UpstreamAuthKind, "deployment-key">, optIn: CliChatProxyOptIn): URL;
```

#### `src/transport/headers.ts` (3)

```ts
export interface GrokTraceContext { requestId?: string; conversationId?: string; sessionId?: string; agentId?: string; turnIndex?: number; modelOverride?: string; transientRetry?: boolean }
export interface BuildUpstreamHeadersInput { incoming?: Headers | Record<string, string | string[] | undefined>; auth: { kind: UpstreamAuthKind; bearer: string }; trace?: GrokTraceContext; clientVersion: string }
export function buildUpstreamHeaders(input: BuildUpstreamHeadersInput): Headers;
```

#### `src/transport/retry.ts` (6)

```ts
export type ReplayClass = "replayable" | "not-replayable";
export interface RetryPolicy { replay: ReplayClass; maxAttempts: number; baseDelayMs: number; maxDelayMs: number; retry429: boolean; retry5xx: boolean }
export function classifyReplay(method: string, headers: Headers): ReplayClass;
export function isRetryableStatus(status: number, policy: RetryPolicy): boolean;
export function retryDelayMs(attempt: number, headers: Headers, policy: RetryPolicy, now?: number): number | undefined;
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void>;
```

#### `src/transport/fetch.ts` (7)

```ts
export interface XaiFetchInput { pathWithQuery: string; method: string; headers: Headers; body?: BodyInit | null; signal?: AbortSignal }
export interface XaiTransport { fetch(input: XaiFetchInput): Promise<Response> }
export function executeXaiFetch(input: XaiFetchInput, deps: { bearer: string; fetchImpl?: typeof fetch }): Promise<Response>;
export function xaiFetch(input: XaiFetchInput, deps?: { fetchImpl?: typeof fetch }): Promise<Response>;
export function createXaiTransport(opts?: { fetchImpl?: typeof fetch }): XaiTransport;
export type CliChatProxyCredential = { kind: "oauth" } | { kind: "deployment-key"; env: "GROK_DEPLOYMENT_KEY" };
export function createCliChatProxyTransport(options: { explicitOptIn: true; credential: CliChatProxyCredential; signal?: AbortSignal; timeoutMs?: number }): XaiTransport;
```

### wp7 — canonical core와 wire

#### `src/core/types.ts` (14)

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }
export type MessageRole = "system" | "developer" | "user" | "assistant" | "tool";
export type MessageContentPart = { type: "text" | "input_text" | "output_text"; text: string } | { type: "image_url" | "input_image"; image_url: string; detail?: "auto" | "low" | "high" };
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface CanonicalMessage { role: MessageRole; content: string | readonly MessageContentPart[] | null; name?: string; tool_call_id?: string; tool_calls?: readonly ToolCall[] }
export interface FunctionTool { type: "function"; function: { name: string; description?: string; parameters: JsonObject; strict?: boolean } }
export type HostedTool = ({ type: "web_search" } & JsonObject) | ({ type: "x_search" } & JsonObject) | ({ type: "code_interpreter" } & JsonObject) | ({ type: "file_search" } & JsonObject) | ({ type: "mcp" } & JsonObject);
export type ToolDefinition = FunctionTool | HostedTool;
export type ToolChoice = "none" | "auto" | "required" | { type: "function"; function: { name: string } };
export interface ChatCompletionsRequest { model: string; messages: readonly CanonicalMessage[]; tools?: readonly ToolDefinition[]; tool_choice?: ToolChoice; parallel_tool_calls?: boolean; stream?: boolean; temperature?: number; top_p?: number; max_tokens?: number }
export type ResponsesInputItem = CanonicalMessage | { type: "function_call"; call_id: string; name: string; arguments: string } | { type: "function_call_output"; call_id: string; output: string };
export interface ResponsesRequest { model?: string; input: string | readonly ResponsesInputItem[]; instructions?: string; tools?: readonly ToolDefinition[]; tool_choice?: ToolChoice; parallel_tool_calls?: boolean; stream?: boolean; background?: boolean; store?: boolean; previous_response_id?: string; conversation?: string | { id: string }; include?: readonly string[]; max_output_tokens?: number; temperature?: number; top_p?: number; metadata?: Readonly<Record<string, string>> }
```

#### `src/core/errors.ts` (5)

```ts
export type AdapterErrorCode = "invalid_utf8" | "sse_buffer_limit" | "malformed_sse_json" | "invalid_wire_shape" | "invalid_tool_call" | "tool_call_buffer_limit" | "stream_truncated" | "upstream_error";
export interface SafeErrorDiagnostic { field?: string; valueType?: string; callIndex?: number }
export interface AdapterErrorDetail { code: AdapterErrorCode; message: string; status?: number; retryable: false; diagnostic?: SafeErrorDiagnostic }
export class AdapterError extends Error { readonly retryable: false; constructor(code: AdapterErrorCode, message: string, options?: { status?: number; diagnostic?: SafeErrorDiagnostic; cause?: unknown }); readonly code: AdapterErrorCode; readonly options: { status?: number; diagnostic?: SafeErrorDiagnostic; cause?: unknown } }
export function toSafeErrorDetail(error: unknown, fallback: Pick<AdapterErrorDetail, "code" | "message">): AdapterErrorDetail;
```

#### `src/core/events.ts` (4)

```ts
export interface AdapterUsage { inputTokens?: number; outputTokens?: number; totalTokens?: number; raw?: Record<string, unknown> }
export type AdapterTerminalEvent = { type: "done"; protocol: "chat" | "responses"; finishReason?: string; responseId?: string; usage?: AdapterUsage } | { type: "incomplete"; protocol: "responses"; reason: string; responseId?: string; usage?: AdapterUsage } | ({ type: "error" } & AdapterErrorDetail);
export type AdapterEvent = { type: "heartbeat" } | { type: "text_delta"; text: string; itemId?: string } | { type: "reasoning_delta"; text: string; itemId?: string } | { type: "tool_call_start"; id: string; name: string; itemId?: string } | { type: "tool_call_delta"; id: string; arguments: string } | { type: "tool_call_end"; id: string } | AdapterTerminalEvent;
export function isTerminalEvent(event: AdapterEvent): event is AdapterTerminalEvent;
```

#### `src/wire/sse.ts` (5)

```ts
export const DEFAULT_MAX_SSE_BUFFER_BYTES = 1024 * 1024;
export interface SseEvent { event?: string; data: string; id?: string; retry?: number }
export interface DecodeSseOptions { maxBufferedBytes?: number }
export class SseDecodeError extends Error { constructor(code: "invalid_utf8" | "sse_buffer_limit", message: string); readonly code: "invalid_utf8" | "sse_buffer_limit" }
export function decodeServerSentEvents(source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>, options?: DecodeSseOptions): AsyncGenerator<SseEvent>;
```

#### `src/wire/tool-calls.ts` (4)

```ts
export const DEFAULT_MAX_TOOL_CALL_BYTES = 8 * 1024 * 1024;
export class ToolCallWireError extends Error { constructor(code: "invalid_tool_call" | "tool_call_buffer_limit", message: string, diagnostic?: { field?: string; valueType?: string; callIndex?: number }); readonly code: "invalid_tool_call" | "tool_call_buffer_limit"; readonly diagnostic?: { field?: string; valueType?: string; callIndex?: number } }
export interface ToolCallAssemblerOptions { maxBytes?: number }
export class ToolCallAssembler { constructor(options?: ToolCallAssemblerOptions); ingestChat(rawToolCalls: unknown): void; ingestResponsesItem(rawItem: unknown): void; ingestResponsesDelta(rawEvent: Record<string, unknown>): void; completeResponsesItem(rawItem: unknown): void; flush(): AdapterEvent[]; clear(): void; get pendingCount(): number }
```

#### `src/wire/chat-stream.ts` (2)

```ts
export interface ReduceChatStreamOptions extends DecodeSseOptions, ToolCallAssemblerOptions {}
export function reduceChatStream(source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>, options?: ReduceChatStreamOptions): AsyncGenerator<AdapterEvent>;
```

#### `src/wire/responses-stream.ts` (2)

```ts
export interface ReduceResponsesStreamOptions extends DecodeSseOptions, ToolCallAssemblerOptions {}
export function reduceResponsesStream(source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>, options?: ReduceResponsesStreamOptions): AsyncGenerator<AdapterEvent>;
```

### wp8 — 프록시 재작성

#### `src/proxy/route-policy.ts` (2)

```ts
export type ProxyRouteDecision = { kind: "native-chat"; json: Record<string, unknown> } | { kind: "native-responses"; json: Record<string, unknown> } | { kind: "json-relay"; json: Record<string, unknown> } | { kind: "opaque-relay" };
export function decideProxyRoute(input: { method: string; relPath: string; contentType?: string; body: Buffer }): ProxyRouteDecision;
```

#### `src/proxy/body.ts` (3)

```ts
export const MAX_PROXY_BODY_BYTES = 100 * 1024 * 1024;
export class PayloadTooLargeError extends Error { constructor(limitBytes: number); readonly limitBytes: number }
export function readBoundedBody(req: Request, limitBytes?: number): Promise<Buffer>;
```

#### `src/proxy/relay.ts` (4)

```ts
export const HOP_BY_HOP_HEADERS: Set<string>;
export function filterRequestHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string>;
export function copyUpstreamHeaders(upstream: Response, res: ExpressResponse): void;
export function relayUpstreamResponse(upstream: Response, res: ExpressResponse): Promise<void>;
```

#### `src/proxy/render-chat.ts` (2)

```ts
export interface ChatRenderContext { model: string; id?: string; created?: number }
export function renderChatEvents(first: AdapterEvent, rest: AsyncIterator<AdapterEvent>, res: Response, context: ChatRenderContext): Promise<void>;
```

#### `src/proxy/render-responses.ts` (1)

```ts
export function renderResponsesEvents(first: AdapterEvent, rest: AsyncIterator<AdapterEvent>, res: Response, model: string): Promise<void>;
```

#### `src/proxy/native-stream.ts` (2)

```ts
export type NativeProtocol = "chat" | "responses";
export function serveNativeStream(input: { protocol: NativeProtocol; upstream: Response; downstream: ExpressResponse; model: string }): Promise<"handled" | "relay">;
```

#### `src/proxy/composer-inject.ts` (3)

```ts
export interface PreparedGrokRequest { value: Record<string, unknown>; changed: boolean }
export function prepareGrokRequestObject(relPath: string, parsed: Record<string, unknown>): PreparedGrokRequest;
export function prepareGrokRequest(relPath: string, body: Buffer): Buffer;
```

#### `src/proxy/server.ts` (2; wp8 최종 계약)

```ts
export interface ProxyAppDependencies { getBearer(): Promise<string>; fetchUpstream: typeof executeXaiFetch }
export function createProxyApp(deps?: Partial<ProxyAppDependencies>): express.Express;
```

### wp9 — Voice protocol과 REST

#### `src/voice/protocol.ts` (40)

```ts
export const XAI_VOICE_WS_ORIGIN = "wss://api.x.ai" as const;
export const PINNED_REALTIME_MODEL = "grok-voice-think-fast-2.0" as const;
export const REALTIME_MODEL_ALIAS = "grok-voice-latest" as const;
export const XAI_EPHEMERAL_PROTOCOL_PREFIX = "xai-client-secret." as const;
export const STT_CLIENT_EVENT_TYPES = ["finalize", "Finalize", "audio.done"] as const;
export const STT_EVENTS: { created: "transcript.created"; partial: "transcript.partial"; done: "transcript.done"; error: "error" };
export const STT_SERVER_EVENT_TYPES = Object.values(STT_EVENTS);
export const TTS_CLIENT_EVENT_TYPES = ["text.delta", "text.done"] as const;
export const TTS_SERVER_EVENT_TYPES = ["audio.delta", "audio.done", "error"] as const;
export const REALTIME_CLIENT_EVENT_TYPES: readonly ["session.update", "input_audio_buffer.append", "input_audio_buffer.commit", "input_audio_buffer.clear", "conversation.item.create", "conversation.item.delete", "conversation.item.truncate", "response.create", "response.cancel", "pong"];
export const REALTIME_SERVER_EVENT_TYPES: readonly ["session.created", "session.updated", "conversation.created", "conversation.item.added", "conversation.item.created", "conversation.item.deleted", "conversation.item.truncated", "conversation.item.input_audio_transcription.updated", "conversation.item.input_audio_transcription.completed", "input_audio_buffer.speech_started", "input_audio_buffer.speech_stopped", "input_audio_buffer.committed", "input_audio_buffer.cleared", "input_audio_buffer.timeout_triggered", "input_audio_buffer.dtmf_event_received", "response.created", "response.done", "response.output_item.added", "response.output_item.done", "response.content_part.added", "response.content_part.done", "response.output_audio.delta", "response.output_audio.done", "response.output_audio_transcript.delta", "response.output_audio_transcript.done", "response.text.delta", "response.output_text.delta", "response.function_call_arguments.delta", "response.function_call_arguments.done", "mcp_list_tools.in_progress", "mcp_list_tools.completed", "mcp_list_tools.failed", "response.mcp_call_arguments.delta", "response.mcp_call_arguments.done", "response.mcp_call.in_progress", "response.mcp_call.completed", "response.mcp_call.failed", "response.cancelled", "ping", "error"];

export interface EphemeralClientSecret { value: string; expires_at: number }
export const ephemeralProtocols: (secret: string) => string[];
export interface StreamingSttWord { text: string; start: number; end: number; confidence?: number; speaker?: number }
export type SttClientControl = { type: "finalize" | "Finalize"; channel?: number } | { type: "audio.done" };
export type SttServerEvent = { type: "transcript.created"; id: string } | { type: "transcript.partial"; text: string; words: StreamingSttWord[]; is_final: boolean; speech_final: boolean; start: number; duration: number; channel_index?: number; end_of_turn_confidence?: number } | { type: "transcript.done"; text: string; words: StreamingSttWord[]; duration: number; channel_index?: number } | { type: "error"; message: string };
export type TtsClientEvent = { type: "text.delta"; delta: string } | { type: "text.done" };
export interface StreamingAudioTimestamps { graph_chars: string[]; graph_times: [number, number][] }
export type TtsServerEvent = { type: "audio.delta"; delta: string; audio_timestamps?: StreamingAudioTimestamps; audio_duration?: number } | { type: "audio.done"; trace_id?: string } | { type: "error"; message: string };

export type RealtimeVoiceModel = string;
export type RealtimeReasoningEffort = "low" | "medium" | "high";
export type RealtimeAudioType = "audio/pcm" | "audio/pcmu" | "audio/pcma" | "audio/opus";
export type RealtimeAudioRate = 8000 | 11025 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
export type RealtimeAudioTransport = "json" | "binary";
export interface RealtimeAudioFormat { type: RealtimeAudioType; rate?: RealtimeAudioRate }
export interface RealtimeTurnDetection { type: "server_vad"; threshold?: number; silence_duration_ms?: number; prefix_padding_ms?: number; idle_timeout_ms?: number | null }
export interface RealtimeInputTranscription { model?: "grok-transcribe"; language_hint?: string; keyterms?: string[] }
export interface RealtimeAudioConfig { input?: { format?: RealtimeAudioFormat; transport?: RealtimeAudioTransport; transcription?: RealtimeInputTranscription }; output?: { format?: RealtimeAudioFormat; transport?: RealtimeAudioTransport; speed?: number } }
export type RealtimeTool =
  | { type: "function"; function: { name: string; description?: string; parameters: Record<string, unknown> } }
  | { type: "web_search"; location?: { country?: string; city?: string; region?: string; timezone?: string }; allowed_domains?: string[]; excluded_domains?: string[]; enable_image_understanding?: boolean }
  | { type: "x_search"; allowed_x_handles?: string[]; excluded_x_handles?: string[]; from_date?: string; to_date?: string; enable_image_understanding?: boolean; enable_video_understanding?: boolean }
  | { type: "file_search"; vector_store_ids: string[]; max_num_results?: number }
  | { type: "mcp"; server_label: string; server_url: string; server_description?: string; allowed_tools?: string[]; authorization?: string; headers?: Record<string, string> };
export interface RealtimeSessionConfig { model?: RealtimeVoiceModel; instructions?: string; reasoning?: { effort?: RealtimeReasoningEffort }; voice?: string; turn_detection?: RealtimeTurnDetection | null; resumption?: { enabled: boolean }; audio?: RealtimeAudioConfig; tools?: RealtimeTool[]; replace?: Record<string, string> | null }
export type RealtimeContentPart = { type: "input_text" | "text"; text: string } | { type: "input_audio" | "audio"; audio: string; transcript?: string };
export type RealtimeConversationItem = { type: "message"; id?: string; role: "user" | "assistant" | "system"; content: RealtimeContentPart[] } | { type: "function_call"; id?: string; name: string; arguments: string; call_id?: string } | { type: "function_call_output"; id?: string; call_id: string; output: string } | { type: "force_message"; role: "assistant"; content: [{ type: "output_text"; text: string }]; interruptible?: boolean };
export type RealtimeClientEvent = { type: "session.update"; session: RealtimeSessionConfig } | { type: "input_audio_buffer.append"; audio: string } | { type: "input_audio_buffer.commit" } | { type: "input_audio_buffer.clear" } | { type: "conversation.item.create"; item: RealtimeConversationItem; previous_item_id?: string } | { type: "conversation.item.delete"; item_id: string } | { type: "conversation.item.truncate"; item_id: string; content_index: number; audio_end_ms: number } | { type: "response.create"; response?: { modalities?: ("text" | "audio")[] | null; instructions?: string | null; metadata?: Record<string, string> | null } } | { type: "response.cancel"; response_id?: string } | { type: "pong"; ping_timestamp: number };
export interface RealtimeEventBase { event_id?: string }
export type RealtimeServerEvent =
  | (RealtimeEventBase & { type: "session.created" | "session.updated"; session: Record<string, unknown> })
  | (RealtimeEventBase & { type: "conversation.created"; conversation: { id: string } })
  | (RealtimeEventBase & { type: "conversation.item.added" | "conversation.item.created"; previous_item_id?: string; item: Record<string, unknown> })
  | (RealtimeEventBase & { type: "conversation.item.deleted"; item_id: string })
  | (RealtimeEventBase & { type: "conversation.item.truncated"; item_id: string; content_index: number; audio_end_ms: number; transcript?: string })
  | (RealtimeEventBase & { type: "conversation.item.input_audio_transcription.updated" | "conversation.item.input_audio_transcription.completed"; item_id: string; transcript: string })
  | (RealtimeEventBase & { type: "input_audio_buffer.speech_started"; item_id: string; audio_start_ms: number })
  | (RealtimeEventBase & { type: "input_audio_buffer.speech_stopped"; item_id: string; audio_end_ms: number })
  | (RealtimeEventBase & { type: "input_audio_buffer.committed"; item_id: string; previous_item_id?: string })
  | (RealtimeEventBase & { type: "input_audio_buffer.cleared" })
  | (RealtimeEventBase & { type: "input_audio_buffer.timeout_triggered"; item_id: string; audio_start_ms: number; audio_end_ms: number; previous_item_id?: string })
  | (RealtimeEventBase & { type: "input_audio_buffer.dtmf_event_received"; event: "0"|"1"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"*"|"#"; received_at: number })
  | (RealtimeEventBase & { type: "response.created" | "response.done"; response: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.output_item.added" | "response.output_item.done"; response_id: string; output_index: number; item: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.content_part.added" | "response.content_part.done"; response_id: string; item_id: string; output_index: number; content_index: number; part: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.output_audio.delta"; response_id: string; item_id: string; output_index: number; content_index: number; delta: string })
  | (RealtimeEventBase & { type: "response.output_audio.done"; response_id: string; item_id: string; output_index: number; content_index: number })
  | (RealtimeEventBase & { type: "response.output_audio_transcript.delta"; response_id: string; item_id: string; output_index: number; content_index: number; delta: string })
  | (RealtimeEventBase & { type: "response.output_audio_transcript.done"; response_id: string; item_id: string; output_index: number; content_index: number; transcript: string })
  | (RealtimeEventBase & { type: "response.text.delta" | "response.output_text.delta"; response_id: string; item_id: string; delta: string; output_index?: number; content_index?: number })
  | (RealtimeEventBase & { type: "response.function_call_arguments.delta"; response_id: string; item_id: string; output_index: number; call_id: string; delta: string })
  | (RealtimeEventBase & { type: "response.function_call_arguments.done"; response_id: string; item_id: string; output_index: number; call_id: string; name: string; arguments: string })
  | (RealtimeEventBase & { type: "mcp_list_tools.in_progress" | "mcp_list_tools.completed"; item_id: string })
  | (RealtimeEventBase & { type: "mcp_list_tools.failed"; item_id: string; error: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.mcp_call_arguments.delta"; response_id: string; item_id: string; call_id: string; delta: string })
  | (RealtimeEventBase & { type: "response.mcp_call_arguments.done"; response_id: string; item_id: string; call_id: string; name: string; arguments: string })
  | (RealtimeEventBase & { type: "response.mcp_call.in_progress" | "response.mcp_call.completed"; item_id: string; output_index: number })
  | (RealtimeEventBase & { type: "response.mcp_call.failed"; item_id: string; output_index: number; error: Record<string, unknown> })
  | (RealtimeEventBase & { type: "response.cancelled"; response_id?: string })
  | { type: "ping"; timestamp: number }
  | (RealtimeEventBase & { type: "error"; error: { code?: string; type?: string; message: string } });
export type RealtimeNormalizedEvent = RealtimeServerEvent | { type: "response.output_audio.binary"; bytes: Uint8Array };
export class VoiceProtocolError extends Error { constructor(code: "invalid_event" | "unexpected_binary" | "abnormal_close" | "queue_limit", message: string); readonly code: "invalid_event" | "unexpected_binary" | "abnormal_close" | "queue_limit" }
export function parseSttServerEvent(text: string): SttServerEvent;
export function parseTtsServerEvent(text: string): TtsServerEvent;
export function parseRealtimeServerEvent(text: string): RealtimeServerEvent;
```

#### `src/voice/http.ts` (8)

```ts
export type VoiceErrorCode = "voice_auth_required" | "voice_forbidden" | "voice_not_found" | "voice_validation_error" | "voice_rate_limited" | "voice_upstream_error" | "voice_invalid_response";
export class VoiceHttpError extends Error { constructor(code: VoiceErrorCode, status: number | undefined, message: string, retryAfter?: string); readonly code: VoiceErrorCode; readonly status: number | undefined; readonly retryAfter?: string }
export interface VoiceClientOptions { transport?: XaiTransport }
export interface VoiceHttpClient { request(path: string, init?: RequestInit): Promise<Response>; requestJson<T>(path: string, init: RequestInit, decode: (wire: unknown) => T): Promise<T>; requestBytes(path: string, init?: RequestInit): Promise<{ bytes: Uint8Array; contentType: string }> }
export function createVoiceHttpClient(options?: VoiceClientOptions): VoiceHttpClient;
export function expectRecord(wire: unknown, label: string): Record<string, unknown>;
export function expectString(record: Record<string, unknown>, key: string): string;
export function jsonBody(value: unknown): Pick<RequestInit, "headers" | "body">;
```

#### `src/voice/tts.ts` (12)

```ts
export type TtsCodec = "mp3" | "wav" | "pcm" | "mulaw" | "alaw";
export type AudioSampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
export type Mp3BitRate = 32000 | 64000 | 96000 | 128000 | 192000;
export interface TtsOutputFormat { codec: TtsCodec; sample_rate?: AudioSampleRate | null; bit_rate?: Mp3BitRate | null }
export interface TtsRequest { text: string; language: "auto" | (string & {}); voice_id?: string; output_format?: TtsOutputFormat; optimize_streaming_latency?: "0" | "1"; text_normalization?: boolean; with_timestamps?: boolean; speed?: number; replace?: Record<string, string> }
export interface TtsGraphTime { start: number; end: number }
export interface TtsAudioTimestamps { graph_chars: string[]; graph_times: TtsGraphTime[] }
export interface TtsJsonResponse { audio: string; content_type: string; duration: number; audio_timestamps?: TtsAudioTimestamps }
export type TtsResult = { kind: "audio"; bytes: Uint8Array; contentType: string; duration?: number } | { kind: "json"; body: unknown };
export interface TtsVoice { voice_id: string; name: string; language: string | null }
export interface ListTtsVoicesResponse { voices: TtsVoice[] }
export function createTtsClient(deps?: { transport?: XaiTransport }): { synthesize(req: TtsRequest): Promise<TtsResult> };
```

#### `src/voice/stt.ts` (8)

```ts
export type SttAudioFormat = "pcm" | "mulaw" | "alaw" | "wav" | "mp3" | "ogg" | "opus" | "flac" | "aac" | "mp4" | "m4a" | "mkv";
export type SttSource = { file: Blob; filename: string; url?: never } | { url: string; file?: never; filename?: never };
export type SttRequest = SttSource & { audio_format?: SttAudioFormat; sample_rate?: AudioSampleRate; language?: string; format?: boolean; multichannel?: boolean; channels?: number; diarize?: boolean; keyterm?: string[]; filler_words?: boolean; vad_threshold?: number };
export interface SttWord { text: string; start: number; end: number; confidence?: number; speaker?: number }
export interface SttChannel { index: number; language?: string; text: string; words?: SttWord[] }
export interface SttResult { text: string; language: string; duration: number; words?: SttWord[]; channels?: SttChannel[] }
export function buildSttForm(request: SttRequest): FormData;
export function createSttClient(deps?: { transport?: XaiTransport }): { transcribe(req: SttRequest): Promise<SttResult> };
```

#### `src/voice/custom-voices.ts` (14)

```ts
export type VoiceGender = "male" | "female" | "neutral";
export type VoiceAge = "young" | "middle-aged" | "old";
export type VoiceUseCase = "conversational" | "narration" | "characters" | "educational" | "advertisement" | "social_media" | "entertainment";
export type VoiceTone = "warm" | "casual" | "professional" | "friendly" | "authoritative" | "expressive" | "calm";
export interface CustomVoiceMetadataInput { name?: string; description?: string; gender?: VoiceGender; accent?: string; age?: VoiceAge; language?: string; use_case?: VoiceUseCase; tone?: VoiceTone }
export interface CreateCustomVoiceRequest extends CustomVoiceMetadataInput { file: Blob; filename: string }
export interface UpdateCustomVoiceRequest { name?: string | null; description?: string | null; gender?: VoiceGender | null; accent?: string | null; age?: VoiceAge | null; language?: string | null; use_case?: VoiceUseCase | null; tone?: VoiceTone | null }
export interface CustomVoice { voice_id: string; name: string | null; description: string | null; gender: VoiceGender | null; accent: string | null; age: VoiceAge | null; language: string | null; use_case: VoiceUseCase | null; tone: VoiceTone | null; created_at: string }
export interface ListCustomVoicesRequest { limit?: number; pagination_token?: string }
export interface ListCustomVoicesResponse { voices: CustomVoice[]; pagination_token: string | null }
export interface DeleteCustomVoiceResponse { deleted: true }
export interface CustomVoiceAudioResponse { bytes: Uint8Array; contentType: string }
export interface CustomVoicesClient { create(request: CreateCustomVoiceRequest, signal?: AbortSignal): Promise<CustomVoice>; list(request?: ListCustomVoicesRequest, signal?: AbortSignal): Promise<ListCustomVoicesResponse>; get(voiceId: string, signal?: AbortSignal): Promise<CustomVoice>; update(voiceId: string, request: UpdateCustomVoiceRequest, signal?: AbortSignal): Promise<CustomVoice>; delete(voiceId: string, signal?: AbortSignal): Promise<DeleteCustomVoiceResponse>; getAudio(voiceId: string, signal?: AbortSignal): Promise<CustomVoiceAudioResponse> }
export function createCustomVoicesClient(options?: VoiceClientOptions): CustomVoicesClient;
```

#### `src/voice/client-secrets.ts` (1)

```ts
export function mintClientSecret(opts?: { session?: unknown }): Promise<EphemeralClientSecret>;
```

### wp10 — Voice WebSocket, realtime, SIP

#### `src/voice/ws-client.ts` (19)

```ts
export { ephemeralProtocols } from "./protocol.js";
export const VOICE_WS_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
export const VOICE_WS_MAX_QUEUE_BYTES = 32 * 1024 * 1024;
export const VOICE_WS_OPEN_TIMEOUT_MS = 30_000;
export type VoiceWsAuth = { kind: "oauth" } | { kind: "ephemeral"; clientSecret: string };
export type VoiceWsFrame = { kind: "text"; text: string } | { kind: "binary"; bytes: Uint8Array } | { kind: "close"; code: number; reason: string };
export interface VoiceSocket { sendJson(value: unknown): void; sendBinary(bytes: Uint8Array): void; frames(): AsyncGenerator<VoiceWsFrame>; close(code?: number, reason?: string): void }
export interface VoiceWsDeps { dial?: typeof WebSocket; endpointOrigin?: string; clientVersion?: string }
export function openVoiceSocket(path: string, auth: VoiceWsAuth, signal: AbortSignal | undefined, deps: VoiceWsDeps): Promise<VoiceSocket>;
export type StreamingSttEncoding = "pcm" | "mulaw" | "alaw" | "opus";
export type StreamingSampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
export interface StreamingSttOptions { encoding?: StreamingSttEncoding; sample_rate?: StreamingSampleRate; interim_results?: boolean; endpointing?: number; language?: string; multichannel?: boolean; channels?: number; diarize?: boolean; keyterm?: string[]; filler_words?: boolean; smart_turn?: number; smart_turn_timeout?: number; vad_threshold?: number; signal?: AbortSignal }
export interface SttCompletion { kind: "completed" | "completed-with-transport-close"; finalText: string; finalEvent: "transcript.partial:speech_final" | "transcript.done"; closeCode?: number }
export interface StreamingSttSession { sendAudio(bytes: Uint8Array): void; finalize(channel?: number): void; finish(): void; events(): AsyncGenerator<SttServerEvent | SttCompletion>; close(): void }
export function reduceSttEvent(state: SttState, event: SttServerEvent): SttState;
export function createSttSession(options?: StreamingSttOptions, deps?: VoiceWsDeps): Promise<StreamingSttSession>;
export interface StreamingTtsOptions { voice?: string; language: string; codec?: "mp3" | "wav" | "pcm" | "mulaw" | "alaw"; sample_rate?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000; bit_rate?: 32000 | 64000 | 96000 | 128000 | 192000; optimize_streaming_latency?: 0 | 1; speed?: number; text_normalization?: boolean; with_timestamps?: boolean; signal?: AbortSignal }
export interface StreamingTtsSession { sendText(delta: string): void; finishUtterance(): void; events(): AsyncGenerator<TtsServerEvent>; close(): void }
export function createTtsSession(options: StreamingTtsOptions, deps?: VoiceWsDeps): Promise<StreamingTtsSession>;
```

`SttState`는 `reduceSttEvent`의 공개 시그니처에 나타나지만 wp10 문서에서는 non-export interface다.

#### `src/voice/realtime.ts` (15; 9개는 wp9 protocol의 re-export)

```ts
export { PINNED_REALTIME_MODEL, REALTIME_MODEL_ALIAS } from "./protocol.js";
export type { RealtimeClientEvent, RealtimeConversationItem, RealtimeNormalizedEvent, RealtimeReasoningEffort, RealtimeServerEvent, RealtimeSessionConfig, RealtimeVoiceModel } from "./protocol.js";
export interface RealtimeState { phase: "connecting" | "ready" | "responding" | "closed" | "failed"; conversationId?: string; responseId?: string; speechActive: boolean; lastDtmf?: string; errorCode?: string }
export function reduceRealtimeEvent(state: RealtimeState, event: RealtimeNormalizedEvent): RealtimeState;
export type RealtimeAuth = { kind: "oauth" } | { kind: "ephemeral"; clientSecret: string };
export interface RealtimeOptions { auth: RealtimeAuth; model?: RealtimeVoiceModel; reasoningEffort?: RealtimeReasoningEffort; callId?: string; conversationId?: string; signal?: AbortSignal; deps?: VoiceWsDeps }
export interface RealtimeClient { ready(): Promise<void>; updateSession(config: RealtimeSessionConfig): void; appendAudioBase64(audio: string): void; appendAudioBinary(audio: Uint8Array): void; commitAudio(): void; clearAudio(): void; createItem(item: RealtimeConversationItem, previousItemId?: string): void; forceMessage(text: string, interruptible?: boolean): void; deleteItem(itemId: string): void; truncateItem(itemId: string, contentIndex: number, audioEndMs: number): void; createResponse(response?: Extract<RealtimeClientEvent, {type:"response.create"}>["response"]): void; cancelResponse(responseId?: string): void; events(): AsyncGenerator<RealtimeNormalizedEvent>; close(): void }
export function createRealtimeClient(opts: RealtimeOptions): RealtimeClient;
```

#### `src/voice/sip.ts` (13)

```ts
export type SipAuthInput = { allowed_addresses: string[]; auth_username?: never; auth_password?: never } | { auth_username: string; auth_password: string; allowed_addresses?: never };
export interface SipWebhookInput { name?: string; url: string; auth_url?: string; auth_token?: string }
export type CreatePhoneNumberRequest = PhoneOrigin & SipDestination & { name: string; sip_auth?: SipAuthInput };
export interface RegisteredSipAuth { auth_username?: string; allowed_addresses?: string[] }
export interface PhoneNumberResource { phone_number_id: string; team_id: string; phone_number: string; name: string; agent_id?: string; webhook_id?: string; origin: "xai_provisioned" | "byo_trunk"; sip_host: string; inbound_trunk_id?: string; sip_auth?: RegisteredSipAuth; created_at: string; updated_at: string; agent_name?: string }
export interface PhoneWebhookSecret { webhook_id: string; dispatch_signing_secret: string }
export interface CreatePhoneNumberResponse { phone_number: PhoneNumberResource; webhook?: PhoneWebhookSecret }
export interface ReferCallRequest { target_uri: `tel:${string}` | `sip:${string}` }
export type ReferCallResponse = Record<string, never>;
export type HangupCallResponse = Record<string, never>;
export interface RealtimeCallIncomingWebhook { object: "event"; id: string; type: "realtime.call.incoming"; created_at: number; data: { call_id: string; sip_headers: Array<{ name: string; value: string }>; metadata: Record<string, unknown> } }
export interface SipClient { createPhoneNumber(request: CreatePhoneNumberRequest, signal?: AbortSignal): Promise<CreatePhoneNumberResponse>; refer(callId: string, request: ReferCallRequest, signal?: AbortSignal): Promise<ReferCallResponse>; hangup(callId: string, signal?: AbortSignal): Promise<HangupCallResponse> }
export function createSipClient(options?: VoiceClientOptions): SipClient;
```

### wp11 — REST surfaces와 Responses WebSocket

#### `src/surfaces/index.ts` (14)

```ts
export { BatchesClient } from "./batches.js";
export { CollectionsSearchClient } from "./collections.js";
export { EmbeddingsClient } from "./embeddings.js";
export { FilesClient } from "./files.js";
export { ImagesClient } from "./images.js";
export { MiscClient } from "./misc.js";
export { ModelsClient } from "./models.js";
export { SkillsClient } from "./skills.js";
export { VideosClient } from "./videos.js";
export { connectResponsesWebSocket, type ResponsesWsCreate, type ResponsesWsDeps, type ResponsesWsError, type ResponsesWsSession } from "./responses-ws.js";
```

#### `src/surfaces/client.ts` (9)

```ts
export type JsonObject = Record<string, unknown>;
export type Decoder<T> = (wire: unknown) => T;
export class XaiSurfaceError extends Error { constructor(status: number, code: string | undefined, message: string); readonly status: number; readonly code: string | undefined }
export function expectObject(value: unknown, label: string): JsonObject;
export function expectString(value: unknown, label: string): string;
export function requestJson<T>(transport: XaiTransport, path: string, init: RequestInit, decode: Decoder<T>): Promise<T>;
export function requestBytes(transport: XaiTransport, path: string, init?: RequestInit): Promise<{ bytes: Uint8Array; contentType: string | null }>;
export function requestVoid(transport: XaiTransport, path: string, init: RequestInit): Promise<void>;
export function jsonBody(value: unknown): Pick<RequestInit, "headers" | "body">;
```

#### `src/surfaces/registry.ts` (3)

```ts
export type SurfaceEvidence = "inventory" | "official-guide" | "openapi-only";
export interface SurfaceDescriptor { method: "GET" | "POST" | "PATCH" | "DELETE" | "WS" | "*"; path: string; family: string; transport: "json" | "multipart" | "binary" | "async" | "websocket" | "passthrough"; evidence: SurfaceEvidence }
export const SURFACE_REGISTRY = [/* wp11 owner 문서의 전체 literal registry */] as const satisfies readonly SurfaceDescriptor[];
```

#### `src/surfaces/responses-ws.ts` (5)

```ts
export type ResponsesWsCreate = Omit<ResponsesRequest, "stream" | "background"> & { type: "response.create"; generate?: boolean; previous_response_id?: string };
export interface ResponsesWsError { type: "error"; status?: number; error: { code?: string; message?: string; param?: string } }
export interface ResponsesWsSession { send(request: ResponsesWsCreate): Promise<void>; events(): AsyncIterable<AdapterEvent | ResponsesWsError>; close(code?: number, reason?: string): Promise<void> }
export interface ResponsesWsDeps { getBearer(): Promise<string>; createSocket(url: string, headers: Record<string, string>): WebSocket }
export function connectResponsesWebSocket(deps?: ResponsesWsDeps): Promise<ResponsesWsSession>;
```

#### `src/surfaces/batches.ts` (4)

```ts
export interface BatchInfo { batch_id: string; name: string; state: Record<string, unknown>; raw: Record<string, unknown> }
export interface PageOptions { limit?: number; paginationToken?: string }
export interface BatchRequest { batch_request_id: string; batch_request: Record<string, unknown> }
export class BatchesClient { constructor(transport: XaiTransport); create(name: string): Promise<BatchInfo>; get(batchId: string): Promise<BatchInfo>; list(options?: PageOptions): Promise<unknown>; listRequests(batchId: string, options?: PageOptions): Promise<unknown>; addRequests(batchId: string, requests: readonly BatchRequest[]): Promise<void>; results(batchId: string, options?: PageOptions): Promise<unknown>; cancel(batchId: string): Promise<BatchInfo> }
```

#### `src/surfaces/files.ts` (3)

```ts
export interface XaiFile { id: string; filename: string; bytes: number; created_at: number; expires_at?: number | null; public_url?: string | null; raw: Record<string, unknown> }
export interface UploadFileInput { file: Blob; filename: string; purpose?: string; expiresAfterSeconds?: number }
export class FilesClient { constructor(transport: XaiTransport); upload(input: UploadFileInput): Promise<XaiFile>; list(options?: { limit?: number; paginationToken?: string }): Promise<unknown>; get(fileId: string): Promise<XaiFile>; delete(fileId: string): Promise<{ id: string; deleted: boolean }>; download(fileId: string): Promise<{ bytes: Uint8Array; contentType: string | null }>; createPublicUrl(fileId: string, expiresAfter?: number): Promise<{ public_url: string; expires_at?: number | null }>; revokePublicUrl(fileId: string): Promise<{ id: string; revoked: boolean }> }
```

#### `src/surfaces/collections.ts` (2)

```ts
export interface DocumentsSearchRequest { query: string; source: Record<string, unknown>; limit?: number; filter?: string; instructions?: string; retrieval_mode?: unknown; group_by?: unknown }
export class CollectionsSearchClient { constructor(transport: XaiTransport); search(request: DocumentsSearchRequest): Promise<{ matches: unknown[] }> }
```

#### `src/surfaces/embeddings.ts` (3)

```ts
export interface EmbeddingRequest { model: string; input: string | string[] | number[] | number[][]; dimensions?: number; encoding_format?: "float" | "base64"; user?: string }
export interface EmbeddingResponse { object: string; model: string; data: unknown[]; usage?: unknown }
export class EmbeddingsClient { constructor(transport: XaiTransport); create(request: EmbeddingRequest): Promise<EmbeddingResponse>; listModels(): Promise<unknown>; getModel(modelId: string): Promise<unknown> }
```

#### `src/surfaces/skills.ts` (3)

```ts
export interface XaiSkill { id: string; name: string; description: string; default_version: string; latest_version: string; created_at: number; raw: Record<string, unknown> }
export interface SkillUploadFile { path: string; data: Blob }
export class SkillsClient { constructor(transport: XaiTransport); list(): Promise<unknown>; upload(files: readonly SkillUploadFile[]): Promise<XaiSkill>; get(skillId: string): Promise<XaiSkill>; delete(skillId: string): Promise<{ id: string; deleted: boolean }>; downloadContent(skillId: string): Promise<{ bytes: Uint8Array; contentType: string | null }> }
```

#### `src/surfaces/models.ts` (3)

```ts
export type ModelFamily = "models" | "language-models" | "image-generation-models" | "video-generation-models" | "embedding-models";
export interface XaiModel { id: string; aliases: string[]; raw: Record<string, unknown> }
export class ModelsClient { constructor(transport: XaiTransport); list(family?: ModelFamily): Promise<XaiModel[]>; get(family: ModelFamily, modelId: string): Promise<XaiModel> }
```

#### `src/surfaces/misc.ts` (2)

```ts
export interface MeResponse { user_id: string; team_id: string; zdr_status: string; team_blocked: boolean; oauth?: unknown; api_key?: unknown }
export class MiscClient { constructor(transport: XaiTransport); tokenize(input: { model: string; text: string; user?: string }): Promise<unknown[]>; me(): Promise<MeResponse> }
```

#### `src/surfaces/images.ts` (3)

```ts
export interface ImageRequest { model: string; prompt: string; n?: number; response_format?: "url" | "b64_json"; aspect_ratio?: string; resolution?: string; image?: unknown; images?: unknown[] }
export interface ImageResponse { data: unknown[]; usage?: unknown }
export class ImagesClient { constructor(transport: XaiTransport); create(request: ImageRequest): Promise<ImageResponse> }
```

#### `src/surfaces/videos.ts` (4)

```ts
export type VideoOperation = "generations" | "edits" | "extensions";
export interface VideoStartResponse { requestId: string }
export interface VideoPollResponse { status: "pending" | "done" | "failed" | "expired"; progress?: number; video?: { url: string; duration?: number }; error?: unknown; raw: Record<string, unknown> }
export class VideosClient { constructor(transport: XaiTransport); start(operation: VideoOperation, request: Record<string, unknown>): Promise<VideoStartResponse>; poll(requestId: string): Promise<VideoPollResponse> }
```

### wp12 — CLI surface

#### `src/commands/command-manifest.ts` (5)

```ts
export const COMMAND_NAMES: readonly ["login", "logout", "proxy", "chat", "models", "status", "skill", "capabilities", "search", "video", "image", "billing", "tts", "stt", "live"];
export type CommandName = (typeof COMMAND_NAMES)[number];
export const DEFAULT_LIVE_MODEL = "grok-voice-think-fast-2.0";
export interface CommandManifestEntry { name: CommandName; summary: string; mutatesRemote: boolean; json: boolean }
export const COMMAND_MANIFEST: CommandManifestEntry[];
```

#### `src/commands/command-registry.ts` (5)

```ts
export type CommandFactory = () => Command;
export const COMMAND_FACTORIES: Record<CommandName, CommandFactory>;
export const REAL_COMMANDS: Set<CommandName>;
export function isCommandName(value: string): value is CommandName;
export function createRegisteredCommands(): Command[];
```

#### `src/commands/tts.ts` (2)

```ts
export interface TtsCliOptions { voice?: string; language?: string; format?: "mp3" | "wav" | "pcm" | "mulaw" | "alaw"; output?: string; stdout?: boolean; json?: boolean }
export function ttsCommand(): Command;
```

#### `src/commands/stt.ts` (2)

```ts
export interface SttCliOptions { language?: string; diarize?: boolean; multichannel?: boolean; keyterm?: string[]; json?: boolean }
export function sttCommand(): Command;
```

#### `src/commands/live.ts` (2)

```ts
export interface LiveCliOptions { model?: RealtimeVoiceModel; conversationId?: string; reasoning?: RealtimeReasoningEffort; event?: string[]; stdin?: boolean; once?: boolean }
export function liveCommand(): Command;
```

#### `src/commands/capabilities.ts` (4)

```ts
export interface CatalogSnapshot { status: "live" | "partial" | "offline" | "unavailable"; fetchedAt: string | null; families: Partial<Record<ModelFamily, XaiModel[]>>; errors: Partial<Record<ModelFamily, string>> }
export function loadCatalogSnapshot(options?: { offline?: boolean; client?: ModelsClient }): Promise<CatalogSnapshot>;
export async function buildCapabilities(options: { offline?: boolean; client?: ModelsClient } = {}) { /* 반환형은 owner 본문에서 추론 */ }
export function capabilitiesCommand(): Command;
```

`COMMAND_MANIFEST`의 owner 경로는 `src/commands/command-manifest.ts`다. `src/cli`가 아니다.

### wp13 — 로컬 웹앱

#### `src/commands/chat.ts` (1)

```ts
export function chatCommand(): Command;
```

#### `src/web/server.ts` (4)

```ts
export interface WebAppOptions { publicDir?: string }
export function applyWebSecurityHeaders(req: Request, res: Response, next: NextFunction): void;
export function createWebApp(options?: WebAppOptions): express.Application;
export function startWebApp(port?: number, host?: string): Promise<void>;
```

#### `src/web/client/contracts.ts` (9)

```ts
export type TurnStatus = "composing" | "queued" | "streaming" | "complete" | "stopped" | "failed";
export interface ModelRecord { id: string; object?: string; owned_by?: string }
export interface ToolView { id: string; type: string; name?: string; status: "queued" | "running" | "complete" | "failed"; argumentsText: string; outputText?: string; citations: Array<{ title: string; url: string }> }
export interface ChatMessage { id: string; role: "user" | "assistant"; text: string; reasoningSummary: string; tools: ToolView[]; status: TurnStatus }
export interface ChatSession { id: string; model: string; title: string; createdAt: number; messages: ChatMessage[] }
export type VoiceMode = "stt" | "realtime";
export type VoiceStatus = "idle" | "requesting-permission" | "minting-secret" | "connecting" | "listening" | "speaking" | "stopped" | "failed";
export interface ImageResult { url: string; revisedPrompt?: string }
export interface VideoJob { requestId: string; status: "pending" | "done" | "failed" | "expired"; progress?: number; videoUrl?: string; error?: string }
```

#### `src/web/client/api.ts` (7)

```ts
export function listModels(signal?: AbortSignal): Promise<ModelRecord[]>;
export function decodeSse(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown>;
export function streamResponses(request: ResponsesRequest, signal: AbortSignal): AsyncGenerator<unknown>;
export function mintClientSecret(signal?: AbortSignal): Promise<EphemeralClientSecret>;
export function generateImages(input: { model: string; prompt: string; count: number }, signal?: AbortSignal): Promise<ImageResult[]>;
export function submitVideo(input: { model: string; prompt: string; duration: number; aspectRatio: string; resolution: string }, signal?: AbortSignal): Promise<string>;
export function readVideoJob(requestId: string, signal?: AbortSignal): Promise<VideoJob>;
```

#### `src/web/client/response-state.ts` (2)

```ts
export type ReduceResult = "continue" | "complete" | "failed";
export function reduceResponseEvent(message: ChatMessage, wire: unknown): ReduceResult;
```

#### `src/web/client/render.ts` (4)

```ts
export function clear(node: Element): void;
export function renderSafeText(container: HTMLElement, text: string): void;
export function renderMessage(message: ChatMessage): HTMLElement;
export function activateTabs(tabList: HTMLElement): void;
```

#### `src/web/client/chat.ts` (2)

```ts
export interface ChatElements { model: HTMLSelectElement; sessions: HTMLElement; messages: HTMLElement; form: HTMLFormElement; input: HTMLTextAreaElement; send: HTMLButtonElement; stop: HTMLButtonElement; newSession: HTMLButtonElement; status: HTMLElement }
export class ChatController { constructor(el: ChatElements); init(models: ModelRecord[]): Promise<void>; stop(): void }
```

#### `src/web/client/voice.ts` (4)

```ts
export interface VoiceSocketSpec { url: string; protocols: string[] }
export interface VoiceElements { mode: HTMLSelectElement; model: HTMLInputElement; voice: HTMLSelectElement; start: HTMLButtonElement; finish: HTMLButtonElement; stop: HTMLButtonElement; status: HTMLElement; userTranscript: HTMLElement; assistantTranscript: HTMLElement }
export function buildVoiceSocketSpec(mode: VoiceMode, secret: EphemeralClientSecret, options: { model: string; conversationId?: string }): VoiceSocketSpec;
export class VoiceController { constructor(el: VoiceElements); init(): void; start(): Promise<void>; stop(drainStt?: boolean): Promise<void>; finalizeUtterance(): void }
```

#### `src/web/client/media.ts` (2)

```ts
export interface MediaElements { kind: HTMLSelectElement; model: HTMLSelectElement; prompt: HTMLTextAreaElement; form: HTMLFormElement; submit: HTMLButtonElement; progress: HTMLProgressElement; status: HTMLElement; results: HTMLElement }
export class MediaController { constructor(el: MediaElements, models: ModelRecord[]); init(): void }
```

`tsup.web.config.ts`의 default export는 named-export 원장에 포함하지 않는다. `src/web/client/pcm-worklet.ts`와 `app.ts`는 named export가 없다.

### wp14 — 검증 helper

#### `tests/helpers/fake-xai.ts` (4)

```ts
export interface RecordedRequest { method: string; pathname: string; search: string; headers: http.IncomingHttpHeaders; body: Buffer }
export interface FakeReply { status?: number; headers?: Record<string, string>; chunks?: Array<string | Uint8Array> }
export interface FakeXaiServer { baseUrl: string; requests: RecordedRequest[]; close(): Promise<void> }
export function startFakeXai(reply: (request: RecordedRequest) => FakeReply | Promise<FakeReply>): Promise<FakeXaiServer>;
```

#### `tests/helpers/async-stream.ts` (2)

```ts
export function byteStream(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array>;
export function collect<T>(source: AsyncIterable<T>): Promise<T[]>;
```

wp15와 wp16은 문서·릴리스 metadata만 소유하며 named export를 선언하지 않는다.

## 3. 소비 관계표

표는 단계 간 계약 import를 적는다. 같은 단계 안의 private wiring은 owner 모듈 절에서 이미 드러나므로, 아래에는 다른 단계가 의존하는 이름과 public boundary re-export를 중심으로 적는다. 소비 문서의 잘못된 이름과 호출 형태는 owner 계약으로 정규화했다.

| 소비 단계 | import 원본 | 소비 이름 | 판정 |
|---|---|---|---|
| wp6 | `src/auth/token-manager.ts` | `withBearer401Replay` | `xaiFetch`의 401 one-shot wrapper |
| wp7 | `src/core/errors.ts` | `AdapterErrorDetail` | `AdapterTerminalEvent`의 error arm |
| wp7 | `src/core/events.ts` | `AdapterEvent`, `AdapterUsage` | 두 reducer와 tool-call assembler의 canonical 출력 |
| wp7 | `src/wire/sse.ts` | `decodeServerSentEvents`, `SseDecodeError`, `DecodeSseOptions` | reducer 내부에서 byte stream을 decode |
| wp7 | `src/wire/tool-calls.ts` | `ToolCallAssembler`, `ToolCallWireError`, `ToolCallAssemblerOptions` | Chat/Responses tool delta 조립 |
| wp8 | `src/auth/token-manager.ts` | `getValidBearerSnapshot` | proxy 기본 bearer provider |
| wp8 | `src/transport/fetch.ts` | `executeXaiFetch`, `XaiFetchInput` | proxy의 exact upstream seam과 테스트 타입 |
| wp8 | `src/core/events.ts` | `AdapterEvent`, `isTerminalEvent` | renderer 입력과 terminal assertion |
| wp8 | `src/wire/chat-stream.ts` | `reduceChatStream` | `upstream.body` byte stream을 직접 전달 |
| wp8 | `src/wire/responses-stream.ts` | `reduceResponsesStream` | `upstream.body` byte stream을 직접 전달 |
| wp8 | `src/proxy/body.ts` | `readBoundedBody`, `PayloadTooLargeError` | ingress body와 413 mapping |
| wp8 | `src/proxy/composer-inject.ts` | `prepareGrokRequestObject` | parsed JSON transform |
| wp8 | `src/proxy/native-stream.ts` | `serveNativeStream` | native Chat/Responses orchestration |
| wp8 | `src/proxy/route-policy.ts` | `decideProxyRoute` | native/json/opaque route 선택 |
| wp8 | `src/proxy/relay.ts` | `filterRequestHeaders`, `relayUpstreamResponse`, `copyUpstreamHeaders` | request/response relay와 native response header |
| wp8 | `src/proxy/render-chat.ts` | `renderChatEvents` | Chat SSE renderer |
| wp8 | `src/proxy/render-responses.ts` | `renderResponsesEvents` | Responses SSE renderer |
| wp9 | `src/transport/fetch.ts` | `createXaiTransport`, `XaiTransport` | Voice REST의 기본 transport와 주입 타입 |
| wp9 | `src/voice/http.ts` | `createVoiceHttpClient`, `VoiceClientOptions`, `VoiceHttpError`, `expectRecord`, `expectString`, `jsonBody` | TTS/STT/custom voices/client secret 공통 HTTP 경계 |
| wp9 | `src/voice/protocol.ts` | `EphemeralClientSecret` | `client-secrets.ts` 반환 계약 |
| wp10 | `src/auth/token-manager.ts` | `getValidBearerSnapshot` | OAuth WebSocket handshake와 401 redial |
| wp10 | `src/transport/headers.ts` | `buildUpstreamHeaders` | OAuth WebSocket header 조립 |
| wp10 | `src/voice/protocol.ts` | `XAI_VOICE_WS_ORIGIN`, `PINNED_REALTIME_MODEL`, `REALTIME_MODEL_ALIAS`, `ephemeralProtocols`, `parseSttServerEvent`, `parseTtsServerEvent`, `parseRealtimeServerEvent`, `VoiceProtocolError`, `StreamingSttWord`, `SttClientControl`, `SttServerEvent`, `TtsClientEvent`, `StreamingAudioTimestamps`, `TtsServerEvent`, `RealtimeClientEvent`, `RealtimeConversationItem`, `RealtimeNormalizedEvent`, `RealtimeReasoningEffort`, `RealtimeServerEvent`, `RealtimeSessionConfig`, `RealtimeVoiceModel` | protocol owner의 전체 WS 의존 집합 |
| wp10 | `src/voice/http.ts` | `createVoiceHttpClient`, `VoiceClientOptions`, `expectRecord`, `expectString`, `jsonBody` | SIP REST client |
| wp10 | `src/voice/ws-client.ts` | `openVoiceSocket`, `VoiceSocket`, `VoiceWsAuth`, `VoiceWsDeps` | realtime client transport seam |
| wp11 | `src/auth/token-store.ts` | `getValidBearer` | Responses WebSocket bearer |
| wp11 | `src/transport/fetch.ts` | `XaiTransport` | 모든 REST surface constructor와 공통 client |
| wp11 | `src/core/types.ts` | `ResponsesRequest` | `ResponsesWsCreate`의 HTTP DTO 재사용 |
| wp11 | `src/core/events.ts` | `AdapterEvent` | Responses WS event iterator |
| wp11 | `src/wire/responses-stream.ts` | `reduceResponsesStream` | synthetic SSE **byte stream**을 직접 전달; 선행 decoder 호출 없음 |
| wp12 | `src/transport/fetch.ts` | `XaiTransport`, `createXaiTransport` | CLI clients와 live catalog |
| wp12 | `src/voice/tts.ts` | `createTtsClient`, `TtsRequest`, `TtsResult` | `tts` command |
| wp12 | `src/voice/stt.ts` | `createSttClient`, `SttRequest`, `SttResult` | `stt` command |
| wp12 | `src/voice/realtime.ts` | `createRealtimeClient`, `RealtimeClient`, `RealtimeOptions` | `live` command |
| wp12 | `src/voice/protocol.ts` | `RealtimeClientEvent`, `RealtimeReasoningEffort`, `RealtimeVoiceModel` | NDJSON parse/dispatch와 options |
| wp12 | `src/surfaces/registry.ts` | `SURFACE_REGISTRY`, `SurfaceDescriptor` | capabilities endpoint SSOT |
| wp12 | `src/surfaces/index.ts` | `ModelsClient`, `ImagesClient`, `VideosClient` | models/image/video command와 capabilities |
| wp12 | `src/commands/command-manifest.ts` | `COMMAND_MANIFEST`, `COMMAND_NAMES`, `CommandName`, `DEFAULT_LIVE_MODEL` | registry, capabilities, live default |
| wp12 | `src/commands/command-registry.ts` | `createRegisteredCommands`, `isCommandName`, `COMMAND_FACTORIES` | root CLI 등록과 parity test |
| wp13 | `src/proxy/server.ts` | `createProxyApp` | same-origin `/v1/*`와 정적 앱 결합 |
| wp13 | `src/core/types.ts` | `ResponsesRequest` | browser text request |
| wp13 | `src/voice/protocol.ts` | `XAI_VOICE_WS_ORIGIN`, `EphemeralClientSecret`, `ephemeralProtocols`, `STT_EVENTS`, `parseSttServerEvent`, `parseRealtimeServerEvent`, `RealtimeClientEvent`, `RealtimeServerEvent`, `SttClientControl`, `SttServerEvent` | browser Voice는 owner 상수·decoder를 직접 사용해야 함; 로컬 `XAI_WS_BASE`와 generic cast parser는 이 계약으로 교체 대상 |
| wp13 | `src/web/server.ts` | `startWebApp`, `createWebApp` | `chat` command와 webapp test |
| wp13 | `src/web/client/api.ts` | `listModels`, `streamResponses`, `mintClientSecret`, `generateImages`, `submitVideo`, `readVideoJob` | browser controllers |
| wp13 | `src/web/client/contracts.ts` | `ChatMessage`, `ChatSession`, `ModelRecord`, `TurnStatus`, `ToolView`, `VoiceMode`, `VoiceStatus`, `ImageResult`, `VideoJob` | browser state/render/controller modules |
| wp13 | `src/web/client/response-state.ts` | `reduceResponseEvent` | Chat stream state |
| wp13 | `src/web/client/render.ts` | `renderMessage`, `activateTabs` | Chat/app UI |
| wp14 | `src/auth/token-manager.ts` | `createTokenManager`, `getValidBearerSnapshot`, `withBearer401Replay` | auth refresh/401 verification |
| wp14 | `src/transport/base-url.ts` | `resolveUpstreamUrl` | public URL routing verification |
| wp14 | `src/transport/retry.ts` | `classifyReplay` | replay classification verification |
| wp14 | `src/transport/fetch.ts` | `executeXaiFetch`, `xaiFetch` | transport execution verification |
| wp14 | `src/wire/sse.ts` | `decodeServerSentEvents` | `wire-sse.test.ts`만 직접 검증 |
| wp14 | `src/wire/chat-stream.ts` | `reduceChatStream` | `byteStream(...)`을 직접 전달; decoder 결과를 넘기지 않음 |
| wp14 | `src/wire/responses-stream.ts` | `reduceResponsesStream` | `byteStream(...)`을 직접 전달; decoder 결과를 넘기지 않음 |
| wp14 | `src/voice/tts.ts` | `createTtsClient` | Voice REST와 live smoke |
| wp14 | `src/voice/stt.ts` | `createSttClient` | Voice REST와 live smoke |
| wp14 | `src/voice/ws-client.ts` | `createSttSession`, `createTtsSession` | WS session verification |
| wp14 | `src/voice/realtime.ts` | `createRealtimeClient`, `reduceRealtimeEvent`, `PINNED_REALTIME_MODEL` | realtime reducer/client verification |
| wp14 | `src/voice/protocol.ts` | `STT_EVENTS` | protocol event oracle |
| wp14 | `src/voice/client-secrets.ts` | `mintClientSecret` | live ephemeral-secret smoke |
| wp14 | `src/surfaces/index.ts` | `BatchesClient`, `CollectionsSearchClient`, `EmbeddingsClient`, `FilesClient`, `ImagesClient`, `MiscClient`, `ModelsClient`, `SkillsClient`, `VideosClient`, `connectResponsesWebSocket`, `ResponsesWsCreate`, `ResponsesWsDeps`, `ResponsesWsError`, `ResponsesWsSession` | public boundary parity |
| wp14 | `src/surfaces/registry.ts` | `SURFACE_REGISTRY` | registry/capabilities parity |
| wp14 | `src/proxy/server.ts` | `createProxyApp`, `ProxyAppDependencies` | fake upstream integration |
| wp14 | `src/web/server.ts` | `createWebApp` | server/security contract |
| wp14 | `src/web/client/api.ts` | `decodeSse` | browser stream helper verification |
| wp14 | `src/web/client/contracts.ts` | `ChatMessage` | response-state fixture type |
| wp14 | `src/web/client/response-state.ts` | `reduceResponseEvent` | browser event reducer verification |
| wp14 | `src/web/client/voice.ts` | `buildVoiceSocketSpec` | browser direct socket contract |
| wp14 | `src/commands/capabilities.ts` | `buildCapabilities` | schema v2 verification |
| wp14 | `src/commands/command-manifest.ts` | `COMMAND_MANIFEST` | commands parity |
| wp14 | `tests/helpers/async-stream.ts` | `byteStream`, `collect` | wire test fixtures |
| wp14 | `tests/helpers/fake-xai.ts` | `startFakeXai`, `RecordedRequest`, `FakeReply`, `FakeXaiServer` | local transport/proxy oracle |

wp15와 wp16은 이 모듈들을 코드로 import하지 않는다. wp15는 `COMMAND_MANIFEST`와 `SURFACE_REGISTRY`가 각각 capabilities의 commands/endpoints SSOT라는 공개 문서 사실을 동기화하고, wp16은 같은 두 이름을 changelog에 기록한다.

## 4. 미결

소유 문서끼리 양립할 수 없게 충돌한 항목은 **0개**다.

- wp6의 `ProxyAppDeps`는 wp8이 `src/proxy/server.ts`를 명시적으로 다시 MODIFY하면서 `ProxyAppDependencies`로 교체했으므로 owner-owner 미결이 아니다.
- wp6의 `src/transport/base-url.ts`는 wp10이 versioned path 지원과 `XAI_PUBLIC_API_ORIGIN`을 추가한 후속 MODIFY이므로 최종 계약을 합성할 수 있다.
- wp7과 wp14의 reducer 입력 차이는 owner-owner 충돌이 아니다. wp7만 wire API owner이며 wp14는 잘못 쓴 소비 문서이므로 §1과 §3처럼 byte-stream 호출로 정규화한다.
- `reduceSttEvent()`의 `SttState`, `createTokenManager()`의 `TokenManager`, `token-store.ts`의 `SaveTokenInput`처럼 public signature에 나타나지만 owner 문서가 named export로 선언하지 않은 타입은 이 원장에서 새 export로 창작하지 않았다. 구현 단계에서 declaration emit이 요구되면 각 소유 단계가 별도로 export 여부를 결정해야 한다.

## 5. 추출 집계

- named export가 선언된 모듈: **63개**
- 모듈별 named export 합계: **360개**
- 소유 문서 간 미결 충돌: **0개**
