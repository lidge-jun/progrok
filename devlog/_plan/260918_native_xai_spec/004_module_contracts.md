# 단계 간 모듈 계약 (SSOT)

감사가 네 번 돌았고 매번 **다른 자리**에서 이름이 어긋났다. `executeXaiFetch` 대 `xaiFetch`,
`decodeSse` 대 `decodeServerSentEvents`, `classifyRetry` 대 `classifyReplay`, `ClientSecretResponse` 대 `EphemeralClientSecret`.

원인은 개별 실수가 아니다. 12개 단계 문서를 병렬로 쓰면서 각 문서가 이웃 단계의 공개 API 이름을 **스스로 지어냈다**.
한 라운드가 한 쌍을 맞추면 다음 감사가 다른 쌍을 찾아냈다. 이름을 한 곳에 고정하지 않는 한 끝나지 않는다.

이 문서가 그 한 곳이다. **단계 문서가 이 문서와 다르면 단계 문서가 틀린 것이다.**
새 cross-module export가 필요하면 먼저 여기에 추가하고 단계 문서가 그것을 참조한다.

## src/auth (wp5)

```ts
// src/auth/token-manager.ts
export interface TokenManagerDependencies { /* wp5 문서 참조 */ }
export function createTokenManager(deps?: TokenManagerDependencies): TokenManager;
export function getValidBearerSnapshot(opts?: { forceRefresh?: boolean; rejectedAccessToken?: string; signal?: AbortSignal }): Promise<BearerSnapshot>;
export function withBearer401Replay<T>(run: (bearer: string) => Promise<T>): Promise<T>;
export interface BearerSnapshot { bearer: string; expiresAt: number; generation: number }
```

기존 `src/auth/token-store.ts`의 파일 스키마와 경로(`~/.progrok/auth.json`)는 바뀌지 않는다.

## src/transport (wp6)

```ts
// src/transport/base-url.ts
export type PublicApiAuthKind = "oauth" | "api-key";
export type UpstreamAuthKind = PublicApiAuthKind | "deployment-key";
export function resolveUpstreamBase(kind: PublicApiAuthKind): string;
export function resolveUpstreamUrl(path: string, kind: PublicApiAuthKind): string;

// src/transport/retry.ts
export type ReplayClass = "replayable" | "not-replayable";
export function classifyReplay(method: string, headers: Headers): ReplayClass;

// src/transport/fetch.ts
export interface XaiFetchInput { pathWithQuery: string; method: string; headers: Headers; body?: BodyInit | null; signal?: AbortSignal }

/** 하위 seam. 호출자가 이미 bearer를 들고 있을 때 쓴다. wp8 프록시가 이 경로를 쓴다. */
export function executeXaiFetch(input: XaiFetchInput, deps: { bearer: string; fetchImpl?: typeof fetch }): Promise<Response>;

/** 상위 API. bearer를 스스로 해석하고 401 replay까지 처리한 뒤 executeXaiFetch를 호출한다. */
export function xaiFetch(input: XaiFetchInput, deps?: { fetchImpl?: typeof fetch }): Promise<Response>;

export interface XaiTransport { fetch(input: XaiFetchInput): Promise<Response> }
export function createXaiTransport(opts?: { fetchImpl?: typeof fetch }): XaiTransport;
```

4차 감사가 잡은 wp8↔wp6 충돌을 이렇게 푼다. wp8은 이미 취득한 bearer를 넘기고 싶어 했고 `xaiFetch`는 내부에서 다시 취득했다.
두 요구가 모두 옳으므로 계층을 둘로 나눈다. `xaiFetch`가 `executeXaiFetch`를 감싼다.

`deployment-key`는 `resolveUpstreamBase`에 넘기지 않는다. 호출 전에 분기해 전용 클라이언트로 보낸다.
cli-chat-proxy 역시 명시적 opt-in 전용 클라이언트다.

## src/core, src/wire (wp7)

```ts
// src/core/types.ts — canonical DTO. 다른 단계는 재선언하지 않고 import한다.
export interface ResponsesRequest { /* wp7 문서 참조 */ }

// src/core/errors.ts
export class XaiError extends Error { status?: number; code?: string; retryable?: boolean }

// src/core/events.ts
export type AdapterEvent = /* discriminated union, wp7 문서 참조 */;

// src/wire/sse.ts
export function decodeServerSentEvents(stream: ReadableStream<Uint8Array>): AsyncIterable<SseFrame>;

// src/wire/chat-stream.ts
export function reduceChatStream(frames: AsyncIterable<SseFrame>): AsyncIterable<AdapterEvent>;

// src/wire/responses-stream.ts
export function reduceResponsesStream(frames: AsyncIterable<SseFrame>): AsyncIterable<AdapterEvent>;
```

`decodeSse`, `reduceChatChunk`, `reduceResponseEvent`라는 이름은 존재하지 않는다.

## src/proxy (wp8)

```ts
export interface ProxyAppDependencies { getBearer(): Promise<string>; fetchUpstream: typeof executeXaiFetch }
export function createProxyApp(deps?: Partial<ProxyAppDependencies>): express.Express;
```

## src/voice (wp9이 protocol과 REST, wp10이 WS)

```ts
// src/voice/protocol.ts — wp9 소유. Node 의존 없음. 브라우저에서 import 가능.
export const ephemeralProtocols: (secret: string) => string[];
export interface EphemeralClientSecret { value: string; expires_at: number }
export type RealtimeVoiceModel = string;
export type RealtimeReasoningEffort = "low" | "medium" | "high";
export const STT_EVENTS: { created: "transcript.created"; partial: "transcript.partial"; done: "transcript.done"; error: "error" };
// realtime/tts 이벤트 상수와 타입도 여기에 둔다.

// src/voice/tts.ts (wp9)
export function createTtsClient(deps?: { transport?: XaiTransport }): { synthesize(req: TtsRequest): Promise<TtsResult> };
export type TtsResult = { kind: "audio"; bytes: Uint8Array; contentType: string; duration?: number } | { kind: "json"; body: unknown };

// src/voice/stt.ts (wp9)
export function createSttClient(deps?: { transport?: XaiTransport }): { transcribe(req: SttRequest): Promise<SttResult> };

// src/voice/client-secrets.ts (wp9)
export function mintClientSecret(opts?: { session?: unknown }): Promise<EphemeralClientSecret>;

// src/voice/realtime.ts (wp10)
export function createRealtimeClient(opts: RealtimeOptions): RealtimeClient;
```

`TtsRequest`에 `model` 필드는 없다. ephemeral secret은 연결 1회용이므로 `mintClientSecret`은 연결마다 호출한다(D10).

## src/surfaces (wp11)

`src/surfaces/index.ts`가 단일 public boundary다. 9개 REST 클라이언트와 `connectResponsesWebSocket`,
그리고 `ResponsesWsCreate`, `ResponsesWsDeps`, `ResponsesWsError`, `ResponsesWsSession` 타입을 export한다.
정확한 목록은 wp11 문서의 public boundary 절이 가지며, wp14의 import 목록은 그것과 문자 단위로 일치해야 한다.

Responses compact/input-items 값 검사는 registry 테스트가, unknown passthrough는 proxy 테스트가 맡는다.
public 클라이언트가 없는 경로를 surfaces 테스트에서 호출하지 않는다.

## src/cli (wp12)

```ts
export const COMMAND_MANIFEST: CommandManifestEntry[];
export const SURFACE_REGISTRY: SurfaceRegistryEntry[];
```

`capabilities --json`은 schema v2다. `commands`가 객체 배열이며 legacy shim은 없다. 릴리스는 3.0.0이다(D6).
