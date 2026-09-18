# WP6 전송 코어 구현 PRD

## 1. 목표

이 단계는 현재 `src/proxy/server.ts`에 섞여 있는 URL 조립, 헤더 필터링, bearer 주입, raw fetch, 오류 처리를 `src/transport/`의 네 소유자로 분리한다. `/health` 응답과 일반 `/v1/*` 포워딩 계약은 유지하되 D2에 따라 `/deployment/config`는 별도 credential client로 분리하고 `/feedback*` 자동 포워딩은 거부한다.

완료 후 전송 코어는 다음을 보장한다.

- OAuth와 API-key의 모든 기본 경로는 `api.x.ai`로 고정한다. `cli-chat-proxy.grok.com`은 명시적 opt-in 전용 클라이언트에서만 접근한다.
- OAuth 요청에는 `Authorization`과 `X-XAI-Token-Auth: xai-grok-cli`를 조립하고, 추적 헤더를 typed 입력에서만 만든다.
- caller abort가 DNS/연결/헤더 대기/backoff에 전파된다.
- header timeout은 응답 헤더가 도착할 때까지만 적용되고 장시간 stream을 임의로 끊지 않는다.
- 네트워크 재시도는 fetch가 Response를 만들기 전에 실패한 경우만 가능하다. body 읽기 시작 뒤 오류는 절대 재시도하지 않는다.
- 429/5xx는 replay-safe 정책이 명시된 요청만 재시도한다. 임의 POST와 미디어 생성 시작은 재시도하지 않는다.
- OAuth 401은 WP5의 세대 안전 refresh를 거쳐 정확히 한 번만 replay한다.

## 2. 현재 근거와 판정 원칙

`001_endpoint_inventory.md:143-166`의 2026-09-18 라이브 판정과 `000_plan.md` D2가 이 단계의 base URL 권위다. 같은 OAuth token으로 `api.x.ai`의 추론·Voice·계정 경로가 동작했고, `cli-chat-proxy.grok.com`은 별도 버전 게이트와 다른 모델 카탈로그를 가진 Grok CLI 전용 레인으로 확인됐다. `001_endpoint_inventory.md:21-33`은 OAuth 보조 인증 헤더와 `x-grok-*` 추적 헤더를 기록한다.

현재 코드는 `src/proxy/server.ts:88-99`에서 모든 경로를 `XAI_API_BASE_URL`에 붙이고 bearer만 넣는다. `src/commands/billing.ts:5-6`만 세션 host를 별도 상수로 하드코딩한다. 따라서 base URL과 header 정책의 SSOT가 없다.

확정 판정은 다음과 같다.

1. OAuth와 API-key 요청은 경로와 무관하게 `https://api.x.ai/v1`만 기본값으로 사용한다. `/billing`과 `/user`도 예외가 아니다.
2. `cli-chat-proxy.grok.com`은 path resolver의 결과가 될 수 없다. 호출자가 명시적으로 opt-in한 전용 클라이언트만 이 host를 사용할 수 있다.
3. `/deployment/config`는 OAuth가 아니라 별도 credential 종류인 `deployment-key`를 사용한다. 값의 원천은 `GROK_DEPLOYMENT_KEY`이며, 다른 경로에 재사용하지 않는다.
4. `/feedback*`는 근거 URL이 확정되지 않았으므로 자동 resolver가 거부한다. public/session 어느 쪽으로도 추측해 보내지 않는다.
5. host 간 자동 fallback이나 retry는 두 레인의 모델·게이트 차이와 중복 과금 위험 때문에 금지한다.

참고 구현의 근거점은 ima2-gen `lib/grokRuntime.ts:20-35`의 URL·auth header 단일 조립, `lib/grokRuntime.ts:75-93`의 401 one-shot nesting, `lib/grokUpstreamRetry.ts:28-70`의 status/Retry-After 분류, `lib/grokUpstreamRetry.ts:99-164`의 body cancel과 abortable retry다. OpenCodex의 세대 snapshot 규칙은 `src/oauth/index.ts:540-622`, xAI token retry의 초과 Retry-After 거부 규칙은 `src/oauth/xai.ts:184-257`을 따른다. host 판정은 참고 구현이 아니라 위 라이브 결과와 D2를 따른다.

## 3. 구조 결정

```text
proxy/server.ts
  └─ transport/fetch.ts       실행, timeout, abort, 401 replay
       ├─ transport/base-url.ts  host와 URL
       ├─ transport/headers.ts   인증·추적·forward header
       ├─ transport/retry.ts     pre-header/HTTP retry 판정
       └─ auth/bearer-session.ts WP5 one-shot 401
```

대안으로 `server.ts`에 helper를 추가하는 안은 reject한다. 현재 파일이 이미 body buffering, Express 응답, stream pump까지 소유하므로 transport 정책까지 남기면 `000_plan.md:28-32`의 분리 원칙을 위반한다. 범용 HTTP client 클래스를 만드는 안도 reject한다. xAI host/header/retry 규칙이 목적이므로 작은 함수 네 개가 더 깊고 테스트하기 쉽다.

## 4. 외부 계약과 마이그레이션

- `GET /health`는 계속 `200 {status:"ok",upstream:"xAI Grok",proxy:"progrok"}`이다.
- 모든 method의 일반 `/v1/*`는 whitelist 없이 계속 포워딩한다. 단, `/deployment/config`는 `GROK_DEPLOYMENT_KEY` 전용 client로만 허용하고 `/feedback*`는 base URL 확정 전까지 fetch 전에 거부한다.
- inbound client의 bearer는 계속 무시하고 progrok OAuth bearer로 교체한다.
- 응답 status, 안전한 response header, body byte stream은 그대로 전달한다.
- CLI 명령명, 기본 포트 18645, `~/.progrok/auth.json`은 바꾸지 않는다.
- `XAI_API_BASE_URL`은 기존 command imports를 위해 deprecated alias로 유지한다. 후속 WP가 각 command를 transport로 옮긴 뒤 제거 여부를 별도로 판단한다.

## 5. 파일 변경 목록

| 상태 | 경로 | 책임 |
|---|---|---|
| NEW | `src/transport/base-url.ts` | public 기본 URL 고정, explicit CLI-proxy opt-in 격리, URL 정규화 |
| NEW | `src/transport/headers.ts` | hop-by-hop 제거, auth와 `x-grok-*` 조립 |
| NEW | `src/transport/retry.ts` | replay-safe 분류, Retry-After/backoff, abortable sleep |
| NEW | `src/transport/fetch.ts` | `XaiTransport`, `createXaiTransport`, header timeout, caller abort, HTTP retry, 401 one-shot, opt-in CLI-proxy client |
| NEW | `scripts/probe-oauth-base-url.ts` | 두 host 지원 매트릭스 생성 |
| NEW | `tests/transport.test.ts` | transport 단위·통합 회귀 테스트 |
| NEW | `devlog/_plan/260918_native_xai_spec/evidence/wp6-oauth-base-url-probe.json` | probe가 생성하는 redacted 결과 |
| MODIFY | `src/auth/constants.ts` | public base와 explicit-opt-in 전용 CLI-proxy base 상수, deprecated alias |
| MODIFY | `src/proxy/server.ts` | URL/header/fetch 코드를 transport 호출로 교체 |
| MODIFY | `tests/proxy.test.ts` | 실제 인터넷 호출 제거, 주입 transport로 계약 검증 |
| MODIFY | `devlog/_plan/260918_native_xai_spec/001_endpoint_inventory.md` | probe 결과와 경로별 base 확정 |
| MODIFY | `devlog/_plan/260918_native_xai_spec/000_plan.md` | OAuth base URL 미해결 항목 종료 |
| DELETE | 없음 | D2의 두 제한 경로 외 fallback `/v1/*` 계약을 유지한다 |

`src/commands/billing.ts`와 기타 command의 직접 fetch는 WP12에서 transport로 이동한다. 이 단계에서는 base resolver 테스트에 `/billing`과 `/user`가 OAuth 기본 레인인 `api.x.ai`로 가는 계약을 고정한다.

## 6. 상세 diff

### 6.1 NEW `src/transport/base-url.ts`

```ts
export const XAI_PUBLIC_API_BASE_URL = "https://api.x.ai/v1";
export const XAI_SESSION_API_BASE_URL = "https://cli-chat-proxy.grok.com/v1";

export type UpstreamAuthKind = "oauth" | "api-key" | "deployment-key";
export type PublicApiAuthKind = Exclude<UpstreamAuthKind, "deployment-key">;
export type UpstreamBaseKind = "public-api" | "session-api";

export interface BaseUrlDecision {
  kind: UpstreamBaseKind;
  baseUrl: string;
  reason: "oauth-public-default" | "api-key-public-only" | "explicit-cli-proxy" | "deployment-key-only";
}

export interface CliChatProxyOptIn { explicitOptIn: true }

const DEPLOYMENT_CONFIG = /^\/v1\/deployment\/config(?:\/|$)/;
const FEEDBACK = /^\/v1\/feedback(?:\/|$)/;

export function normalizeXaiPath(pathname: string): string {
  const parsed = new URL(pathname, "https://local.invalid");
  const path = parsed.pathname.startsWith("/v1/") || parsed.pathname === "/v1"
    ? parsed.pathname
    : `/v1/${parsed.pathname.replace(/^\/+/, "")}`;
  return `${path}${parsed.search}`;
}

export function resolveUpstreamBase(
  pathname: string,
  authKind: PublicApiAuthKind,
): BaseUrlDecision {
  const normalized = normalizeXaiPath(pathname);
  const pathOnly = new URL(normalized, "https://local.invalid").pathname;
  if (DEPLOYMENT_CONFIG.test(pathOnly)) throw new Error("/deployment/config requires GROK_DEPLOYMENT_KEY");
  if (FEEDBACK.test(pathOnly)) throw new Error("feedback base URL is not established; automatic routing is disabled");
  return {
    kind: "public-api",
    baseUrl: XAI_PUBLIC_API_BASE_URL,
    reason: authKind === "api-key" ? "api-key-public-only" : "oauth-public-default",
  };
}

export function resolveUpstreamUrl(pathname: string, authKind: PublicApiAuthKind): URL {
  const normalized = normalizeXaiPath(pathname);
  const decision = resolveUpstreamBase(normalized, authKind);
  const suffix = normalized.replace(/^\/v1/, "");
  return new URL(`${decision.baseUrl}${suffix}`);
}

export function resolveCliChatProxyUrl(pathname: string, _optIn: CliChatProxyOptIn): URL {
  const normalized = normalizeXaiPath(pathname);
  const suffix = normalized.replace(/^\/v1/, "");
  return new URL(`${XAI_SESSION_API_BASE_URL}${suffix}`);
}

export function resolveDeploymentConfigUrl(
  authKind: Extract<UpstreamAuthKind, "deployment-key">,
  optIn: CliChatProxyOptIn,
): URL {
  void authKind;
  return resolveCliChatProxyUrl("/v1/deployment/config", optIn);
}
```

정규화는 absolute URL의 외부 host를 신뢰하지 않고 path/query만 취한다. `..`, userinfo, fragment로 host를 바꿀 수 없어야 한다. 기본 `resolveUpstreamUrl`은 session host를 반환하는 분기가 없다. `createXaiTransport`와 프록시는 이 함수만 사용한다. `resolveCliChatProxyUrl`은 이름과 `{ explicitOptIn: true }` 인자로 별도 선택을 강제하며, `/deployment/config`는 `resolveDeploymentConfigUrl("deployment-key", ...)`만 사용한다. `/feedback*`는 기본 resolver에서 거부하고, 근거 URL이 별도 결정되기 전에는 어떤 전용 client에도 자동 등록하지 않는다.

### 6.2 NEW `src/transport/headers.ts`

```ts
import { randomUUID } from "node:crypto";
import type { UpstreamAuthKind } from "./base-url.js";

const HOP_BY_HOP = new Set([
  "host", "content-length", "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "trailers", "transfer-encoding",
  "upgrade", "authorization", "x-xai-token-auth",
]);

export interface GrokTraceContext {
  requestId?: string;
  conversationId?: string;
  sessionId?: string;
  agentId?: string;
  turnIndex?: number;
  modelOverride?: string;
  transientRetry?: boolean;
}

export interface BuildUpstreamHeadersInput {
  incoming?: Headers | Record<string, string | string[] | undefined>;
  auth: { kind: UpstreamAuthKind; bearer: string };
  trace?: GrokTraceContext;
  clientVersion: string;
}

export function buildUpstreamHeaders(input: BuildUpstreamHeadersInput): Headers {
  const result = new Headers();
  const incoming = input.incoming instanceof Headers
    ? input.incoming
    : new Headers(Object.entries(input.incoming ?? {}).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] ?? "" : value]]));
  for (const [key, value] of incoming) {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP.has(lower) && !lower.startsWith("x-grok-")) result.set(key, value);
  }
  result.set("Authorization", `Bearer ${input.auth.bearer}`);
  if (input.auth.kind === "oauth") result.set("X-XAI-Token-Auth", "xai-grok-cli");
  result.set("x-grok-client-identifier", "progrok");
  result.set("x-grok-client-version", input.clientVersion);
  result.set("x-grok-req-id", input.trace?.requestId ?? randomUUID());
  if (input.trace?.conversationId) result.set("x-grok-conv-id", input.trace.conversationId);
  if (input.trace?.sessionId) result.set("x-grok-session-id", input.trace.sessionId);
  if (input.trace?.agentId) result.set("x-grok-agent-id", input.trace.agentId);
  if (input.trace?.turnIndex !== undefined) result.set("x-grok-turn-idx", String(input.trace.turnIndex));
  if (input.trace?.modelOverride) result.set("x-grok-model-override", input.trace.modelOverride);
  if (input.trace?.transientRetry) result.set("x-grok-transient-retry", "true");
  return result;
}
```

inbound `x-grok-user-id`, `x-grok-deployment-id`, `x-grok-conv-group-id`는 신뢰하지 않아 전달하지 않는다. 후속 기능이 이 값을 필요로 하면 인증된 내부 컨텍스트에서 typed 필드로 추가한다. token 값은 로그에 넣지 않는다.

### 6.3 NEW `src/transport/retry.ts`

```ts
export type ReplayClass = "never" | "idempotent" | "explicit-idempotency-key";

export interface RetryPolicy {
  replay: ReplayClass;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retry429: boolean;
  retry5xx: boolean;
}

export function classifyReplay(method: string, headers: Headers): ReplayClass {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") return "idempotent";
  return headers.has("idempotency-key") ? "explicit-idempotency-key" : "never";
}

export function isRetryableStatus(status: number, policy: RetryPolicy): boolean {
  if (policy.replay === "never") return false;
  if (status === 429) return policy.retry429;
  return policy.retry5xx && [500, 502, 503, 504, 520, 521, 522].includes(status);
}

export function retryDelayMs(attempt: number, headers: Headers, policy: RetryPolicy, now = Date.now()): number | undefined {
  const raw = headers.get("retry-after")?.trim();
  let serverDelay: number | undefined;
  if (raw && /^\d+(?:\.\d+)?$/.test(raw)) serverDelay = Math.ceil(Number(raw) * 1000);
  else if (raw) { const date = Date.parse(raw); if (Number.isFinite(date)) serverDelay = Math.max(0, date - now); }
  if (serverDelay !== undefined) return serverDelay <= policy.maxDelayMs ? serverDelay : undefined;
  const exponential = Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
  return Math.floor(exponential * (0.8 + Math.random() * 0.4));
}

export async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => { clearTimeout(timer); cleanup(); reject(signal?.reason); };
    function cleanup() { signal?.removeEventListener("abort", onAbort); }
    function done() { cleanup(); resolve(); }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
```

기본 policy는 GET/HEAD/OPTIONS 3회, POST/PATCH/DELETE 1회다. `Idempotency-Key`가 있는 쓰기만 429/5xx retry를 허용한다. 이미지·비디오 생성 시작, TTS/STT, realtime secret 발급은 키가 없으면 절대 자동 재시도하지 않는다.

### 6.4 NEW `src/transport/fetch.ts`

```ts
import { withBearer401Replay } from "../auth/bearer-session.js";
import { resolveUpstreamUrl } from "./base-url.js";
import { buildUpstreamHeaders, type GrokTraceContext } from "./headers.js";
import { classifyReplay, isRetryableStatus, retryDelayMs, sleepWithAbort, type RetryPolicy } from "./retry.js";
import { readPackageVersion } from "../utils/version.js";

export interface XaiFetchInput {
  path: string;
  method: string;
  incomingHeaders?: Headers | Record<string, string | string[] | undefined>;
  body?: BodyInit;
  signal?: AbortSignal;
  headerTimeoutMs?: number;
  trace?: GrokTraceContext;
  clientVersion: string;
  replayable?: boolean;
}

export interface TransportDeps { fetch?: typeof globalThis.fetch }

export interface XaiTransport {
  request(
    path: string,
    init?: RequestInit,
    policy?: { replayable?: boolean },
  ): Promise<Response>;
}

function headerSignal(caller: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal; clear: () => void;
} {
  const headerTimeout = new AbortController();
  const timer = setTimeout(
    () => headerTimeout.abort(new DOMException("Upstream headers timed out", "TimeoutError")),
    timeoutMs,
  );
  return {
    signal: caller ? AbortSignal.any([caller, headerTimeout.signal]) : headerTimeout.signal,
    clear: () => clearTimeout(timer),
  };
}

async function fetchAttempt(input: XaiFetchInput, bearer: string, deps: TransportDeps): Promise<Response> {
  const url = resolveUpstreamUrl(input.path, "oauth");
  const headers = buildUpstreamHeaders({
    incoming: input.incomingHeaders,
    auth: { kind: "oauth", bearer },
    trace: input.trace,
    clientVersion: input.clientVersion,
  });
  const bounded = headerSignal(input.signal, input.headerTimeoutMs ?? 30_000);
  try {
    return await (deps.fetch ?? globalThis.fetch)(url, {
      method: input.method,
      headers,
      body: input.body,
      signal: bounded.signal,
      redirect: "error",
    }); // resolve 시점이 response header commit 경계다.
  } finally {
    bounded.clear(); // body stream에는 header timeout을 적용하지 않는다.
  }
}

async function fetchHttpRetry(input: XaiFetchInput, bearer: string, deps: TransportDeps): Promise<Response> {
  const sampleHeaders = buildUpstreamHeaders({
    incoming: input.incomingHeaders, auth: { kind: "oauth", bearer },
    trace: input.trace, clientVersion: input.clientVersion,
  });
  const replay = input.replayable === false ? "never" : classifyReplay(input.method, sampleHeaders);
  const policy: RetryPolicy = {
    replay, maxAttempts: replay === "never" ? 1 : 3,
    baseDelayMs: 400, maxDelayMs: 5_000, retry429: true, retry5xx: true,
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
    if (input.signal?.aborted) throw input.signal.reason;
    let response: Response;
    try {
      response = await fetchAttempt({ ...input, trace: { ...input.trace, transientRetry: attempt > 0 } }, bearer, deps);
    } catch (error) {
      if (input.signal?.aborted || replay === "never" || attempt + 1 >= policy.maxAttempts) throw error;
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw error;
      lastError = error; // Response가 없으므로 header 전 네트워크 실패다.
      await sleepWithAbort(Math.min(150 * 2 ** attempt, 1_000), input.signal);
      continue;
    }
    if (!isRetryableStatus(response.status, policy) || attempt + 1 >= policy.maxAttempts) return response;
    const delay = retryDelayMs(attempt, response.headers, policy);
    if (delay === undefined) return response;
    await response.body?.cancel().catch(() => undefined);
    await sleepWithAbort(delay, input.signal);
  }
  throw lastError ?? new Error("xAI fetch exhausted retries");
}

export function xaiFetch(input: XaiFetchInput, deps: TransportDeps = {}): Promise<Response> {
  return withBearer401Replay(
    (snapshot) => fetchHttpRetry(input, snapshot.token, deps),
    { signal: input.signal, discard: (response) => response.body?.cancel().catch(() => undefined) },
  );
}

export function createXaiTransport(options: {
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): XaiTransport {
  return {
    request(path, init = {}, policy = {}) {
      const requestSignal = init.signal ?? undefined;
      const signal = options.signal && requestSignal
        ? AbortSignal.any([options.signal, requestSignal])
        : options.signal ?? requestSignal;
      return xaiFetch({
        path,
        method: init.method ?? "GET",
        incomingHeaders: init.headers ? new Headers(init.headers) : undefined,
        body: init.body ?? undefined,
        signal,
        headerTimeoutMs: options.timeoutMs,
        clientVersion: readPackageVersion(),
        replayable: policy.replayable,
      });
    },
  };
}
```

`XaiTransport`와 `createXaiTransport`는 wp11이 import하는 공개 transport 계약이다. `createXaiTransport`는 OAuth 기본 레인만 만들며 내부에서 항상 `resolveUpstreamUrl(..., "oauth")`를 사용하므로 `cli-chat-proxy`로 갈 수 없다. `xaiFetch`는 Response를 반환한 뒤 body를 읽지 않는다. 따라서 stream 도중 reset, parser 오류, client disconnect를 이 레이어가 재시도할 기회가 없다. 이것이 mid-stream 금지의 구조적 보장이다. request body가 `ReadableStream`이면 재생 불가로 강제 분류하고 `duplex` 요구를 별도로 처리한다.

`cli-chat-proxy`는 이 factory의 option이나 path 분기로 열지 않는다. 전용 factory의 공개 계약은 다음과 같이 별도로 둔다.

```ts
export type CliChatProxyCredential =
  | { kind: "oauth" }
  | { kind: "deployment-key"; env: "GROK_DEPLOYMENT_KEY" };

export function createCliChatProxyTransport(options: {
  explicitOptIn: true;
  credential: CliChatProxyCredential;
  signal?: AbortSignal;
  timeoutMs?: number;
}): XaiTransport;
```

이 factory만 `resolveCliChatProxyUrl`을 사용한다. 내부 HTTP 실행기는 public factory와 공유하되 URL resolver와 credential provider를 private 인자로 받는다. `deployment-key`는 `/v1/deployment/config` 외 경로를 fetch 전에 거부하고 OAuth 401 refresh를 실행하지 않는다. `/feedback*`는 이 전용 factory의 자동 surface 목록에도 넣지 않는다.

### 6.5 NEW `scripts/probe-oauth-base-url.ts`

프로브는 `getValidBearerSnapshot()`을 사용하되 token을 출력하지 않는다. 각 host에 동일한 OAuth token과 `X-XAI-Token-Auth`를 보내 아래 표를 측정한다. 이 스크립트는 진단 evidence만 만들며 `resolveUpstreamUrl`의 OAuth 기본 host를 바꾸거나 session host fallback을 활성화하지 않는다.

| Probe | Method/path | Body | 비용/부작용 |
|---|---|---|---|
| catalog | `GET /v1/models` | 없음 | read-only |
| detailed catalog | `GET /v1/language-models` | 없음 | read-only |
| voice catalog | `GET /v1/tts/voices` | 없음 | read-only |
| STT route | `POST /v1/stt` | 빈 multipart | 400/422 route proof, 추론 없음 |
| TTS route | `POST /v1/tts` | 유효하지 않은 빈 JSON | 400/422 route proof, 생성 없음 |
| realtime secret | `POST /v1/realtime/client_secrets` | `expires_after.seconds=60` | 짧은 ephemeral secret 생성, 값 저장/출력 금지 |
| inference | `POST /v1/responses` | `grok-4.3`, 입력 `Reply only OK`, max output 2, non-stream | 소액 과금 가능, 1회씩만 |
| session | `GET /v1/user`, `GET /v1/billing` | 없음 | read-only |

CLI:

```ts
interface ProbeRecord {
  host: "public-api" | "session-api";
  method: string;
  path: string;
  status: number | null;
  classification: "supported" | "route-exists" | "auth-rejected" | "forbidden" | "not-found" | "network-error";
  requestId?: string;
  elapsedMs: number;
}

async function probeOne(spec: ProbeSpec, host: ProbeHost, bearer: string): Promise<ProbeRecord> {
  const started = Date.now();
  try {
    const response = await fetch(new URL(spec.path, host.baseUrl), {
      method: spec.method,
      headers: buildProbeHeaders(bearer, spec),
      body: spec.body?.(),
      signal: AbortSignal.timeout(30_000),
    });
    await response.body?.cancel().catch(() => undefined);
    return {
      host: host.kind, method: spec.method, path: spec.path, status: response.status,
      classification: classifyProbeStatus(response.status),
      requestId: response.headers.get("x-request-id") ?? undefined,
      elapsedMs: Date.now() - started,
    };
  } catch {
    return { host: host.kind, method: spec.method, path: spec.path, status: null,
      classification: "network-error", elapsedMs: Date.now() - started };
  }
}
```

판정 규칙:

- 2xx/202: `supported`.
- 400/405/415/422: 인증을 통과해 handler에 도달한 `route-exists`.
- 401: `auth-rejected`.
- 403: route는 있을 수 있으나 entitlement가 없어 `forbidden`; 지원 확정에 쓰지 않는다.
- 404: `not-found`.
- 429/5xx: 일시 실패로 기록하고 자동 판정하지 않는다.

`responses`처럼 실제 성공이 필요한 경로는 2xx만 host 지원으로 확정한다. invalid-body 4xx는 경로 존재만 증명한다. 결과 JSON에는 status, 분류, request ID, elapsed만 기록하고 response body, token, email, user ID는 기록하지 않는다.

실행 명령:

```bash
cd /Users/jun/Developer/progrok
npx tsx scripts/probe-oauth-base-url.ts \
  --out devlog/_plan/260918_native_xai_spec/evidence/wp6-oauth-base-url-probe.json
```

`--include-billable-inference` 없이는 `/responses`를 건너뛴다. 구현자는 과금 프로브를 실행하기 전에 현재 작업의 승인 범위를 확인한다. 동일 날짜에 각 host 1회만 실행한다.

### 6.6 MODIFY `src/auth/constants.ts`

현재 `src/auth/constants.ts:28-30`:

```ts
// API
export const XAI_API_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_MODEL = "grok-4.3";
```

변경 후:

```ts
export const XAI_PUBLIC_API_BASE_URL = "https://api.x.ai/v1";
/** Explicit opt-in 전용이다. 기본 resolver와 createXaiTransport는 사용하지 않는다. */
export const XAI_SESSION_API_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
/** @deprecated 신규 코드는 transport/base-url.ts의 resolver를 사용한다. */
export const XAI_API_BASE_URL = XAI_PUBLIC_API_BASE_URL;
export const DEFAULT_MODEL = "grok-4.3";
```

`base-url.ts`는 이 두 상수를 import해 literal 중복을 없앤다. 6.1 skeleton의 literal은 설명용이며 실제 파일에서는 constants import로 치환한다.

### 6.7 MODIFY `src/proxy/server.ts`

현재 import `src/proxy/server.ts:2-9`:

```ts
import { XAI_API_BASE_URL, PROXY_DEFAULT_PORT, PROXY_DEFAULT_HOST } from "../auth/constants.js";
import { getValidBearer } from "../auth/token-store.js";
```

변경 후:

```ts
import { PROXY_DEFAULT_PORT, PROXY_DEFAULT_HOST } from "../auth/constants.js";
import { xaiFetch, type TransportDeps } from "../transport/fetch.js";
import { readPackageVersion } from "../utils/version.js";
```

현재 `src/proxy/server.ts:88-99`의 URL/header/fetch 조립:

```ts
const upstreamUrl = `${XAI_API_BASE_URL}${relPath}${qs}`;
const fwdHeaders = filterHeaders(req.headers as Record<string, string>);
fwdHeaders["Authorization"] = `Bearer ${bearer}`;
const upstream = await fetch(upstreamUrl, { /* ... */ });
```

변경 후:

```ts
export interface ProxyAppDeps { transport?: TransportDeps }
export function createProxyApp(deps: ProxyAppDeps = {}): express.Application { /* routes unchanged */ }

const abort = new AbortController();
const onAborted = () => abort.abort(new DOMException("Client disconnected", "AbortError"));
req.once("aborted", onAborted);
res.once("close", () => { if (!res.writableEnded) onAborted(); });

const upstream = await xaiFetch({
  path: `/v1${relPath}${qs}`,
  method: req.method,
  incomingHeaders: req.headers as Record<string, string | string[] | undefined>,
  body: fwdBody.length > 0 ? new Uint8Array(fwdBody) : undefined,
  signal: abort.signal,
  clientVersion: readPackageVersion(),
}, deps.transport);
```

`filterHeaders`와 로컬 `HOP_BY_HOP`은 삭제하고 `headers.ts`가 소유한다. response header 필터는 별도 allow/deny 함수로 `headers.ts`에 export하거나 server에 남기되 request policy와 중복하지 않는다. stream pump `src/proxy/server.ts:114-128`은 WP7 전까지 유지하고, catch에서 headers가 이미 전송된 mid-stream 오류는 로그만 남기고 retry하지 않는다.

현재 auth catch `src/proxy/server.ts:56-64`는 제거된다. `xaiFetch`가 던지는 typed auth 오류를 catch해 기존 `{error:{message,type:"auth_error"}}` 401 shape로 매핑한다. 다른 upstream 오류는 기존 502 shape를 유지한다.

### 6.8 MODIFY `tests/proxy.test.ts`

현재 `tests/proxy.test.ts:98-106`은 실제 xAI 인터넷을 호출한다. 이를 deterministic fake transport로 바꾼다.

```ts
const calls: Array<{ url: string; init?: RequestInit }> = [];
const fakeFetch: typeof globalThis.fetch = async (input, init) => {
  calls.push({ url: String(input), init });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "test-request" },
  });
};
const app = createProxyApp({ transport: { fetch: fakeFetch } });
```

테스트는 `/health` exact body, unknown `/v1/*` forwarding, query 보존, inbound Authorization 교체, OAuth 보조 header, client abort, binary response, 두 번째 401 미재시도를 검증한다. 실제 홈 credential 대신 WP5 token-store deps 또는 임시 auth 파일을 주입한다.

### 6.9 MODIFY 연구 문서

`001_endpoint_inventory.md:143-166`의 라이브 판정과 `000_plan.md` D2가 권위다. 추가 probe를 실행하더라도 OAuth 기본 레인은 `api.x.ai`, CLI proxy는 explicit opt-in이라는 결론을 자동으로 뒤집지 않는다. 문서에는 다음 형식으로 evidence를 연결한다.

```md
- **OAuth base URL — 해결(2026-09-18).**
  모든 OAuth 기본 경로는 `api.x.ai`를 사용한다. CLI proxy는 explicit opt-in 전용이며,
  deployment config는 `GROK_DEPLOYMENT_KEY`, feedback은 자동 라우팅 제외다.
```

probe가 양쪽 모두 성공해도 임의 failover를 넣지 않는다. 다른 host는 진단 정보로만 남긴다. 자동 cross-host retry는 모델 차이, 중복 실행과 과금을 만들 수 있으므로 금지한다.

## 7. 재시도 상태 기계

```text
request 준비
  ├─ caller aborted → 즉시 종료
  └─ fetch 시작
       ├─ Response 전 network reject
       │    ├─ replay=never → 종료
       │    └─ replayable + budget → backoff 후 재시도
       └─ Response headers 도착(commit)
            ├─ 401 + OAuth + 아직 replay 안 함 → body cancel → generation-safe refresh → 1회 replay
            ├─ 429/허용 5xx + replayable → Retry-After/backoff → 재시도
            └─ 그 외 Response 반환
                 └─ body read/stream 오류 → 호출자에 전달, 재시도 없음
```

401 replay와 429/5xx retry의 nesting은 401이 바깥쪽이다. 첫 bearer로 HTTP retry budget을 소진한 뒤 401이면 새 bearer로 한 번 replay하고, 새 bearer 요청도 자기 HTTP retry policy를 적용한다. 그러나 401 자체는 두 번 replay하지 않는다.

## 8. 검증 명령

```bash
cd /Users/jun/Developer/progrok
node --test --test-concurrency=1 --import tsx --experimental-test-module-mocks tests/transport.test.ts tests/proxy.test.ts
npm run typecheck
npm test
npm run build
```

live probe는 credential과 과금 승인이 있는 환경에서 별도로 실행한다.

```bash
npx tsx scripts/probe-oauth-base-url.ts \
  --out devlog/_plan/260918_native_xai_spec/evidence/wp6-oauth-base-url-probe.json
# 승인된 경우에만:
npx tsx scripts/probe-oauth-base-url.ts --include-billable-inference \
  --out devlog/_plan/260918_native_xai_spec/evidence/wp6-oauth-base-url-probe.json
```

## 9. 테스트 행렬

| 사례 | 기대 |
|---|---|
| OAuth `/v1/models` | `api.x.ai`, Authorization + X-XAI header |
| API-key `/v1/models` | 항상 public host, X-XAI header 없음 |
| OAuth `/v1/billing`, `/v1/user` | `api.x.ai`; path 기반 session 전환 없음 |
| OAuth `/v1/deployment/config` | credential mismatch로 fetch 전 거부 |
| deployment-key `/v1/deployment/config` | explicit-opt-in CLI-proxy client만 허용 |
| OAuth/API-key `/v1/feedback*` | base 미확정 오류로 fetch 전 거부 |
| CLI-proxy 전용 client | `{ explicitOptIn: true }` 없이는 생성 불가 |
| inbound host/auth/x-grok-user-id | 모두 제거·재조립 |
| GET pre-header ECONNRESET | 최대 3회 |
| POST pre-header ECONNRESET, idempotency key 없음 | 1회, 재시도 없음 |
| GET 429 Retry-After 1 | body cancel, 1초 후 retry |
| GET 429 Retry-After 60초 초과 | Response 그대로 반환 |
| GET 500/502/503/504/520/521/522 | replay budget 안에서 retry |
| GET 507, 4xx | 재시도 없음 |
| 첫 401, refresh 성공 | 첫 body cancel, 정확히 1회 replay |
| 두 번째 401 | 그대로 반환, 세 번째 요청 없음 |
| body 첫 chunk 후 reset | 재시도 없음 |
| caller abort 중 backoff | 즉시 abort, 추가 fetch 없음 |
| 30초 header timeout | TimeoutError, stream duration에는 영향 없음 |
| client disconnect | upstream fetch abort |

## 10. 완료 조건

- focused tests, typecheck, 전체 test, build가 모두 exit 0이다.
- `tests/proxy.test.ts`가 인터넷 없이 실행된다.
- 임의 `/v1/unknown-path?x=1`이 path/query를 보존해 forward된다.
- OAuth `/billing`·`/user`가 `api.x.ai`로 가고, `/deployment/config`·`/feedback*`가 잘못된 credential이나 자동 경로에서 fetch 전에 거부된다.
- `cli-chat-proxy`는 explicit-opt-in 전용 client에서만 도달 가능하고 기본 `createXaiTransport`에서는 도달 불가능하다.
- 401, pre-header network, 429/5xx, mid-stream 각각의 호출 횟수가 테스트에서 명시적으로 검증된다.
- probe JSON에 token, response body, email, user ID가 없고 두 host의 모든 시도가 status/classification으로 남는다.
- `001_endpoint_inventory.md`와 `000_plan.md`가 probe 결과와 같은 경로별 판정을 말한다.
- `/health`, CLI 명령, 기본 포트, `auth.json` 스키마에 breaking change가 없다.
