# WP13 — 작동하는 로컬 웹앱

## 0. 문서 계약

- 상태: 구현 전 diff-level PRD
- 선행 단계: wp10(Voice WS/realtime과 browser-safe `src/voice/protocol.ts`) 완료, wp8의 네이티브 `createProxyApp()` 사용 가능
- 구현 범위: 로컬 브라우저 앱, 브라우저용 빌드, 정적 자산 패키징, 웹앱 회귀 테스트
- 제외 범위: 공개 문서/사이트/skill 동기화(wp15), 릴리스/푸시(wp16), SIP UI, custom voice 관리, 이미지·비디오 편집/연장 UI
- 변경 금지: `~/.progrok/auth.json` 스키마, 장기 OAuth 토큰의 브라우저 노출, xAI WS를 로컬 서버가 중계하는 새 프록시

이 단계의 완료 상태는 `progrok chat` 한 명령으로 같은 origin의 REST 프록시와 정적 웹앱이 뜨고, 브라우저에서 다음 네 경로가 실제로 작동하는 것이다.

1. `POST /v1/responses` SSE 채팅: 출력 텍스트, reasoning summary, 모든 tool item의 상태/인자/결과를 구분해 표시한다.
2. `GET /v1/models` 결과만으로 채팅 모델 선택기를 만든다. 정적 모델 fallback은 두지 않는다.
3. 마이크 입력을 직접 xAI WebSocket에 연결한다. STT와 realtime은 별도 모드이며, 장기 OAuth 토큰은 브라우저에 오지 않는다.
4. 이미지 생성은 즉시 결과를 표시하고, 비디오는 `request_id`를 받아 `GET /v1/videos/{request_id}`를 terminal 상태까지 폴링한다.

근거는 `000_plan.md:5-8,26-33,64-88`, `001_endpoint_inventory.md:19-25,35-40,54-86,88-103,105-131`, `002_x_only_voice_research.md:38-103,135-164,209-236`, `003_cookbook_grokbuild_research.md:45-200,205-307`이다.

## 1. 현재 상태와 구조 판정

### 1.1 확인된 현재 구현

- `src/chat/server.ts:11-43`은 `createProxyApp()` 위에 `dist/public`을 얹고 브라우저를 연다.
- `src/chat/public/app.js:29-90`은 최대 50개 세션을 `localStorage`에 저장한다.
- `src/chat/public/app.js:245-431`은 `/v1/responses`를 호출하지만 SSE를 줄 단위로만 쪼개고, malformed event를 조용히 버리며, terminal 실패/중단 상태를 구분하지 않는다.
- `src/chat/public/app.js:343-415`은 search item만 별도 표현하고 reasoning은 누적만 한 뒤 화면에 그리지 않는다.
- `src/chat/public/app.js:473-511`은 정적 모델 목록을 먼저 넣고 `/v1/models` 실패 시 그대로 사용한다. 이는 런타임 카탈로그가 권위라는 `000_plan.md:40`과 충돌한다.
- `src/chat/public/index.html:8,44`와 `app.js:1`은 CDN 스크립트/스타일에 의존한다. 오프라인 npm 설치와 엄격한 CSP에서 같은 앱을 보장하지 못한다.
- `src/chat/public/app.js`는 529줄, `style.css`는 392줄이다. Voice와 미디어를 한 파일에 추가하면 UI 상태, wire parsing, audio lifecycle, rendering이 한 소유자에 섞인다.
- `package.json:9-14`는 `dist` 전체를 npm package에 포함하고, `package.json:18`과 `scripts/copy-public.mjs:1-4`가 정적 자산을 `dist/public`에 복사한다.

### 1.2 구조 결정

선택: **프레임워크를 추가하지 않고 vanilla TypeScript ESM을 tsup으로 번들한다.** 서버는 `src/web/server.ts`, 브라우저 코드는 `src/web/client/`, 복사 대상 HTML/CSS는 `src/web/public/`이 소유한다.

이유:

- 화면은 단일 route, 세 개의 작업 탭(Chat/Voice/Media), 로컬 상태뿐이다. React/Vue/Svelte를 추가해도 routing, SSR, 복잡한 component composition 이득이 없다.
- 어려운 부분은 DOM 선언이 아니라 SSE/WS/audio/polling 상태기계다. 이를 작은 TypeScript 모듈로 분리하면 프레임워크 없이도 타입과 테스트 seam을 얻는다.
- 기존 Node tsup과 `copy-public`을 유지한다. 별도 browser tsup config만 추가하므로 npm package 구조와 CLI 실행 모델을 바꾸지 않는다.
- CDN `marked`/highlight.js는 제거한다. v1 웹앱은 외부 HTML을 주입하지 않고 DOM API로 paragraph, fenced code, link만 안전하게 렌더링한다. 완전한 Markdown 확장은 별도 요구다.

기각:

- 기존 `app.js`에 계속 추가: 500줄을 넘은 단일 파일에 세 개의 비동기 상태기계를 합치므로 기각한다.
- React/Vite 신규 앱: 새 runtime/dependency/build graph를 도입하지만 이 단계의 단일 route에서 얻는 이득이 작아 기각한다.
- 로컬 서버가 xAI WS를 중계: OAuth 토큰은 감출 수 있지만 binary audio backpressure와 이중 연결 lifecycle을 새로 소유하게 된다. xAI가 제공하는 ephemeral browser flow를 우회하므로 기각한다.
- CDN 유지: package만으로 재현되지 않고 CSP에 외부 origin을 열어야 하므로 기각한다.

### 1.3 목표 구조와 의존 방향

```text
src/commands/chat.ts
  -> src/web/server.ts
       -> src/proxy/server.ts (same-origin REST)
       -> dist/public/*       (정적 앱)

src/web/client/app.ts
  -> chat.ts -> api.ts -> same-origin /v1/responses, /v1/models
  -> voice.ts -> ../../voice/protocol.ts (wp10의 event/control 타입과 parser)
             -> api.ts -> same-origin POST /v1/realtime/client_secrets
                        -> direct wss://api.x.ai/v1/stt|realtime
  -> media.ts -> api.ts -> same-origin image/video REST

response-state.ts는 DOM/네트워크를 import하지 않는다.
pcm-worklet.ts는 AudioWorklet 전용 entry이며 app bundle을 import하지 않는다.
```

공개 경계는 `startWebApp()`와 CLI `progrok chat`뿐이다. client 내부 barrel은 만들지 않는다.

## 2. 보안 모델과 browser Voice 계약

### 2.1 위협 모델

| 항목 | 판정 |
|---|---|
| 보호 자산 | 장기 OAuth access/refresh token, 5분짜리 ephemeral token, 마이크 audio, transcript, 생성 media URL |
| 진입점 | same-origin REST, direct xAI WS, `localStorage`, microphone permission, media prompt/form |
| 신뢰 경계 | browser ↔ local progrok, local progrok ↔ xAI REST, browser ↔ xAI WS |
| 공격자 | 악성 웹페이지, LAN에서 노출된 `--host 0.0.0.0` listener, XSS payload가 포함된 model output, 탈취된 짧은 token |
| 핵심 통제 | 기본 loopback, CSP, DOM `textContent`, OAuth 비노출, ephemeral token 비저장, token을 URL/query/log에 넣지 않음, microphone 명시 동의 |

`progrok chat --host 0.0.0.0`은 기존 허용을 유지하되 CLI에 경고한다. HTTP LAN origin은 secure context가 아니므로 browser microphone이 막힐 수 있다. UI는 `window.isSecureContext`와 `navigator.mediaDevices`를 확인하고 Voice 시작 버튼을 비활성화한다. 이 단계에서 새로운 원격 인증 체계를 만들지 않는다.

### 2.2 ephemeral token과 WebSocket 순서

STT와 realtime 모두 아래 순서를 지킨다. 두 socket을 동시에 열지 않으며 모드 전환 시 기존 socket/audio graph를 먼저 닫는다.

1. 사용자가 `Start`를 눌러 microphone 권한을 승인한다.
2. browser가 same-origin `POST /v1/realtime/client_secrets`에 `{"expires_after":{"seconds":300}}`을 보낸다. local proxy가 서버 쪽 OAuth를 주입한다.
3. 응답 `{ value, expires_at }`은 함수 지역/`VoiceController` 메모리에만 둔다. `localStorage`, `sessionStorage`, URL, DOM, console에 쓰지 않는다.
4. browser는 custom Authorization header를 시도하지 않는다. 정확히 다음 생성자를 사용한다.

```ts
new WebSocket(url, [`xai-client-secret.${secret.value}`]);
```

5. `close` 후 재연결할 때 기존 secret을 재사용하지 않고 2번부터 다시 수행한다.
6. Realtime session resumption은 secret과 별개다. 메모리의 `conversation_id`만 query에 넣고, 새 secret으로 연결한 뒤 `session.update`에서 `resumption.enabled: true`를 다시 보낸다.

STT URL:

```text
wss://api.x.ai/v1/stt?encoding=pcm&sample_rate=16000&interim_results=true&endpointing=400
```

- AudioWorklet이 mono PCM16 little-endian 16 kHz `ArrayBuffer`를 binary frame으로 보낸다.
- `transcript.partial.text`를 draft로 보이고 `speech_final=true`면 final transcript로 승격한다.
- 라이브 관측상 `transcript.done.text`가 빈 문자열일 수 있으므로 done을 final text 권위자로 가정하지 않는다.
- 사용자가 `Finish utterance`를 누르면 `{"type":"finalize"}`, 전체 중지를 누르면 `{"type":"audio.done"}`를 보낸 뒤 drain하고 닫는다.

Realtime URL:

```text
wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-2.0[&conversation_id=...]
```

- 기본 voice model은 변경 가능한 alias가 아니라 research에서 확인한 pinned ID를 쓴다. 사용자는 advanced field에서 다른 model ID를 입력할 수 있다.
- input/output은 PCM16 24 kHz binary transport다. text frame은 JSON event, binary frame은 assistant audio로 분기한다.
- open 직후 아래 `session.update`를 보낸다.

```json
{
  "type": "session.update",
  "session": {
    "voice": "eve",
    "reasoning": { "effort": "high" },
    "turn_detection": {
      "type": "server_vad",
      "threshold": 0.85,
      "silence_duration_ms": 500,
      "prefix_padding_ms": 333,
      "idle_timeout_ms": 10000
    },
    "audio": {
      "input": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "transport": "binary",
        "transcription": { "model": "grok-transcribe" }
      },
      "output": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "transport": "binary",
        "speed": 1
      }
    },
    "resumption": { "enabled": true }
  }
}
```

- `ping`에는 `{"type":"pong","ping_timestamp":event.timestamp}`로 답한다.
- `conversation.created`의 id를 메모리에 저장한다.
- `conversation.item.input_audio_transcription.updated|completed`는 사용자 transcript, `response.output_audio_transcript.delta|done`은 assistant transcript다.
- `input_audio_buffer.speech_started` 시 예약된 assistant playback을 즉시 취소해 barge-in을 반영한다.
- `response.cancelled`은 사용자 중단, `error`는 실패로 서로 다르게 표시한다.

## 3. 파일 매니페스트

| 상태 | 정확한 경로 | 책임 |
|---|---|---|
| MODIFY | `package.json` | browser build script 연결 |
| MODIFY | `scripts/copy-public.mjs` | 복사 원본을 `src/web/public`으로 이전하고 stale 정적 파일 제거 |
| MODIFY | `src/commands/chat.ts` | 새 server import, 기능 설명, non-loopback 경고 |
| NEW | `tsup.web.config.ts` | browser app/worklet 두 entry 번들 |
| NEW | `src/web/server.ts` | 정적 앱, CSP/보안 header, CLI listener |
| NEW | `src/web/client/contracts.ts` | browser 상태와 xAI view contract의 SSOT |
| NEW | `src/web/client/api.ts` | REST, SSE frame parser, media poll API |
| NEW | `src/web/client/response-state.ts` | Responses event reducer |
| NEW | `src/web/client/render.ts` | 안전한 DOM renderer와 tabs/a11y helper |
| NEW | `src/web/client/chat.ts` | 세션 저장, turn lifecycle, model 선택 |
| NEW | `src/web/client/voice.ts` | ephemeral/WS/microphone/playback lifecycle |
| NEW | `src/web/client/media.ts` | 이미지 생성, 비디오 제출/폴링 UI |
| NEW | `src/web/client/app.ts` | DOM bootstrap와 세 controller 조립 |
| NEW | `src/web/client/pcm-worklet.ts` | mono downsample + PCM16 frame 생성 |
| NEW | `src/web/public/index.html` | Chat/Voice/Media semantic shell |
| NEW | `src/web/public/style.css` | responsive utility app styling |
| NEW | `tests/webapp.test.ts` | HTTP header/static, SSE reducer, WS auth spec 회귀 |
| DELETE | `src/chat/server.ts` | `src/web/server.ts`로 대체 |
| DELETE | `src/chat/public/index.html` | `src/web/public/index.html`로 대체 |
| DELETE | `src/chat/public/app.js` | typed client modules로 대체 |
| DELETE | `src/chat/public/style.css` | `src/web/public/style.css`로 대체 |

`README.md`, `docs/`, `site/`, `skills/`는 wp15가 동기화하므로 이 단계에서 수정하지 않는다. `src/index.ts`의 command registration과 command 이름 `chat`도 그대로 유지한다.

## 4. MODIFY 상세

### 4.1 `package.json` — MODIFY

현재(`package.json:16-21`):

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "build": "npm run typecheck && tsup && node scripts/copy-public.mjs",
  "dev": "tsup --watch",
  "prepublishOnly": "npm run build",
  "test": "node scripts/run-tests.mjs"
}
```

변경 후:

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "build:web": "node scripts/copy-public.mjs && tsup --config tsup.web.config.ts",
  "build": "npm run typecheck && tsup && npm run build:web",
  "dev": "tsup --watch",
  "dev:web": "node scripts/copy-public.mjs && tsup --config tsup.web.config.ts --watch",
  "prepublishOnly": "npm run build",
  "test": "node scripts/run-tests.mjs"
}
```

`files`의 `"dist"`는 그대로 둔다. npm은 하위 `dist/public/index.html`, `dist/public/style.css`, `dist/public/assets/app.js`, `dist/public/assets/pcm-worklet.js`를 모두 포함한다. dependency는 추가하지 않는다.

### 4.2 `scripts/copy-public.mjs` — MODIFY

현재 전체:

```js
import { cpSync } from "node:fs";

cpSync("src/chat/public", "dist/public", { recursive: true });
console.log("Copied chat UI assets to dist/public/");
```

변경 후 전체:

```js
import { cpSync, rmSync } from "node:fs";

const source = new URL("../src/web/public/", import.meta.url);
const target = new URL("../dist/public/", import.meta.url);

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log("Copied web app static assets to dist/public/");
```

삭제 대상은 repository 안의 정확한 `dist/public/` 하나다. Node server bundle의 `dist/index.js`는 건드리지 않는다. `build:web`이 복사 다음에 `dist/public/assets`를 생성한다.

### 4.3 `src/commands/chat.ts` — MODIFY

현재 전체(`src/commands/chat.ts:1-36`):

```ts
import { Command } from "commander";
import { startChat } from "../chat/server.js";
import { loadTokens } from "../auth/token-store.js";
import {
  CHAT_DEFAULT_PORT,
  PROXY_DEFAULT_HOST,
} from "../auth/constants.js";
import { log } from "../utils/logger.js";
import { parseIntOrThrow } from "../utils/parse-int.js";

export function chatCommand(): Command {
  return new Command("chat")
    .description(
      `Open Grok chat in your browser.
  Starts a web UI + proxy server on the same port.
  Features: sessions, markdown, code highlighting, tool results, model switching.
  Proxy is also available at the same port under /v1/*.`,
    )
    .option("-p, --port <port>", "Port number", String(CHAT_DEFAULT_PORT))
    .option("--host <host>", "Host to bind", PROXY_DEFAULT_HOST)
    .action(async (opts: { port: string; host: string }) => {
      const tokens = loadTokens();
      if (!tokens?.accessToken) {
        log.error("Not logged in. Run `progrok login` first.");
        process.exit(1);
      }

      try {
        await startChat(parseIntOrThrow(opts.port, "port", 1, 65535), opts.host);
        await new Promise(() => {});
      } catch (err) {
        log.error((err as Error).message);
        process.exit(1);
      }
    });
}
```

변경 후 전체:

```ts
import { Command } from "commander";
import { startWebApp } from "../web/server.js";
import { loadTokens } from "../auth/token-store.js";
import {
  CHAT_DEFAULT_PORT,
  PROXY_DEFAULT_HOST,
} from "../auth/constants.js";
import { log } from "../utils/logger.js";
import { parseIntOrThrow } from "../utils/parse-int.js";

export function chatCommand(): Command {
  return new Command("chat")
    .description(
      `Open the local progrok web app.
  Starts Chat, live STT/realtime voice, image generation, video polling,
  and the REST proxy on the same origin. Voice requires localhost or HTTPS.`,
    )
    .option("-p, --port <port>", "Port number", String(CHAT_DEFAULT_PORT))
    .option("--host <host>", "Host to bind", PROXY_DEFAULT_HOST)
    .action(async (opts: { port: string; host: string }) => {
      const tokens = loadTokens();
      if (!tokens?.accessToken) {
        log.error("Not logged in. Run `progrok login` first.");
        process.exitCode = 1;
        return;
      }

      if (opts.host !== "127.0.0.1" && opts.host !== "localhost" && opts.host !== "::1") {
        log.warn("Non-loopback web app binding exposes your local proxy; microphone access also requires HTTPS.");
      }

      try {
        await startWebApp(
          parseIntOrThrow(opts.port, "port", 1, 65535),
          opts.host,
        );
        await new Promise(() => {});
      } catch (err) {
        log.error((err as Error).message);
        process.exitCode = 1;
      }
    });
}
```

## 5. NEW TypeScript 골격

### 5.1 `tsup.web.config.ts` — NEW

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    app: "src/web/client/app.ts",
    "pcm-worklet": "src/web/client/pcm-worklet.ts",
  },
  format: ["esm"],
  platform: "browser",
  target: "es2022",
  outDir: "dist/public/assets",
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
});
```

Node CLI build의 shebang/banner를 browser bundle에 넣지 않기 위해 기존 `tsup.config.ts`를 재사용하지 않는다.

### 5.2 `src/web/server.ts` — NEW

```ts
import express, { type NextFunction, type Request, type Response } from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHAT_DEFAULT_PORT, PROXY_DEFAULT_HOST } from "../auth/constants.js";
import { createProxyApp } from "../proxy/server.js";
import { log } from "../utils/logger.js";
import { openUrl } from "../utils/open-url.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

const WEB_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self' wss://api.x.ai https://api.x.ai",
  "img-src 'self' data: blob: https://assets.grok.com https://*.x.ai",
  "media-src 'self' blob: https://assets.grok.com https://*.x.ai",
  "worker-src 'self' blob:",
].join("; ");

export interface WebAppOptions {
  publicDir?: string;
}

export function applyWebSecurityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("Content-Security-Policy", WEB_CSP);
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  next();
}

export function createWebApp(options: WebAppOptions = {}): express.Application {
  const app = createProxyApp();
  const publicDir = options.publicDir ?? join(MODULE_DIR, "public");

  app.use(applyWebSecurityHeaders);
  app.use(express.static(publicDir, { etag: true, maxAge: 0 }));
  app.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(publicDir, "index.html"));
  });
  return app;
}

export async function startWebApp(
  port = CHAT_DEFAULT_PORT,
  host = PROXY_DEFAULT_HOST,
): Promise<void> {
  const app = createWebApp();
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      log.success(`progrok web app running at ${url}`);
      log.dim(`REST proxy available at ${url}/v1`);
      void openUrl(url);
      resolve();
    });
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(new Error(`Web app failed: ${error.message}`));
    });
    process.once("SIGINT", () => {
      server.close(() => process.exit(0));
    });
  });
}
```

`createProxyApp()`의 `/v1/*`가 먼저 등록되고 정적 middleware가 뒤에 붙는다. 따라서 SPA fallback이 API 오류를 HTML로 바꾸지 않는다.

### 5.3 `src/web/client/contracts.ts` — NEW

```ts
export type TurnStatus =
  | "composing"
  | "queued"
  | "streaming"
  | "complete"
  | "stopped"
  | "failed";

export interface ModelRecord {
  id: string;
  object?: string;
  owned_by?: string;
}

export interface ToolView {
  id: string;
  type: string;
  name?: string;
  status: "queued" | "running" | "complete" | "failed";
  argumentsText: string;
  outputText?: string;
  citations: Array<{ title: string; url: string }>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoningSummary: string;
  tools: ToolView[];
  status: TurnStatus;
}

export interface ChatSession {
  id: string;
  model: string;
  title: string;
  createdAt: number;
  messages: ChatMessage[];
}

export interface ResponsesRequest {
  model: string;
  input: Array<{ role: "user" | "assistant"; content: string }>;
  stream: true;
}

export interface EphemeralClientSecret {
  value: string;
  expires_at: number;
}

export type VoiceMode = "stt" | "realtime";
export type VoiceStatus =
  | "idle"
  | "requesting-permission"
  | "minting-secret"
  | "connecting"
  | "listening"
  | "speaking"
  | "stopped"
  | "failed";

export interface ImageResult {
  url: string;
  revisedPrompt?: string;
}

export interface VideoJob {
  requestId: string;
  status: "pending" | "done" | "failed" | "expired";
  progress?: number;
  videoUrl?: string;
  error?: string;
}
```

wire payload 자체는 이 타입으로 cast하지 않는다. `api.ts`와 `response-state.ts`가 `unknown`에서 필요한 필드만 좁힌다.

### 5.4 `src/web/client/api.ts` — NEW

```ts
import type {
  EphemeralClientSecret,
  ImageResult,
  ModelRecord,
  ResponsesRequest,
  VideoJob,
} from "./contracts.js";

const LOCAL_HEADERS = {
  Authorization: "Bearer progrok-local",
  "Content-Type": "application/json",
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object response");
  }
  return value as Record<string, unknown>;
}

async function readError(response: Response): Promise<Error> {
  const text = await response.text();
  try {
    const body = asRecord(JSON.parse(text));
    const error = asRecord(body.error);
    return new Error(String(error.message ?? `HTTP ${response.status}`));
  } catch {
    return new Error(text || `HTTP ${response.status}`);
  }
}

export async function listModels(signal?: AbortSignal): Promise<ModelRecord[]> {
  const response = await fetch("/v1/models", {
    headers: { Authorization: LOCAL_HEADERS.Authorization },
    signal,
  });
  if (!response.ok) throw await readError(response);
  const body = asRecord(await response.json());
  if (!Array.isArray(body.data)) throw new Error("/v1/models omitted data[]");
  return body.data.map((entry) => {
    const model = asRecord(entry);
    if (typeof model.id !== "string") throw new Error("Model entry omitted id");
    return { id: model.id, object: String(model.object ?? ""), owned_by: String(model.owned_by ?? "") };
  });
}

export async function* decodeSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      if (done && buffer.trim()) {
        frames.push(buffer);
        buffer = "";
      }
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        yield JSON.parse(data) as unknown;
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamResponses(
  request: ResponsesRequest,
  signal: AbortSignal,
): AsyncGenerator<unknown> {
  const response = await fetch("/v1/responses", {
    method: "POST",
    headers: LOCAL_HEADERS,
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) throw await readError(response);
  if (!response.body) throw new Error("Responses stream has no body");
  yield* decodeSse(response.body);
}

export async function mintClientSecret(
  signal?: AbortSignal,
): Promise<EphemeralClientSecret> {
  const response = await fetch("/v1/realtime/client_secrets", {
    method: "POST",
    headers: LOCAL_HEADERS,
    body: JSON.stringify({ expires_after: { seconds: 300 } }),
    signal,
  });
  if (!response.ok) throw await readError(response);
  const body = asRecord(await response.json());
  if (typeof body.value !== "string" || typeof body.expires_at !== "number") {
    throw new Error("Invalid realtime client secret response");
  }
  return { value: body.value, expires_at: body.expires_at };
}

export async function generateImages(
  input: { model: string; prompt: string; count: number },
  signal?: AbortSignal,
): Promise<ImageResult[]> {
  const response = await fetch("/v1/images/generations", {
    method: "POST",
    headers: LOCAL_HEADERS,
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      n: input.count,
      response_format: "b64_json",
    }),
    signal,
  });
  if (!response.ok) throw await readError(response);
  const body = asRecord(await response.json());
  if (!Array.isArray(body.data)) throw new Error("Image response omitted data[]");
  return body.data.map((entry) => {
    const image = asRecord(entry);
    const url = typeof image.url === "string"
      ? image.url
      : typeof image.b64_json === "string"
        ? `data:image/png;base64,${image.b64_json}`
        : "";
    if (!url) throw new Error("Image result omitted url and b64_json");
    return { url, revisedPrompt: typeof image.revised_prompt === "string" ? image.revised_prompt : undefined };
  });
}

export async function submitVideo(
  input: { model: string; prompt: string; duration: number; aspectRatio: string; resolution: string },
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch("/v1/videos/generations", {
    method: "POST",
    headers: LOCAL_HEADERS,
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      duration: input.duration,
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
    }),
    signal,
  });
  if (!response.ok) throw await readError(response);
  const body = asRecord(await response.json());
  if (typeof body.request_id !== "string") throw new Error("Video response omitted request_id");
  return body.request_id;
}

export async function readVideoJob(
  requestId: string,
  signal?: AbortSignal,
): Promise<VideoJob> {
  const response = await fetch(`/v1/videos/${encodeURIComponent(requestId)}`, {
    headers: { Authorization: LOCAL_HEADERS.Authorization },
    signal,
  });
  if (!response.ok) throw await readError(response);
  const body = asRecord(await response.json());
  const status = String(body.status);
  if (!["pending", "done", "failed", "expired"].includes(status)) {
    throw new Error(`Unknown video status: ${status}`);
  }
  const video = typeof body.video === "object" && body.video !== null ? asRecord(body.video) : undefined;
  const error = typeof body.error === "object" && body.error !== null ? asRecord(body.error) : undefined;
  return {
    requestId,
    status: status as VideoJob["status"],
    progress: typeof body.progress === "number" ? body.progress : undefined,
    videoUrl: typeof video?.url === "string" ? video.url : undefined,
    error: typeof error?.message === "string" ? error.message : undefined,
  };
}
```

`media.ts`가 `readVideoJob()`를 `await delay()` 뒤 순차 호출한다. `setInterval`로 겹치는 요청을 만들지 않는다.

### 5.5 `src/web/client/response-state.ts` — NEW

```ts
import type { ChatMessage, ToolView } from "./contracts.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function toolId(item: Record<string, unknown>): string {
  return String(item.id ?? item.item_id ?? item.call_id ?? `${item.type ?? "tool"}-${crypto.randomUUID()}`);
}

function upsertTool(message: ChatMessage, item: Record<string, unknown>): ToolView {
  const id = toolId(item);
  let tool = message.tools.find((candidate) => candidate.id === id);
  if (!tool) {
    tool = {
      id,
      type: String(item.type ?? "tool"),
      name: typeof item.name === "string" ? item.name : undefined,
      status: "running",
      argumentsText: "",
      citations: [],
    };
    message.tools.push(tool);
  }
  return tool;
}

export type ReduceResult = "continue" | "complete" | "failed";

export function reduceResponseEvent(
  message: ChatMessage,
  wire: unknown,
): ReduceResult {
  const event = record(wire);
  if (!event || typeof event.type !== "string") return "continue";

  if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
    message.text += event.delta;
  } else if (
    (event.type === "response.reasoning_summary_text.delta" || event.type === "response.reasoning_text.delta")
    && typeof event.delta === "string"
  ) {
    message.reasoningSummary += event.delta;
  } else if (event.type === "response.output_item.added") {
    const item = record(event.item);
    if (item && item.type !== "message") upsertTool(message, item).status = "running";
  } else if (/^response\.(web_search_call|x_search_call|mcp_call)\.(searching|in_progress|completed|failed)$/.test(event.type)) {
    const tool = upsertTool(message, event);
    tool.type = event.type.split(".")[1];
    tool.status = event.type.endsWith(".failed")
      ? "failed"
      : event.type.endsWith(".completed")
        ? "complete"
        : "running";
  } else if (event.type === "response.function_call_arguments.delta") {
    const tool = upsertTool(message, event);
    tool.argumentsText += typeof event.delta === "string" ? event.delta : "";
  } else if (event.type === "response.output_item.done") {
    const item = record(event.item);
    if (item && item.type !== "message") {
      const tool = upsertTool(message, item);
      tool.status = "complete";
      if (typeof item.arguments === "string") tool.argumentsText = item.arguments;
      if (typeof item.output === "string") tool.outputText = item.output;
      const action = record(item.action);
      if (Array.isArray(action?.sources)) {
        tool.citations = action.sources.flatMap((source) => {
          const value = record(source);
          return typeof value?.url === "string"
            ? [{ title: String(value.title ?? value.url), url: value.url }]
            : [];
        });
      }
    }
  } else if (event.type === "response.completed") {
    message.status = "complete";
    return "complete";
  } else if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "error") {
    message.status = "failed";
    return "failed";
  }
  return "continue";
}
```

첫 terminal event 이후 `chat.ts`는 추가 event를 reducer에 넣지 않는다. network EOF만으로 `complete`를 만들지 않는다.

### 5.6 `src/web/client/render.ts` — NEW

```ts
import type { ChatMessage, ToolView } from "./contracts.js";

export function clear(node: Element): void {
  node.replaceChildren();
}

export function renderSafeText(container: HTMLElement, text: string): void {
  clear(container);
  const parts = text.split(/```/);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = part.replace(/^\w+\n/, "");
      pre.append(code);
      container.append(pre);
      return;
    }
    for (const paragraph of part.split(/\n{2,}/)) {
      if (!paragraph) continue;
      const p = document.createElement("p");
      p.textContent = paragraph;
      container.append(p);
    }
  });
}

function renderTool(tool: ToolView): HTMLElement {
  const details = document.createElement("details");
  details.className = "tool-call";
  const summary = document.createElement("summary");
  summary.textContent = `${tool.name ?? tool.type} · ${tool.status}`;
  const pre = document.createElement("pre");
  pre.textContent = tool.argumentsText || tool.outputText || "No payload";
  details.append(summary, pre);
  for (const citation of tool.citations) {
    const link = document.createElement("a");
    link.href = citation.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = citation.title;
    details.append(link);
  }
  return details;
}

export function renderMessage(message: ChatMessage): HTMLElement {
  const article = document.createElement("article");
  article.className = `message message--${message.role}`;
  article.dataset.status = message.status;
  const body = document.createElement("div");
  body.className = "message__body";
  renderSafeText(body, message.text);
  article.append(body);
  if (message.reasoningSummary) {
    const reasoning = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Reasoning summary";
    const text = document.createElement("p");
    text.textContent = message.reasoningSummary;
    reasoning.append(summary, text);
    article.append(reasoning);
  }
  for (const tool of message.tools) article.append(renderTool(tool));
  return article;
}

export function activateTabs(tabList: HTMLElement): void {
  const tabs = Array.from(tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  function activate(tab: HTMLButtonElement): void {
    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.setAttribute("aria-selected", String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(candidate.getAttribute("aria-controls") ?? "");
      if (panel) panel.hidden = !selected;
    }
    tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      const next = event.key === "ArrowRight" ? index + 1
        : event.key === "ArrowLeft" ? index - 1
          : event.key === "Home" ? 0
            : event.key === "End" ? tabs.length - 1
              : index;
      if (next !== index) {
        event.preventDefault();
        activate(tabs[(next + tabs.length) % tabs.length]);
      }
    });
  });
}
```

Model output을 `innerHTML`에 넣지 않는다. reasoning은 API가 실제로 보낸 summary/text event만 표시하며 숨은 chain-of-thought를 추정하거나 생성하지 않는다.

### 5.7 `src/web/client/chat.ts` — NEW

```ts
import { streamResponses } from "./api.js";
import type { ChatMessage, ChatSession, ModelRecord, TurnStatus } from "./contracts.js";
import { reduceResponseEvent } from "./response-state.js";
import { renderMessage } from "./render.js";

const STORE_KEY = "progrok.web.sessions.v2";
const LEGACY_STORE_KEY = "progrok_sessions";
const MAX_SESSIONS = 50;

export interface ChatElements {
  model: HTMLSelectElement;
  sessions: HTMLElement;
  messages: HTMLElement;
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  stop: HTMLButtonElement;
  newSession: HTMLButtonElement;
  status: HTMLElement;
}

export class ChatController {
  #sessions: ChatSession[] = [];
  #currentId = "";
  #active?: AbortController;

  constructor(private readonly el: ChatElements) {}

  async init(models: ModelRecord[]): Promise<void> {
    this.#sessions = this.loadSessions();
    this.loadRuntimeModels(models);
    if (this.#sessions.length === 0) this.createSession();
    this.#currentId = this.#sessions[0].id;
    const selected = models.some((model) => model.id === this.#sessions[0].model)
      ? this.#sessions[0].model
      : models[0].id;
    this.#sessions[0].model = selected;
    this.el.model.value = selected;
    this.bind();
    this.render();
  }

  stop(): void {
    this.#active?.abort();
    const message = this.current().messages.at(-1);
    if (message?.role === "assistant" && message.status === "streaming") {
      message.status = "stopped";
      this.persist();
      this.render();
    }
  }

  private loadRuntimeModels(models: ModelRecord[]): void {
    this.el.model.disabled = true;
    this.el.model.replaceChildren(...models
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((model) => new Option(model.id, model.id)));
    this.el.model.disabled = models.length === 0;
    if (models.length === 0) throw new Error("No runtime models are available");
  }

  private async send(text: string): Promise<void> {
    const value = text.trim();
    if (!value || this.#active) return;
    const session = this.current();
    const user: ChatMessage = {
      id: crypto.randomUUID(), role: "user", text: value,
      reasoningSummary: "", tools: [], status: "complete",
    };
    const assistant: ChatMessage = {
      id: crypto.randomUUID(), role: "assistant", text: "",
      reasoningSummary: "", tools: [], status: "queued",
    };
    session.messages.push(user, assistant);
    session.model = this.el.model.value;
    if (session.title === "New chat") session.title = value.slice(0, 60);
    this.#active = new AbortController();
    this.render();

    try {
      assistant.status = "streaming";
      for await (const event of streamResponses({
        model: session.model,
        input: session.messages
          .filter((message) => message !== assistant)
          .map((message) => ({ role: message.role, content: message.text })),
        stream: true,
      }, this.#active.signal)) {
        const terminal = reduceResponseEvent(assistant, event);
        this.renderMessages();
        if (terminal !== "continue") break;
      }
      if (assistant.status === "streaming") {
        assistant.status = "failed";
        assistant.text ||= "Stream ended before a terminal response event.";
      }
    } catch (error) {
      if (this.#active.signal.aborted) assistant.status = "stopped";
      else {
        assistant.status = "failed";
        assistant.text ||= error instanceof Error ? error.message : String(error);
      }
    } finally {
      this.#active = undefined;
      this.persist();
      this.render();
    }
  }

  private bind(): void {
    this.el.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = this.el.input.value;
      this.el.input.value = "";
      void this.send(value);
    });
    this.el.stop.addEventListener("click", () => this.stop());
    this.el.newSession.addEventListener("click", () => { this.createSession(); this.render(); });
    this.el.model.addEventListener("change", () => {
      this.current().model = this.el.model.value;
      this.persist();
    });
  }

  private current(): ChatSession {
    const session = this.#sessions.find((candidate) => candidate.id === this.#currentId);
    if (!session) throw new Error("Current chat session is missing");
    return session;
  }

  private createSession(): void {
    const session: ChatSession = {
      id: crypto.randomUUID(), model: this.el.model.value,
      title: "New chat", createdAt: Date.now(), messages: [],
    };
    this.#sessions.unshift(session);
    this.#sessions = this.#sessions.slice(0, MAX_SESSIONS);
    this.#currentId = session.id;
    this.persist();
  }

  private loadSessions(): ChatSession[] {
    const raw = localStorage.getItem(STORE_KEY) ?? localStorage.getItem(LEGACY_STORE_KEY);
    if (!raw) return [];
    try {
      const values = JSON.parse(raw) as Array<Record<string, unknown>>;
      return values.flatMap((value) => {
        if (typeof value.id !== "string" || !Array.isArray(value.messages)) return [];
        const messages: ChatMessage[] = value.messages.flatMap((entry) => {
          if (typeof entry !== "object" || entry === null) return [];
          const message = entry as Record<string, unknown>;
          if (message.role !== "user" && message.role !== "assistant") return [];
          const allowed: TurnStatus[] = ["composing", "queued", "streaming", "complete", "stopped", "failed"];
          const status = allowed.includes(message.status as TurnStatus)
            ? message.status as TurnStatus
            : "complete";
          return [{
            id: typeof message.id === "string" ? message.id : crypto.randomUUID(),
            role: message.role,
            text: String(message.text ?? message.content ?? ""),
            reasoningSummary: String(message.reasoningSummary ?? message._reasoning ?? ""),
            tools: [],
            status,
          }];
        });
        return [{
          id: value.id,
          model: typeof value.model === "string" ? value.model : "",
          title: String(value.title ?? value.preview ?? "New chat"),
          createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
          messages,
        }];
      });
    } catch {
      return [];
    }
  }

  private persist(): void {
    localStorage.setItem(STORE_KEY, JSON.stringify(this.#sessions.slice(0, MAX_SESSIONS)));
    localStorage.removeItem(LEGACY_STORE_KEY);
  }

  private renderMessages(): void {
    this.el.messages.replaceChildren(...this.current().messages.map(renderMessage));
    this.el.messages.scrollTop = this.el.messages.scrollHeight;
  }

  private render(): void {
    this.renderMessages();
    this.el.sessions.replaceChildren(...this.#sessions.map((session) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = session.title;
      if (session.id === this.#currentId) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => {
        this.#currentId = session.id;
        this.el.model.value = session.model;
        this.render();
      });
      return button;
    }));
    const active = Boolean(this.#active);
    this.el.send.hidden = active;
    this.el.stop.hidden = !active;
    this.el.status.textContent = active ? "Generating response" : "Ready";
  }
}
```

기존 v1 저장값은 migration에서 각 message에 `id`, 빈 reasoning/tools, 유효한 status를 채운 뒤 첫 `persist()` 때 v2로 저장한다. v2의 persisted tool도 복원해야 한다면 별도 `parseToolView(unknown)` 경계 parser를 추가하고, cast만 해서 DOM에 넘기지 않는다.

### 5.8 `src/web/client/voice.ts` — NEW

```ts
import { mintClientSecret } from "./api.js";
import type { EphemeralClientSecret, VoiceMode, VoiceStatus } from "./contracts.js";
import {
  ephemeralProtocols,
  parseRealtimeServerEvent,
  parseSttServerEvent,
  type RealtimeClientEvent,
  type RealtimeServerEvent,
  type SttClientControl,
  type SttServerEvent,
} from "../../voice/protocol.js";

const XAI_WS_BASE = "wss://api.x.ai/v1";

export interface VoiceSocketSpec {
  url: string;
  protocols: string[];
}

export interface VoiceElements {
  mode: HTMLSelectElement;
  model: HTMLInputElement;
  voice: HTMLSelectElement;
  start: HTMLButtonElement;
  finish: HTMLButtonElement;
  stop: HTMLButtonElement;
  status: HTMLElement;
  userTranscript: HTMLElement;
  assistantTranscript: HTMLElement;
}

export function buildVoiceSocketSpec(
  mode: VoiceMode,
  secret: EphemeralClientSecret,
  options: { model: string; conversationId?: string },
): VoiceSocketSpec {
  const query = new URLSearchParams();
  if (mode === "stt") {
    query.set("encoding", "pcm");
    query.set("sample_rate", "16000");
    query.set("interim_results", "true");
    query.set("endpointing", "400");
  } else {
    query.set("model", options.model);
    if (options.conversationId) query.set("conversation_id", options.conversationId);
  }
  return {
    url: `${XAI_WS_BASE}/${mode === "stt" ? "stt" : "realtime"}?${query}`,
    protocols: ephemeralProtocols(secret.value),
  };
}

export class VoiceController {
  #status: VoiceStatus = "idle";
  #socket?: WebSocket;
  #stream?: MediaStream;
  #context?: AudioContext;
  #source?: MediaStreamAudioSourceNode;
  #worklet?: AudioWorkletNode;
  #silentSink?: GainNode;
  #conversationId?: string;
  #playback: AudioBufferSourceNode[] = [];
  #nextPlaybackAt = 0;
  #stoppingStt = false;
  #drainTimer?: number;

  constructor(private readonly el: VoiceElements) {}

  init(): void {
    const available = window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
    this.el.start.disabled = !available;
    this.el.status.textContent = available
      ? "Microphone is idle"
      : "Voice requires localhost or HTTPS with microphone support";
    this.el.start.addEventListener("click", () => void this.start());
    this.el.finish.addEventListener("click", () => this.finalizeUtterance());
    this.el.stop.addEventListener("click", () => void this.stop());
  }

  async start(): Promise<void> {
    await this.stop(false);
    try {
      this.setStatus("requesting-permission");
      this.#stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
      this.setStatus("minting-secret");
      const secret = await mintClientSecret();
      const mode = this.el.mode.value as VoiceMode;
      const spec = buildVoiceSocketSpec(mode, secret, {
        model: this.el.model.value.trim() || "grok-voice-think-fast-2.0",
        conversationId: mode === "realtime" ? this.#conversationId : undefined,
      });
      this.setStatus("connecting");
      const socket = new WebSocket(spec.url, spec.protocols);
      this.#socket = socket;
      socket.binaryType = "arraybuffer";
      socket.addEventListener("open", () => void this.onOpen(mode));
      socket.addEventListener("message", (event) => this.onMessage(mode, event));
      socket.addEventListener("error", () => {
        if (this.#socket === socket) this.fail("Voice WebSocket failed");
      });
      socket.addEventListener("close", () => {
        if (this.#socket !== socket) return;
        this.#socket = undefined;
        if (this.#status !== "stopped" && this.#status !== "failed") this.setStatus("stopped");
      });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      await this.stopMedia();
    }
  }

  async stop(drainStt = true): Promise<void> {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      if (this.el.mode.value === "stt" && drainStt) {
        this.#stoppingStt = true;
        this.sendJson({ type: "audio.done" } satisfies SttClientControl);
        await this.stopMedia();
        this.setStatus("stopped");
        this.#drainTimer = window.setTimeout(() => this.closeSocket(), 2_000);
        return;
      }
      if (this.el.mode.value === "realtime") {
        this.sendJson({ type: "response.cancel" } satisfies RealtimeClientEvent);
      }
    }
    this.closeSocket();
    this.cancelPlayback();
    await this.stopMedia();
    this.setStatus("stopped");
  }

  finalizeUtterance(): void {
    if (this.el.mode.value === "stt" && this.#socket?.readyState === WebSocket.OPEN) {
      this.sendJson({ type: "finalize" } satisfies SttClientControl);
    }
  }

  private async onOpen(mode: VoiceMode): Promise<void> {
    if (!this.#socket || !this.#stream) return;
    if (mode === "realtime") this.sendJson(this.sessionUpdate());
    const rate = mode === "stt" ? 16000 : 24000;
    this.#context = new AudioContext();
    await this.#context.audioWorklet.addModule("/assets/pcm-worklet.js");
    this.#source = this.#context.createMediaStreamSource(this.#stream);
    this.#worklet = new AudioWorkletNode(this.#context, "pcm-capture", {
      processorOptions: { targetSampleRate: rate },
    });
    this.#worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(event.data);
    };
    this.#source.connect(this.#worklet);
    this.#silentSink = this.#context.createGain();
    this.#silentSink.gain.value = 0;
    this.#worklet.connect(this.#silentSink).connect(this.#context.destination);
    this.setStatus("listening");
  }

  private onMessage(mode: VoiceMode, event: MessageEvent<string | ArrayBuffer>): void {
    if (event.data instanceof ArrayBuffer) {
      if (mode === "realtime") this.enqueuePcm(event.data, 24000);
      return;
    }
    try {
      if (mode === "stt") this.onSttEvent(parseSttServerEvent(event.data));
      else this.onRealtimeEvent(parseRealtimeServerEvent(event.data));
    } catch {
      this.fail("Voice API returned an invalid event");
    }
  }

  private onSttEvent(event: SttServerEvent): void {
    if (event.type === "transcript.partial") {
      this.el.userTranscript.textContent = event.text;
      if (event.speech_final) this.el.userTranscript.dataset.final = "true";
    } else if (event.type === "transcript.done") {
      if (event.text) this.el.userTranscript.textContent = event.text;
      if (this.#stoppingStt) this.closeSocket();
    } else if (event.type === "error") {
      this.fail(event.message);
    }
  }

  private onRealtimeEvent(event: RealtimeServerEvent): void {
    if (event.type === "ping") {
      this.sendJson({ type: "pong", ping_timestamp: event.timestamp } satisfies RealtimeClientEvent);
    } else if (event.type === "conversation.created") {
      this.#conversationId = event.conversation.id;
    } else if (event.type === "input_audio_buffer.speech_started") {
      this.cancelPlayback();
      this.setStatus("listening");
    } else if (event.type === "conversation.item.input_audio_transcription.updated" || event.type === "conversation.item.input_audio_transcription.completed") {
      this.el.userTranscript.textContent = event.transcript;
    } else if (event.type === "response.output_audio_transcript.delta") {
      this.el.assistantTranscript.textContent += event.delta;
    } else if (event.type === "response.done") {
      this.setStatus("listening");
    } else if (event.type === "response.cancelled") {
      this.setStatus("stopped");
    } else if (event.type === "error") {
      this.fail(event.error.message);
    }
  }

  private sendJson(event: SttClientControl | RealtimeClientEvent): void {
    this.#socket?.send(JSON.stringify(event));
  }

  private sessionUpdate(): Extract<RealtimeClientEvent, { type: "session.update" }> {
    return {
      type: "session.update",
      session: {
        voice: this.el.voice.value,
        reasoning: { effort: "high" },
        turn_detection: { type: "server_vad", threshold: 0.85, silence_duration_ms: 500, prefix_padding_ms: 333, idle_timeout_ms: 10000 },
        audio: {
          input: { format: { type: "audio/pcm", rate: 24000 }, transport: "binary", transcription: { model: "grok-transcribe" } },
          output: { format: { type: "audio/pcm", rate: 24000 }, transport: "binary", speed: 1 },
        },
        resumption: { enabled: true },
      },
    };
  }

  private enqueuePcm(buffer: ArrayBuffer, sampleRate: number): void {
    if (!this.#context) return;
    const input = new Int16Array(buffer);
    const audio = this.#context.createBuffer(1, input.length, sampleRate);
    const channel = audio.getChannelData(0);
    for (let index = 0; index < input.length; index += 1) channel[index] = input[index] / 32768;
    const source = this.#context.createBufferSource();
    source.buffer = audio;
    source.connect(this.#context.destination);
    this.#nextPlaybackAt = Math.max(this.#context.currentTime, this.#nextPlaybackAt);
    source.start(this.#nextPlaybackAt);
    this.#nextPlaybackAt += audio.duration;
    this.#playback.push(source);
    source.addEventListener("ended", () => { this.#playback = this.#playback.filter((item) => item !== source); });
    this.setStatus("speaking");
  }

  private cancelPlayback(): void {
    for (const source of this.#playback) { try { source.stop(); } catch {} }
    this.#playback = [];
    this.#nextPlaybackAt = 0;
  }

  private closeSocket(): void {
    if (this.#drainTimer !== undefined) window.clearTimeout(this.#drainTimer);
    this.#drainTimer = undefined;
    this.#stoppingStt = false;
    this.#socket?.close(1000, "user stop");
    this.#socket = undefined;
  }

  private async stopMedia(): Promise<void> {
    this.#worklet?.disconnect();
    this.#silentSink?.disconnect();
    this.#source?.disconnect();
    this.#stream?.getTracks().forEach((track) => track.stop());
    await this.#context?.close().catch(() => undefined);
    this.#worklet = undefined;
    this.#silentSink = undefined;
    this.#source = undefined;
    this.#stream = undefined;
    this.#context = undefined;
  }

  private setStatus(status: VoiceStatus): void {
    this.#status = status;
    this.el.status.textContent = status;
  }

  private fail(message: string): void {
    this.#status = "failed";
    this.el.status.textContent = message;
  }
}
```

token을 포함할 수 있는 `WebSocket` object, protocol, error event는 console에 출력하지 않는다.

### 5.9 `src/web/client/pcm-worklet.ts` — NEW

```ts
declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(inputs: Float32Array[][]): boolean;
}
declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly targetSampleRate: number;
  private carry = new Float32Array(0);

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const configured = Number(options?.processorOptions?.targetSampleRate ?? 16000);
    this.targetSampleRate = configured;
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;
    const merged = new Float32Array(this.carry.length + channel.length);
    merged.set(this.carry);
    merged.set(channel, this.carry.length);
    const ratio = sampleRate / this.targetSampleRate;
    const outputLength = Math.floor(merged.length / ratio);
    const pcm = new Int16Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      const sample = Math.max(-1, Math.min(1, merged[Math.floor(index * ratio)]));
      pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    const consumed = Math.floor(outputLength * ratio);
    this.carry = merged.slice(consumed);
    if (pcm.length > 0) this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
```

### 5.10 `src/web/client/media.ts` — NEW

```ts
import { generateImages, readVideoJob, submitVideo } from "./api.js";
import type { ModelRecord, VideoJob } from "./contracts.js";

const VIDEO_POLL_MS = 2_000;
const VIDEO_TIMEOUT_MS = 10 * 60_000;

export interface MediaElements {
  kind: HTMLSelectElement;
  model: HTMLSelectElement;
  prompt: HTMLTextAreaElement;
  form: HTMLFormElement;
  submit: HTMLButtonElement;
  progress: HTMLProgressElement;
  status: HTMLElement;
  results: HTMLElement;
}

export class MediaController {
  #active?: AbortController;

  constructor(
    private readonly el: MediaElements,
    private readonly models: ModelRecord[],
  ) {}

  init(): void {
    this.syncModels();
    this.el.kind.addEventListener("change", () => this.syncModels());
    this.el.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.run();
    });
  }

  private syncModels(): void {
    const needle = this.el.kind.value === "image" ? "imagine-image" : "imagine-video";
    const matches = this.models.filter((model) => model.id.includes(needle));
    this.el.model.replaceChildren(...matches.map((model) => new Option(model.id, model.id)));
    this.el.submit.disabled = matches.length === 0;
  }

  private async run(): Promise<void> {
    this.#active?.abort();
    this.#active = new AbortController();
    this.el.submit.disabled = true;
    this.el.results.replaceChildren();
    try {
      if (this.el.kind.value === "image") {
        const images = await generateImages({ model: this.el.model.value, prompt: this.el.prompt.value, count: 1 }, this.#active.signal);
        for (const result of images) {
          const image = new Image();
          image.src = result.url;
          image.alt = result.revisedPrompt ?? this.el.prompt.value;
          this.el.results.append(image);
        }
        this.el.status.textContent = "Image generation complete";
      } else {
        const requestId = await submitVideo({
          model: this.el.model.value,
          prompt: this.el.prompt.value,
          duration: 5,
          aspectRatio: "16:9",
          resolution: "480p",
        }, this.#active.signal);
        const job = await this.pollVideo(requestId, this.#active.signal);
        if (!job.videoUrl) throw new Error("Completed video omitted video.url");
        const video = document.createElement("video");
        video.src = job.videoUrl;
        video.controls = true;
        video.preload = "metadata";
        this.el.results.append(video);
      }
    } catch (error) {
      if (!this.#active.signal.aborted) this.el.status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      this.#active = undefined;
      this.el.submit.disabled = false;
    }
  }

  private async pollVideo(requestId: string, signal: AbortSignal): Promise<VideoJob> {
    const deadline = Date.now() + VIDEO_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          window.clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = window.setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, VIDEO_POLL_MS);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      const job = await readVideoJob(requestId, signal);
      if (typeof job.progress === "number") {
        const normalized = job.progress > 1 ? job.progress / 100 : job.progress;
        this.el.progress.value = Math.max(0, Math.min(1, normalized));
        this.el.status.textContent = `${job.status} · ${Math.round(this.el.progress.value * 100)}%`;
      } else {
        this.el.progress.removeAttribute("value");
        this.el.status.textContent = job.status;
      }
      if (job.status === "done") return job;
      if (job.status === "failed" || job.status === "expired") throw new Error(job.error ?? `Video ${job.status}`);
    }
    throw new Error("Video generation timed out after 10 minutes");
  }
}
```

`progress` 값만 determinate progress bar에 반영한다. 값이 없으면 `<progress>`의 `value` attribute를 제거해 indeterminate로 둔다. 이미지 endpoint는 동기 응답이므로 별도 fake polling을 만들지 않는다.

### 5.11 `src/web/client/app.ts` — NEW

```ts
import { listModels } from "./api.js";
import { ChatController } from "./chat.js";
import { MediaController } from "./media.js";
import { activateTabs } from "./render.js";
import { VoiceController } from "./voice.js";

function required<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing required element: ${selector}`);
  return value;
}

async function main(): Promise<void> {
  activateTabs(required<HTMLElement>("#workspace-tabs"));
  const models = await listModels();

  const chat = new ChatController({
    model: required("#chat-model"), sessions: required("#session-list"),
    messages: required("#messages"), form: required("#chat-form"),
    input: required("#chat-input"), send: required("#chat-send"),
    stop: required("#chat-stop"), newSession: required("#new-session"),
    status: required("#chat-status"),
  });
  const voice = new VoiceController({
    mode: required("#voice-mode"), model: required("#voice-model"),
    voice: required("#voice-name"), start: required("#voice-start"),
    finish: required("#voice-finish"), stop: required("#voice-stop"),
    status: required("#voice-status"), userTranscript: required("#voice-user-transcript"),
    assistantTranscript: required("#voice-assistant-transcript"),
  });

  await chat.init(models);
  voice.init();
  const media = new MediaController({
    kind: required("#media-kind"), model: required("#media-model"),
    prompt: required("#media-prompt"), form: required("#media-form"),
    submit: required("#media-submit"), progress: required("#media-progress"),
    status: required("#media-status"), results: required("#media-results"),
  }, models);
  media.init();
}

void main().catch((error) => {
  const fatal = required<HTMLElement>("#fatal-error");
  fatal.hidden = false;
  fatal.textContent = error instanceof Error ? error.message : String(error);
});
```

모델 fetch 실패는 fatal banner로 보이고 Chat/Media controller를 초기화하지 않는다. 정적 fallback은 넣지 않는다.

## 6. NEW HTML/CSS 골격

### 6.1 `src/web/public/index.html` — NEW 전체 골격

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="color-scheme" content="dark light">
    <title>progrok</title>
    <link rel="stylesheet" href="/style.css">
  </head>
  <body>
    <a class="skip-link" href="#workspace">Skip to workspace</a>
    <div class="app-shell">
      <aside class="sidebar" aria-label="Chat sessions">
        <div class="sidebar__header">
          <strong>progrok</strong>
          <button id="new-session" type="button">New chat</button>
        </div>
        <nav id="session-list" aria-label="Saved chat sessions"></nav>
      </aside>

      <div class="workspace-shell">
        <header class="topbar">
          <h1>progrok</h1>
          <nav id="workspace-tabs" class="tabs" role="tablist" aria-label="Workspace">
            <button role="tab" aria-selected="true" aria-controls="chat-panel" id="chat-tab">Chat</button>
            <button role="tab" aria-selected="false" aria-controls="voice-panel" id="voice-tab" tabindex="-1">Voice</button>
            <button role="tab" aria-selected="false" aria-controls="media-panel" id="media-tab" tabindex="-1">Media</button>
          </nav>
        </header>

        <main id="workspace" tabindex="-1">
          <p id="fatal-error" class="error-banner" role="alert" hidden></p>

          <section id="chat-panel" role="tabpanel" aria-labelledby="chat-tab" class="panel panel--chat">
            <h2 class="sr-only">Chat</h2>
            <div class="panel__toolbar">
              <label for="chat-model">Runtime model</label>
              <select id="chat-model" disabled></select>
              <span id="chat-status" role="status" aria-live="polite">Loading models</span>
            </div>
            <div id="messages" class="messages" aria-label="Conversation"></div>
            <form id="chat-form" class="composer">
              <label class="sr-only" for="chat-input">Message</label>
              <textarea id="chat-input" rows="2" required placeholder="Message Grok"></textarea>
              <button id="chat-send" type="submit">Send</button>
              <button id="chat-stop" type="button" hidden>Stop</button>
            </form>
          </section>

          <section id="voice-panel" role="tabpanel" aria-labelledby="voice-tab" class="panel" hidden>
            <header class="panel__intro">
              <h2>Live voice</h2>
              <p>Direct browser connection using a short-lived xAI client secret.</p>
            </header>
            <div class="form-grid">
              <label for="voice-mode">Mode</label>
              <select id="voice-mode"><option value="stt">Live transcription</option><option value="realtime">Speech to speech</option></select>
              <label for="voice-model">Realtime model</label>
              <input id="voice-model" value="grok-voice-think-fast-2.0">
              <label for="voice-name">Voice</label>
              <select id="voice-name"><option>eve</option><option>ara</option><option>leo</option><option>rex</option><option>sal</option></select>
            </div>
            <div class="actions">
              <button id="voice-start" type="button">Start microphone</button>
              <button id="voice-finish" type="button">Finish utterance</button>
              <button id="voice-stop" type="button">Stop</button>
            </div>
            <p id="voice-status" role="status" aria-live="polite">Microphone is idle</p>
            <div class="transcript-grid">
              <section><h3>You</h3><p id="voice-user-transcript"></p></section>
              <section><h3>Grok</h3><p id="voice-assistant-transcript"></p></section>
            </div>
          </section>

          <section id="media-panel" role="tabpanel" aria-labelledby="media-tab" class="panel" hidden>
            <header class="panel__intro"><h2>Media</h2><p>Create an image or submit and monitor a video job.</p></header>
            <form id="media-form" class="form-grid">
              <label for="media-kind">Kind</label>
              <select id="media-kind"><option value="image">Image</option><option value="video">Video</option></select>
              <label for="media-model">Runtime model</label>
              <select id="media-model"></select>
              <label for="media-prompt">Prompt</label>
              <textarea id="media-prompt" rows="5" required></textarea>
              <button id="media-submit" type="submit">Generate</button>
            </form>
            <progress id="media-progress" max="1" aria-label="Generation progress"></progress>
            <p id="media-status" role="status" aria-live="polite"></p>
            <div id="media-results" class="media-results"></div>
          </section>
        </main>
      </div>
    </div>
    <script type="module" src="/assets/app.js"></script>
  </body>
</html>
```

### 6.2 `src/web/public/style.css` — NEW 골격

```css
:root {
  color-scheme: dark;
  --bg: #101112;
  --surface: #181a1c;
  --surface-raised: #222529;
  --border: #35393e;
  --text: #f2f3f4;
  --muted: #a8adb4;
  --accent: #f4f4f4;
  --danger: #ff8d8d;
  --sidebar: 17rem;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); }
body { min-height: 100dvh; overflow: hidden; }
button, input, select, textarea { color: inherit; font: inherit; }
button, input, select, textarea { min-height: 2.75rem; border: 1px solid var(--border); border-radius: .55rem; background: var(--surface); }
button { cursor: pointer; padding: .55rem .8rem; }
button:disabled { cursor: not-allowed; opacity: .5; }
:focus-visible { outline: 2px solid #8ec5ff; outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.skip-link { position: fixed; inset: .5rem auto auto .5rem; z-index: 100; transform: translateY(-150%); background: var(--accent); color: #111; padding: .6rem; }
.skip-link:focus { transform: translateY(0); }

.app-shell { display: grid; grid-template-columns: var(--sidebar) minmax(0, 1fr); min-height: 100dvh; }
.sidebar { border-right: 1px solid var(--border); background: var(--surface); overflow: auto; }
.sidebar__header { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding: 1rem; border-bottom: 1px solid var(--border); }
#session-list { display: grid; gap: .25rem; padding: .5rem; }
#session-list button { width: 100%; text-align: left; background: transparent; }
#session-list button[aria-current="true"] { background: var(--surface-raised); }
.workspace-shell { min-width: 0; min-height: 100dvh; display: grid; grid-template-rows: auto minmax(0, 1fr); }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; border-bottom: 1px solid var(--border); padding: .5rem 1rem; }
.topbar h1 { margin: 0; font-size: 1rem; }
.tabs { display: flex; gap: .35rem; }
.tabs [aria-selected="true"] { background: var(--accent); color: #111; }
#workspace { min-height: 0; overflow: hidden; }
.panel { height: 100%; max-width: 72rem; margin: 0 auto; padding: 1rem; overflow: auto; }
.panel--chat { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
.panel__toolbar, .actions { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
.messages { min-height: 0; overflow: auto; padding: 1rem 0; }
.message { max-width: 52rem; margin: 0 auto 1rem; line-height: 1.55; }
.message--user .message__body { width: fit-content; max-width: 80%; margin-left: auto; padding: .75rem 1rem; border-radius: 1rem; background: var(--surface-raised); }
.message[data-status="streaming"]::after { content: "Generating"; color: var(--muted); font-size: .85rem; }
.message[data-status="stopped"]::after { content: "Stopped"; color: var(--muted); }
.message[data-status="failed"]::after { content: "Failed"; color: var(--danger); }
.message pre, .tool-call { overflow: auto; border: 1px solid var(--border); border-radius: .6rem; background: var(--surface); padding: .75rem; }
.composer { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .5rem; padding-top: .75rem; border-top: 1px solid var(--border); }
.composer textarea { resize: vertical; padding: .75rem; }
.form-grid { display: grid; grid-template-columns: minmax(9rem, .35fr) minmax(0, 1fr); gap: .75rem; align-items: center; }
.form-grid input, .form-grid select, .form-grid textarea { width: 100%; padding: .65rem; }
.transcript-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: 1rem; }
.transcript-grid section, .media-results > * { border: 1px solid var(--border); border-radius: .75rem; padding: 1rem; background: var(--surface); }
.media-results { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1rem; }
.media-results img, .media-results video { display: block; width: 100%; height: auto; border-radius: .5rem; }
.error-banner { color: var(--danger); border: 1px solid currentColor; padding: .75rem; }

@media (max-width: 48rem) {
  body { overflow: auto; }
  .app-shell { grid-template-columns: 1fr; }
  .sidebar { max-height: 10rem; border-right: 0; border-bottom: 1px solid var(--border); }
  .workspace-shell { min-height: calc(100dvh - 10rem); }
  .form-grid, .transcript-grid { grid-template-columns: 1fr; }
  .panel { padding-bottom: calc(1rem + env(safe-area-inset-bottom)); }
  .composer { position: sticky; bottom: 0; background: var(--bg); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}

@media (forced-colors: active) {
  button, input, select, textarea, .tool-call { border: 1px solid CanvasText; }
}
```

## 7. 테스트 파일

### `tests/webapp.test.ts` — NEW

테스트는 문서 문구 존재를 검사하지 않는다. HTTP 동작, parser/reducer output, socket spec의 실제 값을 비교한다.

```ts
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { Server } from "node:http";
import { createWebApp } from "../src/web/server.js";
import { decodeSse } from "../src/web/client/api.js";
import type { ChatMessage } from "../src/web/client/contracts.js";
import { reduceResponseEvent } from "../src/web/client/response-state.js";
import { buildVoiceSocketSpec } from "../src/web/client/voice.js";

describe("progrok web app", () => {
  let server: Server;
  let baseUrl = "";

  before(async () => {
    const app = createWebApp({ publicDir: join(process.cwd(), "src/web/public") });
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("No TCP address"));
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
      server.once("error", reject);
    });
  });

  after(async () => new Promise<void>((resolve) => server.close(() => resolve())));

  it("serves the app with a CSP that allows xAI WebSocket but no external scripts", async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /wss:\/\/api\.x\.ai/);
    assert.doesNotMatch(csp, /unsafe-inline|cdn\.jsdelivr/);
  });

  it("decodes SSE frames split across chunks and preserves multiline data", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"response.output_'));
        controller.enqueue(encoder.encode('text.delta","delta":"hi"}\r\n\r\n'));
        controller.close();
      },
    });
    const events: unknown[] = [];
    for await (const event of decodeSse(stream)) events.push(event);
    assert.deepEqual(events, [{ type: "response.output_text.delta", delta: "hi" }]);
  });

  it("reduces text, reasoning, tool, and terminal events into one message", () => {
    const message: ChatMessage = {
      id: "m1", role: "assistant", text: "", reasoningSummary: "",
      tools: [], status: "streaming",
    };
    reduceResponseEvent(message, { type: "response.output_text.delta", delta: "answer" });
    reduceResponseEvent(message, { type: "response.reasoning_summary_text.delta", delta: "summary" });
    reduceResponseEvent(message, { type: "response.output_item.done", item: { id: "t1", type: "function_call", name: "lookup", arguments: "{}" } });
    const terminal = reduceResponseEvent(message, { type: "response.completed" });
    assert.equal(terminal, "complete");
    assert.equal(message.text, "answer");
    assert.equal(message.reasoningSummary, "summary");
    assert.deepEqual(message.tools.map((tool) => [tool.id, tool.status]), [["t1", "complete"]]);
  });

  it("puts ephemeral auth only in Sec-WebSocket-Protocol", () => {
    const spec = buildVoiceSocketSpec("realtime", { value: "secret-value", expires_at: 123 }, { model: "grok-voice-think-fast-2.0" });
    assert.equal(spec.url, "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-2.0");
    assert.deepEqual(spec.protocols, ["xai-client-secret.secret-value"]);
    assert.ok(!spec.url.includes("secret-value"));
  });
});
```

`src/web/client/voice.ts`는 wp10의 browser-safe `src/voice/protocol.ts`만 import한다. Node 전용 `ws-client.ts`나 `ws` package를 browser bundle에 넣지 않는다. import 시 browser global을 실행하지 않아야 이 Node test가 가능하므로 `window` 접근은 `VoiceController.init/start` 내부로 제한한다.

## 8. 구현 순서

1. `contracts.ts`, `api.ts`, `response-state.ts`와 focused tests를 먼저 추가한다. SSE chunk split, terminal event, WS protocol 위치를 red→green으로 고정한다.
2. `server.ts`, `copy-public.mjs`, build config와 package scripts를 연결하고 `/`, CSS, bundle이 모두 200인지 확인한다.
3. HTML/CSS shell과 `render.ts`를 만들고 keyboard tabs, focus, mobile layout을 먼저 확인한다.
4. `chat.ts`를 연결한다. 런타임 models 성공/실패, queued/streaming/complete/stopped/failed, reasoning, function/search/MCP tool item을 확인한다.
5. `pcm-worklet.ts`와 STT를 연결한다. microphone track/worklet/socket이 stop/error/tab 종료 시 모두 해제되는지 확인한다.
6. realtime을 연결한다. `session.update`, ping/pong, transcript, binary playback, barge-in, resumption reconnect를 확인한다.
7. image/video UI를 연결한다. video poll은 terminal 상태와 timeout/abort를 확인한다.
8. 이전 `src/chat/` 네 파일을 삭제한다. `rg 'src/chat|chat/public' src scripts tests package.json` 결과가 0건인지 확인한다.
9. package dry-run과 실제 browser QA를 끝낸 후 wp14에 검증 evidence를 넘긴다.

## 9. 검증 명령

### 9.1 정적/단위/통합

```bash
npm run typecheck
node --import tsx --experimental-test-module-mocks --test tests/webapp.test.ts
npm run build
npm test
```

모두 exit 0이어야 한다. `npm run build` 후 다음 파일이 실제로 있어야 한다.

```bash
test -f dist/index.js
test -f dist/public/index.html
test -f dist/public/style.css
test -f dist/public/assets/app.js
test -f dist/public/assets/pcm-worklet.js
```

### 9.2 npm package 자산 검사

```bash
npm pack --dry-run --json | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const files=new Set(JSON.parse(s)[0].files.map(f=>f.path));
  for(const p of ["dist/public/index.html","dist/public/style.css","dist/public/assets/app.js","dist/public/assets/pcm-worklet.js"]){
    if(!files.has(p)) throw new Error(`missing from npm package: ${p}`);
  }
});'
```

exit 0이어야 한다. `package.json.files`에 `src/web`을 추가하지 않는다. 배포물은 compile/copy된 `dist` 하나다.

### 9.3 source 정리 검사

```bash
if rg -n 'src/chat|chat/public' src scripts tests package.json tsup*.ts; then exit 1; fi
if rg -n 'cdn\.jsdelivr|https://.*\.js|https://.*\.css' src/web/public; then exit 1; fi
```

### 9.4 실제 browser smoke

사전조건은 유효한 `~/.progrok/auth.json`, microphone 가능한 localhost browser다.

```bash
node dist/index.js chat --host 127.0.0.1 --port 18646
```

브라우저에서 다음을 순서대로 수행하고 screenshot/Network evidence는 wp14에 저장한다.

| 경로 | 수행 | 통과 조건 |
|---|---|---|
| Chat/model | `/v1/models` 성공 후 model 변경, prompt 전송 | 정적 fallback 없이 실제 응답, stream 중 Stop 노출, 완료 후 숨김 |
| Chat/reasoning | reasoning model prompt | 실제 reasoning summary event가 있을 때만 disclosure 표시 |
| Chat/tools | web/X search 또는 function tool | queued/running/complete 상태, 실제 인자/출처 표시; 가짜 tool panel 없음 |
| STT | Voice → Live transcription → Start/말하기/Finish/Stop | Network의 WS URL은 `wss://api.x.ai/v1/stt`, protocol은 `xai-client-secret.*`, `speech_final` 문장 보존 |
| Realtime | Voice → Speech to speech → Start/대화/끼어들기/Stop | `wss://api.x.ai/v1/realtime`, assistant audio와 양쪽 transcript, barge-in 시 playback 중단 |
| Image | Media → Image → prompt | 실제 image 표시, alt text 존재 |
| Video | Media → Video → prompt | request id 생성, real progress만 표시, done 뒤 controls 있는 video 표시 |
| Security | DevTools storage/console 검사 | OAuth/ephemeral token 없음; token은 WS subprotocol 외 URL/DOM/log/storage에 없음 |
| Cleanup | Voice 중지 후 browser media inspector | microphone indicator 꺼짐, AudioContext/socket 종료 |

viewport는 1440×900, 1024×768, 768×1024, 390×844에서 확인한다. keyboard만으로 tabs, model select, send/stop, microphone controls, media form을 완료하고 focus ring과 `aria-live` 상태를 확인한다.

## 10. 실패/중단 상태 규칙

| 상태 | UI | 복구 |
|---|---|---|
| `/v1/models` 실패 | fatal banner, Chat/Media submit disabled | 새로고침으로 재시도; stale static model 사용 금지 |
| Responses HTTP 실패 | 해당 assistant turn `failed`, 사용자 입력 유지 | Retry/Edit & resend를 후속 구현할 수 있게 message 유지 |
| 사용자 Abort | partial text 유지, `stopped` | 새 prompt 또는 재전송 가능 |
| stream EOF without terminal | `failed` | 성공으로 추정 금지 |
| microphone 거부 | Voice `failed`, Chat/Media 정상 | browser permission 안내 |
| client secret 실패/만료 | socket 생성 전 실패 또는 새 secret mint 후 reconnect | 장기 OAuth 요청/표시 금지 |
| WS 1006 | 현재 transcript 보존, `failed` | 사용자가 Start; realtime은 conversation id로 resume |
| video failed/expired | 실제 upstream message와 status | 같은 request id 무한 poll 금지 |
| video timeout | 10분 후 abort, request id 표시 | 사용자가 다시 제출하거나 API로 직접 조회 |

## 11. 완료 조건

- [ ] 파일 매니페스트의 NEW/MODIFY/DELETE가 정확히 반영되고 담당 외 파일을 건드리지 않았다.
- [ ] browser가 long-lived OAuth token을 받거나 저장하지 않는다.
- [ ] STT/realtime WebSocket은 `xai-client-secret.<token>` subprotocol을 쓰며 token이 URL/log/storage에 없다.
- [ ] `/v1/models`가 모델 선택의 유일한 권위이고 static fallback이 없다.
- [ ] Responses stream이 text, provider-supplied reasoning summary, 일반화된 tool lifecycle, terminal failure를 구분한다.
- [ ] 사용자가 중단한 partial response와 실패한 response가 다른 상태로 남는다.
- [ ] STT는 `speech_final=true` partial을 final 문장으로 보존한다.
- [ ] realtime은 24 kHz PCM binary input/output, ping/pong, transcript, barge-in, resumption을 처리한다.
- [ ] 이미지 결과와 비디오 submit→poll→done/failed/expired/timeout UI가 작동한다.
- [ ] stop/error 후 MediaStream track, AudioWorklet, AudioContext, WebSocket, poll AbortController가 해제된다.
- [ ] HTML에 외부 script/style CDN과 inline script가 없고 CSP가 이를 강제한다.
- [ ] `npm run typecheck`, focused webapp test, `npm run build`, `npm test`가 모두 exit 0이다.
- [ ] `npm pack --dry-run --json`에 네 정적 산출물이 포함된다.
- [ ] 네 viewport와 keyboard/VoiceOver 최소 smoke 결과가 wp14 evidence로 인계된다.

## 12. 고정된 선행 계약과 구현 중 재확인할 경계

- wp10의 `src/voice/protocol.ts`가 `ephemeralProtocols`, `parseRealtimeServerEvent`, `parseSttServerEvent`, `RealtimeClientEvent`, `RealtimeServerEvent`, `SttClientControl`, `SttServerEvent`를 browser-safe export한다. wp13은 이 계약을 그대로 import하며 event 이름·decoder·client control을 다시 선언하지 않는다.
- wp8의 `createProxyApp()` signature가 달라지면 `src/web/server.ts`만 조정한다. browser는 계속 same-origin `/v1/*`만 호출한다.
- 라이브 realtime server가 binary output transport를 거부하면 JSON `response.output_audio.delta` base64 경로로 바꾸되, browser OAuth/ephemeral 경계는 바꾸지 않는다.
- `/v1/models`에 media model이 나오지 않고 전용 model endpoint만 권위로 확정되면 Media selector만 `/v1/image-generation-models`와 `/v1/video-generation-models`로 분리한다. Chat selector의 `/v1/models` 권위는 유지한다.
