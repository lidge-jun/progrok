# WP5 인증 코어 구현 PRD

## 1. 목표와 완료 상태

이 단계는 `~/.progrok/auth.json` 공개 계약과 세 가지 로그인 진입점을 그대로 둔 채 OAuth 토큰 교환·refresh·저장을 경쟁 안전한 인증 코어로 바꾼다. 구현자는 이 문서만으로 파일을 만들고 수정한 뒤 검증할 수 있어야 한다.

완료 후 보장할 불변식은 다음과 같다.

- `progrok login`의 기본 device-code, `--browser` loopback PKCE, `--manual-paste`가 모두 유지된다.
- 디스크 스키마는 현재 camelCase 필드 `accessToken`, `refreshToken`, `expiresAt`, `tokenEndpoint`, `email`, `idToken`을 유지한다. ima2-gen v3.16.1이 쓰는 선택 필드 `accountId`와 미래의 알 수 없는 필드도 round-trip에서 보존한다.
- 만료 판단은 저장된 원시 `expiresAt`에 120초 skew를 비교할 때만 적용한다. skew를 미리 뺀 값을 저장하지 않는다.
- refresh는 계정 키별 singleflight이며, 시작 세대가 아닌 새 디스크 세대 위에 늦게 완료된 결과를 쓰지 않는다.
- `invalid_grant`, `refresh_token_reused`, `revoked_token`만 terminal로 분류한다. 파일은 삭제하지 않고 해당 계정·세대에 30초 negative cache를 둔다.
- 네트워크 오류와 429/5xx는 최대 3회 시도한다. `Retry-After`가 60초를 넘으면 60초 뒤 조기 재시도하지 않고 현재 요청을 실패시킨다.
- 401은 거부된 access token을 전달해 새 디스크 세대가 있으면 그것을 재사용하고, 아니면 refresh한 뒤 정확히 한 번만 재전송한다.

## 2. 위협 모델과 경계

자산은 refresh token, access token, ID token, 계정 식별 메타데이터다. 진입점은 OIDC discovery JSON, token endpoint JSON/오류 본문, `auth.json`, CLI 입력, loopback callback이다. 공격자는 변조된 discovery 응답, 손상된 로컬 JSON, 동시 요청, 늦게 끝나는 refresh, 401 폭주를 만들 수 있다고 본다.

통제는 다음과 같다.

1. discovery URL은 HTTPS, 정확한 `auth.x.ai`/`accounts.x.ai`, 빈 userinfo와 빈 비표준 port만 허용한다.
2. 외부 JSON은 `unknown`으로 받고 필드를 검사한 뒤 타입으로 승격한다.
3. refresh 결과 저장은 디스크 세대 compare-and-swap으로 제한한다.
4. 로그와 오류 메시지에는 token, raw 응답 본문, 계정 ID를 넣지 않는다.
5. terminal 판정은 typed OAuth error code로만 하고 임의 문자열 `includes("revoked")`는 쓰지 않는다.

비협조 외부 프로세스인 ima2-gen은 progrok의 메모리 singleflight에 참여하지 않는다. 따라서 이 단계가 보장하는 범위는 progrok 프로세스 내부 계정별 singleflight와, 공유 파일에 대한 세대 fence다. 외부 프로세스가 같은 refresh token을 동시에 upstream으로 보내는 것까지 막는다고 주장하지 않는다. 대신 외부 프로세스가 먼저 새 세대를 썼다면 progrok은 그 세대를 덮지 않는다.

## 3. 현재 구조와 목표 의존 방향

현재 `src/auth/token-store.ts:92-149`가 파일 읽기, 만료 판단, HTTP refresh, 응답 파싱, 저장을 한 함수에 합친다. `src/auth/pkce.ts:100-125`와 `src/auth/device-code.ts:60-79`도 token endpoint를 각각 직접 호출한다.

목표 방향은 다음과 같다.

```text
callback-server.ts ─┐
pkce.ts ────────────┼─> discovery.ts ─> token-client.ts
device-code.ts ─────┘                         ▲
                                             │
token-store.ts facade ─> token-manager.ts ───┘
        ▲
        │
bearer-session.ts <─ WP6 transport/fetch.ts
```

`token-client.ts`는 OAuth HTTP와 재시도만 소유한다. `token-manager.ts`는 주입 가능한 만료 판단, refresh singleflight, terminal negative cache를 소유한다. `token-store.ts`는 디스크 형식, 세대 fence와 기존 `getValidBearer`/`getValidBearerSnapshot` 호환 facade만 소유한다. `bearer-session.ts`는 401 한 번 재생 규칙만 소유한다.

참고 구현에서 가져오는 불변식은 다음으로 한정한다.

- ima2-gen `lib/xaiAuth.ts:122-153`: 매 요청 디스크 재읽기, atomic 0600 저장, refresh 실패 시 파일 비삭제.
- ima2-gen `lib/xaiAuth.ts:206-295`: Retry-After 파싱, 429/5xx와 네트워크 오류의 bounded retry, 실패 body drain.
- ima2-gen `lib/xaiAuth.ts:321-360`: refresh token fallback, 알 수 없는 만료시간을 꾸며내지 않는 규칙.
- ima2-gen `lib/xaiAuth.ts:367-457`: singleflight, terminal negative cache, rejected access token 세대 전진 확인.
- OpenCodex `src/oauth/index.ts:540-599`: `(provider, account)` 단위 flight와 stale owner가 새 flight를 지우지 않는 identity check.
- OpenCodex `src/oauth/index.ts:655-675`: terminal OAuth code의 typed 분류.
- OpenCodex `src/oauth/index.ts:831`: 저장 전 credential generation 비교와 terminal mark의 세대 fence.

참고 구현의 저장 필드명(`access`/`refresh`)이나 다중 계정 store 형태는 가져오지 않는다. progrok/ima2-gen 공유 계약은 camelCase 단일 파일이기 때문이다.

## 4. 공개 계약

### 4.1 `auth.json`

현재 스키마를 additive하게만 해석한다.

```ts
export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint?: string;
  email?: string;
  idToken?: string;
  accountId?: string;
  [key: string]: unknown;
}
```

마이그레이션은 없다. 기존 파일을 읽고 같은 키 이름으로 쓴다. 저장 시 기존 객체 위에 새 토큰 필드만 merge해 ima2-gen이 쓴 `accountId`와 알 수 없는 키를 보존한다. 임시 파일은 0600, 디렉터리는 0700, publish는 같은 디렉터리의 atomic rename이다. 명시적 `progrok logout`만 파일을 삭제한다.

### 4.2 CLI와 HTTP

- `progrok login`, `login --device-code`, `login --browser`, `login --manual-paste`, `logout`, `status`의 이름과 옵션은 바꾸지 않는다.
- `/health`와 `/v1/*`는 이 단계에서 바꾸지 않는다.
- 기존 `getValidBearer(): Promise<string>` 호출자는 계속 컴파일된다. 새 옵션은 선택적이다.

## 5. 파일 변경 목록

| 상태 | 경로 | 책임 |
|---|---|---|
| NEW | `src/auth/token-client.ts` | token endpoint 요청, typed 오류, bounded retry |
| NEW | `src/auth/token-manager.ts` | 주입 가능한 만료 판단, refresh singleflight, terminal negative cache |
| NEW | `src/auth/bearer-session.ts` | bearer snapshot과 401 one-shot replay |
| MODIFY | `src/auth/constants.ts` | refresh/retry 상수의 단일 소유자 추가 |
| MODIFY | `src/auth/discovery.ts` | `unknown` 파싱과 정확한 endpoint allow-list |
| MODIFY | `src/auth/pkce.ts` | 직접 fetch를 공용 token client로 교체 |
| MODIFY | `src/auth/device-code.ts` | polling 오류를 typed code로 분기 |
| MODIFY | `src/auth/token-store.ts` | atomic 보존 저장, generation fence, 기존 bearer facade 유지 |
| MODIFY | `tests/auth.test.ts` | 저장 호환·경쟁·terminal·retry·401 회귀 테스트 |
| DELETE | 없음 | 공개 진입점과 기존 파일은 유지한다 |

`src/auth/callback-server.ts:1-109`는 MODIFY하지 않는다. state 비교, HTML escape, 5분 timeout, loopback bind를 그대로 둔다. `src/commands/login.ts:6-42`, `logout.ts:5-12`, `status.ts:5-33`도 이 단계에서는 그대로 둔다.

## 6. 상세 diff

### 6.1 NEW `src/auth/token-client.ts`

아래 공개 시그니처와 핵심 본문을 그대로 구현한다. 테스트 주입점은 시간·sleep·random·fetch뿐이며 production 전용 우회는 두지 않는다.

```ts
import {
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_FETCH_TIMEOUT_MS,
  XAI_TOKEN_MAX_ATTEMPTS,
  XAI_TOKEN_RETRY_AFTER_CAP_MS,
} from "./constants.js";

export interface OAuthTokenPayload {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  id_token?: unknown;
  token_type?: unknown;
}

export class OAuthTokenRequestError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly oauthError: string | undefined,
    message: string,
    options?: { cause?: unknown; retryAfterMs?: number },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OAuthTokenRequestError";
    this.retryAfterMs = options?.retryAfterMs;
  }
  readonly retryAfterMs: number | undefined;
}

export interface TokenRequestDeps {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(XAI_OAUTH_FETCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function parseRetryAfterMs(raw: string | null, now: number): number | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Math.ceil(Number(value) * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

async function readOAuthError(response: Response, now: number): Promise<OAuthTokenRequestError> {
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), now);
  let oauthError: string | undefined;
  let description: string | undefined;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      if (typeof record.error === "string") oauthError = record.error;
      if (typeof record.error_description === "string") description = record.error_description;
    }
  } catch { /* status remains authoritative */ }
  return new OAuthTokenRequestError(
    response.status,
    oauthError,
    `xAI token request failed: HTTP ${response.status}${description ? `: ${description}` : ""}`,
    { retryAfterMs },
  );
}

export async function postXaiToken(
  tokenEndpoint: string,
  fields: Record<string, string>,
  options: { signal?: AbortSignal; deps?: TokenRequestDeps } = {},
): Promise<OAuthTokenPayload> {
  const fetchImpl = options.deps?.fetch ?? globalThis.fetch;
  const sleep = options.deps?.sleep ?? ((ms, signal) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }));
  const random = options.deps?.random ?? Math.random;
  const now = options.deps?.now ?? Date.now;

  for (let attempt = 1; attempt <= XAI_TOKEN_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(tokenEndpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
        signal: requestSignal(options.signal),
      });
    } catch (cause) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError")) {
        throw new OAuthTokenRequestError(undefined, undefined, "xAI token request timed out", { cause });
      }
      if (attempt === XAI_TOKEN_MAX_ATTEMPTS) {
        throw new OAuthTokenRequestError(undefined, undefined, "xAI token request failed: network error", { cause });
      }
      await sleep(Math.round((attempt === 1 ? 100 : 250) * (0.75 + random() * 0.5)), options.signal);
      continue;
    }
    if (response.ok) return await response.json() as OAuthTokenPayload;
    const error = await readOAuthError(response, now());
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === XAI_TOKEN_MAX_ATTEMPTS) throw error;
    if (error.retryAfterMs !== undefined && error.retryAfterMs > XAI_TOKEN_RETRY_AFTER_CAP_MS) throw error;
    await sleep(error.retryAfterMs ?? 250 * attempt, options.signal);
  }
  throw new OAuthTokenRequestError(undefined, undefined, "xAI token request exhausted retries");
}

export function refreshXaiToken(
  tokenEndpoint: string,
  refreshToken: string,
  options: { signal?: AbortSignal; deps?: TokenRequestDeps } = {},
): Promise<OAuthTokenPayload> {
  return postXaiToken(tokenEndpoint, {
    grant_type: "refresh_token",
    client_id: XAI_OAUTH_CLIENT_ID,
    refresh_token: refreshToken,
  }, options);
}
```

실제 구현에서는 abort listener를 resolve 시 제거해 listener 누수를 막는다. `AbortSignal.any`의 Node 18 지원 범위가 빌드 타깃과 충돌하면 같은 동작의 작은 listener 조합 함수를 이 파일 안에 둔다. 새 의존성은 추가하지 않는다.

### 6.2 NEW `src/auth/bearer-session.ts`

```ts
import { getValidBearerSnapshot, type BearerSnapshot } from "./token-store.js";

export interface StatusResponse { status: number }

export async function withBearer401Replay<R extends StatusResponse>(
  send: (bearer: BearerSnapshot) => Promise<R>,
  options: {
    signal?: AbortSignal;
    discard?: (response: R) => void | Promise<void>;
  } = {},
): Promise<R> {
  const firstBearer = await getValidBearerSnapshot({ signal: options.signal });
  const firstResponse = await send(firstBearer);
  if (firstResponse.status !== 401) return firstResponse;

  await options.discard?.(firstResponse);
  const replayBearer = await getValidBearerSnapshot({
    forceRefresh: true,
    rejectedAccessToken: firstBearer.token,
    signal: options.signal,
  });
  return send(replayBearer); // 두 번째 401은 그대로 반환한다.
}
```

이 함수는 429/5xx나 stream 오류를 다루지 않는다. WP6이 `discard`로 첫 401 body를 cancel하고 이 함수를 transport 바깥쪽에 한 번만 배치한다.

### 6.3 NEW `src/auth/token-manager.ts`

WP14의 `tests/auth-refresh.test.ts`가 직접 import하는 공개 이름과 시그니처를 아래처럼 고정한다. `TokenData`와 `SaveTokenInput`은 `token-store.ts`의 기존 공개 타입을 재사용하며 이 파일에서 다시 정의하지 않는다.

```ts
import type { SaveTokenInput, TokenData } from "./token-store.js";

export interface TokenManagerDependencies {
  now(): number;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  load(): TokenData | null;
  save(input: SaveTokenInput): Promise<void>;
}

interface RefreshFlight {
  generation: string;
  startedAt: number;
  promise: Promise<string>;
}

export function createTokenManager(
  dependencies: TokenManagerDependencies,
): { getValidBearer(signal?: AbortSignal): Promise<string> } {
  const flights = new Map<string, RefreshFlight>();
  const terminalFailures = new Map<string, number>();

  async function getValidBearer(signal?: AbortSignal): Promise<string> {
    // 아래 6.8의 세대 비교, singleflight, terminal cache 순서를 이 상태와
    // dependencies만 사용해 실행한다. 실제 홈 디렉터리나 전역 fetch를 직접 읽지 않는다.
    return resolveValidBearer({ dependencies, flights, terminalFailures, signal });
  }

  return { getValidBearer };
}
```

같은 파일의 비공개 `resolveValidBearer`는 6.8의 1–7 순서를 구현하고 `refreshXaiToken`에 `dependencies.fetch`와 `signal`을 전달한다. `finally`에서는 자신이 넣은 promise와 현재 map 값이 같은 경우에만 flight를 삭제한다. production의 `token-store.ts`는 모듈 단위 기본 manager 한 개를 만들고 기존 `getValidBearer(): Promise<string>`를 그 manager에 위임한다. WP6가 기대하는 `getValidBearerSnapshot(options?)`와 `withBearer401Replay` 이름은 각각 `token-store.ts`와 `bearer-session.ts`에 그대로 둔다.

이 모듈은 bearer의 목적 host를 선택하거나 직접 추론 요청을 보내지 않는다. WP6 transport가 OAuth 요청을 기본적으로 `https://api.x.ai/v1`에 보내며, `https://cli-chat-proxy.grok.com/v1`은 명시적 opt-in 전용 클라이언트에서만 선택할 수 있다.

### 6.4 MODIFY `src/auth/constants.ts`

현재 `src/auth/constants.ts:20-26`:

```ts
// Timeouts
export const XAI_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
export const XAI_OAUTH_FETCH_TIMEOUT_MS = 30 * 1000;
export const XAI_DEVICE_CODE_POLL_INTERVAL_MS = 5 * 1000;

// Token refresh
export const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;
```

변경 후:

```ts
export const XAI_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
export const XAI_OAUTH_FETCH_TIMEOUT_MS = 30 * 1000;
export const XAI_DEVICE_CODE_POLL_INTERVAL_MS = 5 * 1000;

export const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;
export const XAI_TOKEN_MAX_ATTEMPTS = 3;
export const XAI_TOKEN_RETRY_AFTER_CAP_MS = 60 * 1000;
export const XAI_REFRESH_FLIGHT_STALE_MS = 2 * 60 * 1000;
export const XAI_TERMINAL_FAILURE_TTL_MS = 30 * 1000;
```

### 6.5 MODIFY `src/auth/discovery.ts`

현재 `src/auth/discovery.ts:12-24`는 suffix `*.x.ai` 전체와 port/userinfo를 허용한다.

```ts
if (parsed.hostname !== "x.ai" && !parsed.hostname.endsWith(".x.ai")) {
  throw new Error("not *.x.ai");
}
```

변경 후 정확한 allow-list와 `unknown` 파서를 둔다.

```ts
const TRUSTED_AUTH_HOSTS = new Set(["auth.x.ai", "accounts.x.ai"]);

function requireTrustedEndpoint(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`OIDC discovery missing ${label}`);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port ||
      !TRUSTED_AUTH_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`OIDC discovery returned untrusted ${label}`);
  }
  return parsed.toString();
}

export async function fetchOIDCDiscovery(signal?: AbortSignal): Promise<OIDCDiscovery> {
  const res = await fetch(XAI_OAUTH_DISCOVERY_URL, {
    headers: { Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(XAI_OAUTH_FETCH_TIMEOUT_MS)])
                   : AbortSignal.timeout(XAI_OAUTH_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  const raw: unknown = await res.json();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid OIDC discovery response");
  const data = raw as Record<string, unknown>;
  return {
    authorizationEndpoint: requireTrustedEndpoint(data.authorization_endpoint, "authorization_endpoint"),
    tokenEndpoint: requireTrustedEndpoint(data.token_endpoint, "token_endpoint"),
    ...(data.device_authorization_endpoint === undefined ? {} : {
      deviceAuthorizationEndpoint: requireTrustedEndpoint(data.device_authorization_endpoint, "device_authorization_endpoint"),
    }),
  };
}
```

### 6.6 MODIFY `src/auth/pkce.ts`

현재 `src/auth/pkce.ts:100-118`의 직접 `fetch`와 cast를 제거한다.

```ts
const tokenRes = await fetch(discovery.tokenEndpoint, { /* ... */ });
if (!tokenRes.ok) { /* raw body */ }
const tokens = (await tokenRes.json()) as OAuthTokenResponse;
```

변경 후:

```ts
const tokens = await postXaiToken(discovery.tokenEndpoint, {
  grant_type: "authorization_code",
  client_id: XAI_OAUTH_CLIENT_ID,
  code,
  redirect_uri: XAI_OAUTH_REDIRECT_URI,
  code_verifier: pkce.verifier,
});
await saveTokensFromOAuthPayload(tokens, { tokenEndpoint: discovery.tokenEndpoint });
```

`loginWithPKCE(options?: { manualPaste?: boolean })` 시그니처와 분기 `src/auth/pkce.ts:77-96`은 유지한다. manual paste에서도 state를 URL로 받았으면 검증하도록 `extractCodeFromInput`은 `{ code, state? }`를 반환하고, state가 존재하면서 예상값과 다르면 거부한다. bare code는 기존 호환 때문에 허용한다.

### 6.7 MODIFY `src/auth/device-code.ts`

현재 `src/auth/device-code.ts:60-92`는 각 poll 응답을 직접 JSON cast한다.

```ts
const pollRes = await fetch(discovery.tokenEndpoint, { /* ... */ });
if (pollRes.ok) { /* save */ }
const err = (await pollRes.json()) as { error: string };
```

변경 후 token client를 사용하고 typed 오류만 분기한다.

```ts
let intervalMs = Math.max((dc.interval ?? 5) * 1000, XAI_DEVICE_CODE_POLL_INTERVAL_MS);
while (Date.now() < deadline) {
  await sleep(intervalMs);
  try {
    const tokens = await postXaiToken(discovery.tokenEndpoint, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: XAI_OAUTH_CLIENT_ID,
      device_code: dc.device_code,
    });
    await saveTokensFromOAuthPayload(tokens, { tokenEndpoint: discovery.tokenEndpoint });
    log.success("Logged in to xAI successfully!");
    return;
  } catch (error) {
    if (!(error instanceof OAuthTokenRequestError)) throw error;
    if (error.oauthError === "authorization_pending") continue;
    if (error.oauthError === "slow_down") { intervalMs += 5_000; continue; }
    if (error.oauthError === "expired_token" || error.oauthError === "access_denied") break;
    throw error;
  }
}
throw new Error("Device code expired or was denied. Please try again.");
```

초기 device authorization 요청도 공용 form POST helper를 사용하되, token payload 타입과 섞지 않는다.

### 6.8 MODIFY `src/auth/token-store.ts`

현재 저장은 `src/auth/token-store.ts:46-72`에서 새 객체를 만들어 unknown 키를 버리고 직접 `writeFileSync`한다. refresh는 `src/auth/token-store.ts:92-149`에서 동시성 fence 없이 바로 저장한다.

변경 후 핵심 공개 API:

```ts
export interface BearerSnapshot {
  token: string;
  accountKey: string;
  generation: string;
}
export interface GetValidBearerOptions {
  forceRefresh?: boolean;
  rejectedAccessToken?: string;
  signal?: AbortSignal;
  deps?: TokenStoreDeps;
}
export function loadTokens(): TokenData | null;
export function saveTokens(input: SaveTokenInput): Promise<void>;
export function deleteTokens(): void;
export function getValidBearer(options?: GetValidBearerOptions): Promise<string>;
export function getValidBearerSnapshot(options?: GetValidBearerOptions): Promise<BearerSnapshot>;
export function saveTokensFromOAuthPayload(payload: OAuthTokenPayload, context: { tokenEndpoint: string }): Promise<void>;
```

세대와 계정 키는 디스크에 쓰지 않는다.

```ts
function credentialGeneration(tokens: TokenData): string {
  return createHash("sha256").update(JSON.stringify([
    tokens.accessToken, tokens.refreshToken ?? null,
    tokens.expiresAt ?? null, tokens.tokenEndpoint ?? null,
  ])).digest("hex");
}

function accountKey(tokens: TokenData): string {
  if (tokens.accountId) return `sub:${tokens.accountId}`;
  if (tokens.email) return `email:${tokens.email.toLowerCase()}`;
  return `credential:${createHash("sha256").update(tokens.refreshToken ?? tokens.accessToken).digest("hex")}`;
}
```

저장은 기존 레코드를 merge하고 atomic rename한다.

```ts
function writeTokensAtomic(next: TokenData): void {
  ensureConfigDir();
  const tmp = `${AUTH_FILE}.tmp-${randomBytes(6).toString("hex")}`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, AUTH_FILE);
}

async function persistIfGeneration(
  expectedGeneration: string,
  fresh: TokenData,
): Promise<{ kind: "persisted"; tokens: TokenData } | { kind: "superseded"; tokens: TokenData }> {
  const current = loadTokens();
  if (!current) throw new AuthRequiredError("Stored xAI session disappeared during refresh");
  if (credentialGeneration(current) !== expectedGeneration) return { kind: "superseded", tokens: current };
  const merged = { ...current, ...fresh };
  if (fresh.expiresAt === undefined) delete merged.expiresAt;
  writeTokensAtomic(merged);
  return { kind: "persisted", tokens: merged };
}
```

`token-manager.ts`의 singleflight map은 `Map<accountKey, {generation, startedAt, promise}>`다. 기존 flight가 120초 이내이고 같은 generation이면 join한다. 다른 generation이면 새 디스크 세대를 다시 읽고 새 flight를 만든다. terminal cache 키는 `${accountKey}\0${generation}`다. refresh 성공 시 그 키를 삭제한다. `token-store.ts`의 기본 facade와 WP14가 직접 만드는 manager가 모두 이 같은 factory 상태 배치를 사용한다.

manager의 비공개 `resolveValidBearer`와 이를 쓰는 `getValidBearerSnapshot` 호환 facade의 순서는 반드시 다음과 같다.

1. 매 호출마다 디스크를 다시 읽는다.
2. `rejectedAccessToken`과 현재 access token이 다르면 현재 snapshot을 즉시 반환한다.
3. force가 아니고 `now + skew < expiresAt`, 또는 `expiresAt`이 없으면 현재 토큰을 반환한다.
4. refresh token/token endpoint가 없으면 `AuthRequiredError`.
5. 동일 계정·세대 terminal cache가 살아 있으면 upstream 호출 없이 `AuthRequiredError`.
6. 계정별 flight를 join하거나 새 refresh를 실행한다.
7. refresh 결과를 `persistIfGeneration`으로 저장한다. superseded면 새 디스크 토큰을 반환한다.

`expires_in`이 없으면 이전 `expiresAt`을 상속하지 않고 삭제한다. 새 refresh token이 없으면 기존 refresh token을 보존한다. ID token의 JWT payload는 표시용 `sub`/`email` 추출에만 쓰고 권한 판단에는 쓰지 않는다.

### 6.9 MODIFY `tests/auth.test.ts`

현재 하나의 장시간 테스트 `tests/auth.test.ts:55-172`를 다음 독립 테스트로 분리한다.

- 기존 camelCase JSON을 그대로 읽는다.
- `accountId`와 임의 `futureField`가 refresh/save round-trip 뒤 남는다.
- 임시 파일 publish 후 파일 mode가 POSIX에서 0600이다.
- 같은 계정의 동시 20개 호출은 token endpoint를 1회 호출한다.
- 서로 다른 accountKey 두 개는 서로의 flight를 join하지 않는다.
- refresh 도중 외부에서 새 세대를 쓰면 늦은 결과가 덮지 않고 외부 토큰을 반환한다.
- 만료 121초 전에는 refresh하지 않고 119초 전에는 refresh한다.
- 429의 `Retry-After: 0.01`은 재시도하고, 61초는 sleep 없이 오류를 반환한다.
- terminal 세 오류는 30초 동안 두 번째 요청을 막지만 파일을 삭제하지 않는다.
- 500/네트워크는 최대 3회, timeout/caller abort는 재시도하지 않는다.
- `withBearer401Replay`는 첫 401에만 discard/refresh/send를 한 번 수행하고 두 번째 401을 그대로 반환한다.
- 거부 토큰 A 뒤 디스크가 B로 바뀌었으면 refresh 없이 B로 replay한다.
- PKCE loopback/manual과 device-code가 모두 동일 `saveTokensFromOAuthPayload` 경로를 사용한다.

테스트는 실제 홈 디렉터리와 실제 xAI endpoint를 사용하지 않는다. `TokenRequestDeps`와 임시 `homeDir`/AUTH_FILE 주입을 사용한다.

## 7. 구현 순서

1. 상수와 typed token client를 추가하고 retry 단위 테스트를 먼저 통과시킨다.
2. token store의 읽기/atomic write/unknown-key 보존을 구현한다.
3. `token-manager.ts`에 generation/account key와 singleflight/terminal cache를 구현하고 token store facade를 연결한다.
4. PKCE와 device-code의 직접 fetch를 token client로 교체한다.
5. bearer 401 helper를 추가하고 WP6이 사용할 공개 경계를 고정한다.
6. 기존 CLI 계약 테스트와 전체 테스트를 실행한다.

## 8. 검증 명령

```bash
cd /Users/jun/Developer/progrok
node --test --test-concurrency=1 --import tsx --experimental-test-module-mocks tests/auth.test.ts
npm run typecheck
npm test
npm run build
```

수동 호환 검사는 임시 HOME에서 수행하고 실제 credential을 출력하지 않는다.

```bash
tmp_home="$(mktemp -d)"
HOME="$tmp_home" node dist/index.js status
test ! -e "$tmp_home/.progrok/auth.json"
rm -rf "$tmp_home"
```

## 9. 완료 조건

- 위 네 명령이 exit 0이다.
- 테스트가 singleflight 호출 수 1, stale generation 비덮어쓰기, terminal 세 오류, 401 최대 1회 replay를 수치로 단언한다.
- `auth.json` fixture의 기존 키와 unknown 키가 모두 보존되고 token 문자열은 테스트 출력에 나타나지 않는다.
- 세 로그인 진입점과 기존 CLI 명령명이 그대로다.
- `/health`, `/v1/*`, 포트 기본값은 이 단계 diff에 없다.
- 실제 xAI 계정 로그인이 필요한 live smoke는 WP14에서 수행하며, 이 단계 완료 주장에 포함하지 않는다.
