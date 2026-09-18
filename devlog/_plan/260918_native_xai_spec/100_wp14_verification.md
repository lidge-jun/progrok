# WP14 — 네이티브 xAI 재작성 검증

## 목적과 진입 조건

이 단계는 wp5–wp13이 만든 인증, 전송, wire 파서, Voice, REST surface,
프록시, CLI, 웹앱을 독립 오라클로 검증한다. 테스트를 통과시키기 위해 제품 코드에
`NODE_ENV === "test"` 분기나 테스트 전용 export를 추가하지 않는다. 필요한 주입점은
wp5–wp13의 공개 경계에 있어야 하며, 없다면 소유 단계로 되돌려 보완한다.

진입 조건은 다음과 같다.

- `src/auth/`, `src/transport/`, `src/wire/`, `src/voice/`, `src/surfaces/`,
  `src/proxy/`, `src/web/`가 구현돼 있다.
- 각 모듈의 public export와 오류 타입이 확정돼 있다.
- `npm run typecheck`가 성공한다.
- 단위 테스트는 외부 네트워크를 사용하지 않는다. 라이브 호출은 이 문서의 opt-in
  smoke 스크립트에서만 수행한다.

## 현재 검증 기반 감사

현재 `scripts/run-tests.mjs`는 `tests/` 바로 아래의 `*.test.ts`를 정렬하고
Node test runner를 `--test-concurrency=1 --import tsx`로 실행한다. 새 테스트도 모두
`tests/` 바로 아래에 두므로 runner의 탐색 규칙은 그대로 쓸 수 있다. 공용 fixture만
`tests/helpers/`에 두며 파일명에 `.test.ts`를 붙이지 않는다.

현재 일곱 테스트의 처리 방침은 다음과 같다.

| 현재 파일 | 판정 | WP14 처리 |
|---|---|---|
| `tests/auth.test.ts` | auth 파일 경로와 저장/삭제는 검증하지만 refresh 동시성, 세대 안전성, 원자 저장, 실패 보존은 없음 | MODIFY |
| `tests/cli-skill-contract.test.ts` | prose 정규식 검사가 많아 동작 오라클로 약함 | MODIFY: 동적 capabilities/등록 command의 값 비교로 축소 |
| `tests/composer-inject.test.ts` | 순수 변환 동작을 구체적으로 검증 | 유지, 새 canonical 변환과 중복되면 소유 모듈 테스트로 이동 |
| `tests/image.test.ts` | Commander 옵션 표면 검증 | 유지 |
| `tests/proxy.test.ts` | 실제 upstream으로 나갈 수 있고 마지막 테스트는 `assert.ok(true)`라 무의미 | MODIFY: 완전한 local fake transport 계약 테스트로 교체 |
| `tests/search.test.ts` | 요청 빌더/응답 추출의 구체 결과 검증 | 유지 |
| `tests/video.test.ts` | CLI 옵션과 파싱 검증 | 유지 |

`tests/proxy.test.ts:128-132`의 마지막 테스트는 구현을 삭제해도 통과한다. 주석의
주장을 `assert.ok(true)`로 되풀이할 뿐 경로, 메서드, query, body, header, 응답을
관찰하지 않는다. 이 테스트는 삭제하고 fake xAI 서버가 받은 요청을 검증하는
통합 테스트로 대체한다. 현재 `GET /v1/unknown-path`도 실환경 `api.x.ai`에 연결될 수
있으므로 같은 fake로 바꾼다.

## 변경 명세

### NEW — `tests/helpers/fake-xai.ts`

네트워크 경계를 흉내 내되 제품 파서나 제품 header builder를 기대값 계산에 재사용하지
않는다. 실제 TypeScript 골격은 아래와 같다.

```ts
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  pathname: string;
  search: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface FakeReply {
  status?: number;
  headers?: Record<string, string>;
  chunks?: Array<string | Uint8Array>;
}

export interface FakeXaiServer {
  baseUrl: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export async function startFakeXai(
  reply: (request: RecordedRequest) => FakeReply | Promise<FakeReply>,
): Promise<FakeXaiServer> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const url = new URL(req.url ?? "/", "http://fake.invalid");
    const recorded: RecordedRequest = {
      method: req.method ?? "GET",
      pathname: url.pathname,
      search: url.search,
      headers: req.headers,
      body: Buffer.concat(chunks),
    };
    requests.push(recorded);
    const out = await reply(recorded);
    res.writeHead(out.status ?? 200, out.headers ?? {});
    for (const chunk of out.chunks ?? []) res.write(chunk);
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())),
  };
}
```

완료 조건:

- port 0만 사용하고 고정 포트, sleep, 재시도에 의존하지 않는다.
- 요청 body는 byte 그대로 기록한다.
- 응답 chunk 경계를 호출자가 결정할 수 있다.

### MODIFY — `tests/auth.test.ts`

Before:

```ts
it("validates auth constants and stateful auth utilities sequentially", async () => {
  // 저장, 로드, 삭제를 한 테스트에서 순차 검증
});
```

After:

```ts
describe("auth file compatibility", () => {
  it("reads the existing ~/.progrok/auth.json schema without migration", async () => {});
  it("writes mode 0600 and replaces the file atomically", async () => {});
  it("preserves refreshToken and tokenEndpoint when refresh omits them", async () => {});
  it("leaves the previous credential readable when persistence fails", async () => {});
});
```

구체 오라클:

- ima2-gen v3.16.1과 공유하는 키 `accessToken`, `refreshToken`, `expiresAt`,
  `tokenEndpoint`, `email`, `idToken`을 입력 fixture로 직접 작성하고 읽기 결과를 비교한다.
- 저장 후 `statSync(authFile).mode & 0o777 === 0o600`을 검증한다.
- 쓰기 실패를 주입했을 때 기존 JSON이 truncation되지 않았음을 byte 비교한다.

### NEW — `tests/auth-refresh.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTokenManager } from "../src/auth/token-manager.js";

describe("TokenManager", () => {
  it("coalesces concurrent refreshes into one token request", async () => {});
  it("does not let an older refresh overwrite a newer generation", async () => {});
  it("returns the fresh token without refreshing before the skew window", async () => {});
  it("maps invalid_grant to re-login without printing token response bodies", async () => {});
  it("propagates AbortSignal to discovery and refresh fetches", async () => {});
});
```

필수 구현 시그니처는 다음과 같이 고정한다.

```ts
export interface TokenManagerDependencies {
  now(): number;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  load(): TokenData | null;
  save(input: SaveTokenInput): Promise<void>;
}

export function createTokenManager(
  dependencies: TokenManagerDependencies,
): { getValidBearer(signal?: AbortSignal): Promise<string> };
```

### NEW — `tests/transport.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveUpstreamUrl } from "../src/transport/base-url.js";
import { buildUpstreamHeaders } from "../src/transport/headers.js";
import { classifyRetry } from "../src/transport/retry.js";
import { executeRequest } from "../src/transport/fetch.js";

describe("transport", () => {
  it("routes every public API and Voice path to api.x.ai", () => {});
  it("keeps cli-chat-proxy behind explicit opt-in", () => {});
  it("drops hop-by-hop and caller authorization headers", () => {});
  it("never places bearer values in typed errors", () => {});
  it("retries a pre-header network failure once", async () => {});
  it("does not retry 4xx, aborts, or failures after headers commit", async () => {});
  it("propagates abort to the active fetch", async () => {});
});
```

`classifyRetry`의 입력은 서로 다른 값으로 만든다. 예를 들어
`phase: "before_headers"`, `phase: "streaming"`, `aborted: true`가 모두 같은 기본값을
공유하지 않아야 한다.

### NEW — `tests/wire-sse.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeSse } from "../src/wire/sse.js";

describe("decodeSse", () => {
  it("decodes a UTF-8 code point split across byte chunks", async () => {});
  it("joins multi-line data and ignores comments", async () => {});
  it("accepts CRLF and LF frame boundaries", async () => {});
  it("flushes the final complete frame without a trailing blank line", async () => {});
  it("emits a typed protocol error for invalid event framing", async () => {});
  it("stops after the first terminal event", async () => {});
});
```

fixture의 expected event는 제품 parser로 생성하지 않고 literal로 적는다. byte chunk는
한 글자 단위, UTF-8 중간, `data:` 중간처럼 서로 다른 경계로 분할한다.

### NEW — `tests/wire-chat-stream.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reduceChatChunk } from "../src/wire/chat-stream.js";

describe("reduceChatChunk", () => {
  it("maps role, content, reasoning_content and finish_reason", () => {});
  it("assembles interleaved tool-call indexes without cross-talk", () => {});
  it("rejects an unknown wire shape instead of casting it", () => {});
  it("treats the first finish signal as terminal", () => {});
});
```

### NEW — `tests/wire-responses-stream.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reduceResponseEvent } from "../src/wire/responses-stream.js";

describe("reduceResponseEvent", () => {
  it("maps text, reasoning, citation and usage events", () => {});
  it("preserves xAI context_details and cost_in_usd_ticks", () => {});
  it("assembles function and MCP argument deltas", () => {});
  it("surfaces response.failed and response.incomplete as typed errors", () => {});
  it("ignores EOF as success when no terminal event arrived", () => {});
});
```

### NEW — `tests/wire-tool-calls.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolCallAssembler } from "../src/wire/tool-calls.js";

describe("ToolCallAssembler", () => {
  it("assembles fragmented JSON arguments by call id", () => {});
  it("keeps concurrently interleaved calls independent", () => {});
  it("rejects duplicate terminal events", () => {});
  it("returns a typed invalid-json error with no raw secret-bearing body", () => {});
});
```

### NEW — `tests/voice-rest.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTtsClient } from "../src/voice/tts.js";
import { createSttClient } from "../src/voice/stt.js";

describe("Voice REST", () => {
  it("serializes TTS output_format as an object", async () => {});
  it("returns audio bytes and preserves content-type", async () => {});
  it("puts multipart STT file after every metadata field", async () => {});
  it("supports URL STT without creating multipart", async () => {});
  it("rejects simultaneous file and url inputs", async () => {});
  it("propagates 401, 403, 422 and 429 as distinct typed errors", async () => {});
});
```

### NEW — `tests/voice-ws.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSttSession } from "../src/voice/ws-client.js";
import { reduceRealtimeEvent } from "../src/voice/realtime.js";

describe("Voice WebSocket", () => {
  it("encodes bearer auth for server-side clients", async () => {});
  it("uses xai-client-secret subprotocol for browser credentials", async () => {});
  it("sends binary STT audio and finalize/audio.done controls", async () => {});
  it("treats speech_final partial text as final when transcript.done is empty", async () => {});
  it("maps close 1006 after speech_final to completed-with-transport-close", async () => {});
  it("maps realtime session, audio, tool, MCP, DTMF and terminal events", () => {});
  it("responds to ping with pong and preserves ping_timestamp", async () => {});
  it("aborts and removes listeners without reconnecting mid-stream", async () => {});
});
```

WebSocket test server는 port 0을 사용한다. timer sleep 대신 `once(server, "listening")`,
message promise, close promise를 사용한다.

### NEW — `tests/surfaces.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSurfaceClient } from "../src/surfaces/index.js";

describe("REST surfaces", () => {
  it("serializes responses, compact and input_items paths", async () => {});
  it("treats deferred chat HTTP 202 as queued, not error", async () => {});
  it("preserves multipart and binary bodies without JSON parsing", async () => {});
  it("covers batches, files, collections, embeddings, skills and models", async () => {});
  it("relays an unknown future /v1 path through the validated passthrough", async () => {});
  it("never sends management-api credentials to api.x.ai", async () => {});
});
```

테이블 기반 case는 각 row에 `method`, `path`, `request`, `expectedStatus`를 literal로
둔다. 구현의 route registry를 expected 목록으로 재사용하지 않는다.

### MODIFY — `tests/proxy.test.ts`

Before:

```ts
it("proxy has no path whitelist — all /v1/* paths are forwarded", () => {
  assert.ok(true, "Proxy forwards all /v1/* paths to xAI without filtering");
});
```

After:

```ts
it("forwards an unknown /v1 path with method, query and body intact", async () => {
  const fake = await startFakeXai(() => ({
    status: 207,
    headers: { "content-type": "application/octet-stream" },
    chunks: [Buffer.from([0, 1, 2, 255])],
  }));
  const app = createProxyApp({ apiBaseUrl: fake.baseUrl, getBearer: async () => "unit-token" });
  // local app on port 0, POST /v1/future/path?a=1&a=2 with binary body
  // assert fake.requests[0] exact method/path/search/body
  // assert upstream authorization is Bearer unit-token and caller placeholder is absent
  // assert response status 207 and bytes [0, 1, 2, 255]
  await fake.close();
});
```

추가 case:

- auth가 없으면 fake upstream 요청 수가 0이고 안전한 401 envelope를 반환한다.
- SSE chunk가 분리된 순서대로 전달되고 terminal 뒤 데이터는 전달하지 않는다.
- 요청 abort가 upstream AbortSignal로 전파된다.
- 100 MB 한계를 1 byte 넘으면 upstream 요청 없이 413이다.
- `upgrade` 경로가 `/v1/responses`, `/v1/realtime`, `/v1/stt`, `/v1/tts`만 WS
  handler로 넘기고 다른 path는 닫는다.

### NEW — `tests/webapp.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWebApp } from "../src/web/server.js";

describe("web app", () => {
  it("serves the app and immutable hashed assets", async () => {});
  it("does not serialize OAuth bearer or refresh tokens into HTML", async () => {});
  it("mints a short-lived same-origin websocket session", async () => {});
  it("rejects an untrusted Origin and expired websocket session", async () => {});
  it("supports one text response and one realtime voice connection", async () => {});
});
```

브라우저 렌더링 smoke는 wp13의 UI 테스트가 소유한다. WP14는 서버 계약과 secret
비노출을 검증하고, 사이트가 제공하는 observable 상태를 사용한다.

### MODIFY — `tests/cli-skill-contract.test.ts`

Before:

```ts
assert.match(skill, /grok-4\.3/);
assert.match(skill, /web_search/);
assert.match(skill, /x_search/);
```

After:

```ts
const capabilities = buildCapabilities();
assert.equal(capabilities.auth.file, AUTH_FILE);
assert.deepEqual(
  capabilities.websockets.map((item) => item.path).sort(),
  ["/v1/realtime", "/v1/responses", "/v1/stt", "/v1/tts"],
);
assert.equal(capabilities.webApp.url, "http://127.0.0.1:18646");
```

파일 존재와 frontmatter parse는 유지하되, prose 문구 존재 검사는 동적 metadata와
비교 가능한 필드만 남긴다.

### NO CHANGE — `scripts/run-tests.mjs`

새 `*.test.ts`는 모두 `tests/` 바로 아래에 있으므로 현재 탐색 규칙이 자동으로 포함한다.
테스트 폴더를 재귀화하거나 별도 glob 라이브러리를 추가하지 않는다. 다음 자체 계약만
새 테스트 중 하나에서 검증한다.

```ts
const names = readdirSync("tests").filter((name) => name.endsWith(".test.ts"));
assert(names.includes("voice-ws.test.ts"));
assert(names.includes("webapp.test.ts"));
```

### NEW — `scripts/live-oauth-smoke.ts`

이 스크립트만 실제 `~/.progrok/auth.json`을 읽고 xAI에 연결한다. 실행에는
`PROGROK_LIVE_SMOKE=1`이 필요하다. credential, Authorization header, client secret,
원문 응답 body, transcript 원문, signed URL을 stdout/stderr/결과 파일에 기록하지 않는다.

```ts
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { getValidBearer } from "../src/auth/token-store.js";
import { createTtsClient } from "../src/voice/tts.js";
import { createSttClient } from "../src/voice/stt.js";
import { createSttSession } from "../src/voice/ws-client.js";
import { createRealtimeClient } from "../src/voice/realtime.js";

type SmokeName = "tts" | "stt_batch" | "stt_stream" | "realtime_client_secret";

interface SmokeResult {
  name: SmokeName;
  ok: boolean;
  status?: number;
  durationMs: number;
  contentType?: string;
  byteLength?: number;
  sha256?: string;
  terminalEvent?: string;
  errorCode?: string;
}

interface SmokeReport {
  schemaVersion: 1;
  startedAt: string;
  finishedAt: string;
  results: SmokeResult[];
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeFailure(name: SmokeName, started: number, error: unknown): SmokeResult {
  const code = error instanceof Error && "code" in error
    ? String((error as Error & { code?: unknown }).code ?? "unknown_error")
    : "unknown_error";
  return { name, ok: false, durationMs: Date.now() - started, errorCode: code };
}

async function main(): Promise<void> {
  if (process.env["PROGROK_LIVE_SMOKE"] !== "1") {
    throw new Error("Set PROGROK_LIVE_SMOKE=1 to authorize paid live smoke calls.");
  }
  const startedAt = new Date().toISOString();
  const bearer = await getValidBearer();
  const results: SmokeResult[] = [];

  // 1. TTS: fixed harmless sentence -> PCM bytes; record type/size/hash only.
  // 2. Batch STT: submit generated audio; assert non-empty text in memory only.
  // 3. Streaming STT: send PCM as binary frames, then finalize/audio.done;
  //    accept speech_final partial as terminal and record event name only.
  // 4. realtime client_secret: assert value is non-empty and expires_at is future;
  //    never return or log value. Optionally open and close one realtime session.

  void bearer; // consumed only by clients; never interpolated into logs.
  const report: SmokeReport = {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  };
  await mkdir(".tmp", { recursive: true });
  await writeFile(".tmp/native-xai-smoke.json", `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

await main();
```

구현 시 `safeFailure`는 raw `error.message`, stack, request URL을 출력하지 않는다.
Voice client가 반환하는 typed `code`, HTTP status, event type만 허용한다. script 종료 후
메모리의 bearer와 client secret을 다른 객체에 보관하지 않는다.

## 라이브 smoke 절차

라이브 smoke는 유료·외부 상태를 쓰므로 일반 `npm test`에 포함하지 않는다.

```bash
PROGROK_LIVE_SMOKE=1 npx tsx scripts/live-oauth-smoke.ts
```

필수 판정:

| probe | 성공 조건 | 기록 가능 값 |
|---|---|---|
| TTS REST | HTTP 200, `audio/*`, byteLength > 0 | status, contentType, byteLength, SHA-256 |
| STT batch | HTTP 200, in-memory transcript 비어 있지 않음 | status, duration, transcriptLength만 |
| STT streaming | `speech_final=true` 또는 `transcript.done`, 오류 event 없음 | terminal event 이름, duration |
| realtime client_secret | HTTP 200, non-empty `value`, 미래 `expires_at` | status, expiresInSeconds만 |

로그 비노출 검증:

```bash
PROGROK_LIVE_SMOKE=1 npx tsx scripts/live-oauth-smoke.ts >.tmp/smoke.stdout 2>.tmp/smoke.stderr
node -e 'const fs=require("fs"); const a=JSON.parse(fs.readFileSync(process.env.HOME+"/.progrok/auth.json","utf8")); const s=fs.readFileSync(".tmp/smoke.stdout","utf8")+fs.readFileSync(".tmp/smoke.stderr","utf8"); for (const k of [a.accessToken,a.refreshToken,a.idToken].filter(Boolean)) if (s.includes(k)) process.exit(1)'
```

위 명령은 token 값을 화면에 출력하지 않고 일치 여부만 exit code로 판정한다.

## 검증 명령

```bash
npm run typecheck
npm test
npm run build
npm --prefix site run build
PROGROK_LIVE_SMOKE=1 npx tsx scripts/live-oauth-smoke.ts
git diff --check
```

단위 테스트를 red-green으로 구현한다. 각 새 suite는 대상 export를 stub으로 바꾸거나 핵심
분기를 의도적으로 깨뜨렸을 때 적어도 한 테스트가 실패하는지 한 번 확인한다. 그 확인을
위해 test assertion을 삭제하거나 snapshot을 현재 출력으로 갱신하지 않는다.

## 완료 조건

- 현재 7개 테스트와 새 auth/transport/wire/voice/surfaces/proxy/web 테스트가 실패 0이다.
- 기본 test run은 외부 네트워크, 사용자 credential, 고정 포트에 의존하지 않는다.
- `tests/proxy.test.ts`에 `assert.ok(true)` 또는 동등한 무행동 단언이 없다.
- malformed wire, abort, timeout, 4xx/429, mid-stream failure, terminal 중복, secret
  redaction의 negative case가 있다.
- OAuth 라이브 smoke 네 항목이 성공하고 `.tmp/native-xai-smoke.json`에는 credential,
  transcript 원문, 응답 body, signed URL이 없다.
- typecheck, test, build, site build, `git diff --check`가 모두 exit 0이다.
