# WP15 — 네이티브 표면 문서 동기화

## 목적과 원칙

wp5–wp14에서 실제로 구현되고 검증된 표면만 공개 문서에 반영한다. `README.md`,
`docs/api.md`, 사이트 문서, 배포되는 `skills/progrok/SKILL.md`가 동일한 endpoint,
모델, 인증, 포트를 말해야 한다. 런타임 `GET /v1/models`가 모델 카탈로그의 권위이며,
정적 가격표는 OAuth 세션의 권위가 아니다.

문서는 다음 네 연결 방식을 명확히 구분한다.

| 경로 | client endpoint | 인증 |
|---|---|---|
| HTTP REST | `http://127.0.0.1:18645/v1/*` → `https://api.x.ai/v1/*` | progrok이 `~/.progrok/auth.json`에서 주입 |
| Responses WS | `wss://api.x.ai/v1/responses` 직접 연결 | server-side bearer |
| Voice WS | `wss://api.x.ai/v1/realtime`, `wss://api.x.ai/v1/stt`, `wss://api.x.ai/v1/tts` 직접 연결 | 세 endpoint 모두 server-side bearer; browser ephemeral subprotocol은 `/realtime`과 `/stt`에서 실측 확인, `/tts`는 미확인 |
| 웹앱 | `http://127.0.0.1:18646`; REST는 same-origin, Voice WS는 xAI 직접 연결 | `/realtime`·`/stt` 연결마다 same-origin `POST /v1/realtime/client_secrets`로 새 1회용 secret을 발급하며 OAuth 값을 브라우저에 직렬화하지 않음 |

ima2-gen v3.16.1은 더 이상 progrok package나 프록시 process를 번들·실행하지 않는다.
두 프로젝트의 유일한 외부 호환 계약은 `~/.progrok/auth.json`의 경로와 스키마다.
공개 문서에 “ima2-gen이 progrok을 번들한다”, “18645를 자동 기동한다”는 문구를
새로 쓰지 않으며, 발견하면 삭제한다.

## 사실 감사 결과

교정해야 하는 현재 문구는 다음과 같다.

- `README.md:282`, `docs/api.md:25-27,430-434`, `skills/progrok/SKILL.md:169-171,292`,
  `site/src/pages/docs/voice/overview.astro:8`,
  `site/src/pages/docs/concepts/oauth-bridge.astro:101`은 WebSocket을 progrok이
  지원하지 않는다고 적는다. 재작성 후 direct xAI WS client와 충돌한다.
- `docs/api.md:258-259`와 `skills/progrok/SKILL.md:240`은
  `grok-voice-think-fast-1.0`/`grok-voice-fast-1.0`을 현재 모델처럼 제시한다.
  기본 별칭은 `grok-voice-latest`, 핀은 `grok-voice-think-fast-2.0`으로 교정한다.
- `skills/progrok/SKILL.md:240`, `site/src/pages/docs/pricing.astro:40-43`의 Voice/TTS
  가격은 연구 근거와 불일치한다. 정적 가격 숫자를 제거하거나 검증일과 출처를 붙인다.
  OAuth 문서의 기본값은 가격을 단정하지 않는 것이다.
- `site/src/pages/docs/cli/models.astro:12-15`의 정적 `grok-3`, `grok-4-image` 표는
  구식이다. live catalog 명령과 대표 용도만 남긴다.
- `site/src/pages/docs/tools/function-calling.astro:13`과
  `site/src/pages/docs/tools/web-search.astro:14`의 `gpt-4o`는 xAI 문서 예시에 잘못된
  모델이다. live catalog에서 선택한 Grok 모델로 바꾼다.
- `site/src/pages/docs/text/structured-outputs.astro:8`은 `response_format`이라고
  설명하지만 example은 Responses API의 `text.format`을 쓴다. 설명을 `text.format`으로
  맞춘다.
- image 페이지의 `size: "1024x1024"`는 현재 xAI native 문서의
  `aspect_ratio`/`resolution`과 다르다. 세 페이지를 함께 교정한다.
- `site/src/pages/docs/advanced/smoke-matrix.astro:31`은 realtime WS가 테스트되지
  않았다고 적는다. wp14 결과로 상태와 검증일을 갱신한다.
- 현재 공개 문서에는 ima2-gen이 progrok을 번들한다는 문구가 없다. 역사 devlog는
  수정하지 않고 README의 관계 절에 v3.16.1 이후 상태를 명시해 재발을 막는다.

## 변경 명세

### MODIFY — `README.md`

Before:

```md
an OpenAI-compatible localhost proxy that forwards `/v1/*` requests to
`api.x.ai`
```

After:

```md
a native localhost xAI bridge that parses and renders HTTP/SSE contracts for
`/v1/*`, provides typed clients for direct xAI WebSockets, and retains verified
binary/multipart passthroughs
```

활성 표에 다음 row를 추가한다.

```md
| Responses WebSocket | `wss://api.x.ai/v1/responses` | Direct typed Responses session with server-side bearer auth. |
| Voice WebSockets | `wss://api.x.ai/v1/realtime`, `wss://api.x.ai/v1/stt`, `wss://api.x.ai/v1/tts` | Direct realtime speech, streaming transcription, and streaming synthesis with server-side bearer auth. Browser ephemeral auth is verified for realtime and STT only; mint a new one-use secret for every connection and reconnect. |
| Local web app | `http://127.0.0.1:18646` | Same-origin HTTP plus direct xAI Voice WebSockets without exposing OAuth tokens to browser code. |
```

`Proxy Coverage`의 “WebSocket endpoints are not proxied” 계약은 유지하되 local relay가
없고 Node/browser client가 xAI에 직접 연결한다고 명시한다. browser 흐름은 same-origin
`POST /v1/realtime/client_secrets` → 새 1회용 ephemeral token → direct `/realtime` 또는
`/stt` socket 순서로 적는다. 연결과 재연결마다 새 secret을 발급하고 캐시·재사용하지
않으며, `/tts`의 browser ephemeral 인증은 실측되지 않았다고 명시한다. `How It Works`
도식에는 canonical IR, typed event, protocol renderer 단계를 넣는다.

`Relationship ...` 절 끝에 다음 사실을 추가한다.

```md
ima2-gen v3.16.1 no longer bundles or supervises progrok. It calls xAI directly;
the two tools only share the path and schema of `~/.progrok/auth.json`.
```

### MODIFY — `docs/api.md`

Before:

```md
> **Not proxied:** WebSocket endpoints ...
```

After:

```md
**HTTP base:** `http://127.0.0.1:18645/v1`
**Direct WebSocket base:** `wss://api.x.ai/v1`
**Web app:** `http://127.0.0.1:18646`
```

다음 section을 추가한다.

1. `## Native protocol behavior`: canonical request/event 변환, passthrough 대상, first
   terminal wins, pre-header만 retry, mid-stream 무재시도.
2. `## Responses WebSocket`: direct `wss://api.x.ai/v1/responses` URL, server-side
   bearer, serial request 규칙, 25분 연결 한도, request와
   response lifecycle event, `previous_response_not_found`,
   `websocket_connection_limit_reached`.
3. `## Realtime Voice WebSocket`: `model`, `call_id`, `conversation_id`,
   `reasoning.effort`, `session.update`, audio buffer, response, function, MCP, DTMF,
   ping/pong, resumption.
4. `## Streaming STT WebSocket`: query, binary frames, `finalize`, `audio.done`,
   `speech_final`이 최종 transcript이고 `transcript.done.text`가 비어 있을 수 있다는
   실측 주의.
5. `## Streaming TTS WebSocket`: query와 `text.delta`/`text.done`, binary/audio event.
6. `## Browser authentication`: `/realtime`과 `/stt` 연결마다 same-origin
   `POST /v1/realtime/client_secrets`로 새 backend-minted client secret을 받고 direct
   xAI socket에 `xai-client-secret.<token>` subprotocol로 한 번만 전달한다. 재연결에도
   새 secret을 발급하며 캐시·재사용하지 않는다. `/tts`의 browser ephemeral 인증은
   실측되지 않았으므로 server-side bearer만 문서화한다. OAuth/API key/client secret
   값을 URL query에 넣지 않는다.

Voice model snippet은 다음으로 교체한다.

```md
`session.model`: use `grok-voice-latest` for the rolling alias or pin
`grok-voice-think-fast-2.0` for production reproducibility.
```

`Limitations`에서는 local proxy가 WebSocket upgrade를 처리하지 않는다고 명시하고
management API, account gate, 연결 시간, 브라우저 origin 제한을 함께 남긴다.

### MODIFY — `skills/progrok/SKILL.md`

Before:

```md
Realtime Voice Agent + streaming TTS/STT use **WebSocket** endpoints that the
proxy does **not** forward.
```

After:

```md
progrok's WebSocket clients connect directly to `wss://api.x.ai/v1/responses`,
`wss://api.x.ai/v1/realtime`, `wss://api.x.ai/v1/stt`, and
`wss://api.x.ai/v1/tts`; the localhost HTTP proxy does not
relay WebSocket upgrades. Browser realtime and STT clients mint a new one-use
secret through `POST http://127.0.0.1:18645/v1/realtime/client_secrets` for every
connection and reconnect, then use the `xai-client-secret.<token>` subprotocol
once on the direct xAI socket. Do not cache or reuse it. Browser ephemeral auth
for TTS is not verified; use server-side bearer auth there.
```

실제 사용 pattern을 추가한다.

```ts
const secret = await fetch("http://127.0.0.1:18645/v1/realtime/client_secrets", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ expires_after: { seconds: 300 } }),
}).then((response) => response.json());
const ws = new WebSocket(
  "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-2.0",
  [`xai-client-secret.${secret.value}`],
);
ws.addEventListener("open", () => ws.send(JSON.stringify({
  type: "session.update",
  session: { voice: "eve", resumption: { enabled: true } },
})));
```

이 pattern은 socket 생성 함수 안에서 실행해 연결과 재연결마다 secret을 새로 발급한다.
발급한 secret은 한 연결에서 소진되므로 캐시하거나 다음 socket에 재사용하지 않는다.

모델 표의 `-fast-1.0`/`-think-fast-1.0`을 제거하고 alias/pinned 2.0을 분리한다.
가격 숫자는 삭제하고 “runtime catalog and xAI account terms are authoritative”로
바꾼다. ports/path에는 네 direct xAI WS URL과 웹앱 URL을 넣고 local WS URL은 넣지 않는다.

### MODIFY — `site/src/components/DocsSidebar.astro`

Before:

```ts
{ href: '/docs/text/streaming', label: 'Streaming' },
// Voice에는 overview, tts, stt, custom voices만 있음
```

After:

```ts
{ href: '/docs/text/streaming', label: 'SSE streaming' },
{ href: '/docs/text/responses-websocket', label: 'Responses WebSocket' },
// Voice
{ href: '/docs/voice/realtime', label: 'Realtime voice' },
{ href: '/docs/voice/streaming', label: 'Streaming TTS and STT' },
// Start
{ href: '/docs/webapp', label: 'Web app' },
```

### MODIFY — `site/src/pages/docs/index.astro`

Before: Core path와 Voice 목록에 WS와 웹앱이 없다.

After: Core path에 `Web app`, Text에 `Responses WebSocket`, Voice에 `Realtime voice`,
`Streaming TTS/STT` link를 추가한다. 개요 첫 문장은 “proxy and direct commands”에서
“native HTTP/SSE bridge, direct WebSocket clients and commands, and web app”으로 바꾼다.

### NEW — `site/src/pages/docs/text/responses-websocket.astro`

```astro
---
import DocsLayout from '../../../layouts/DocsLayout.astro';
const title = 'Responses WebSocket';
---
<DocsLayout title={title}>
  <h1>Responses WebSocket</h1>
  <p>Connect directly to <code>wss://api.x.ai/v1/responses</code> with a server-side bearer. Requests are processed serially on one connection; the localhost proxy does not relay WebSocket upgrades.</p>
  <h2>Lifecycle</h2>
  <pre><code>{`open -> response.create -> typed delta events -> response.completed|failed|incomplete`}</code></pre>
  <h2>Rules</h2>
  <ul>
    <li>The first terminal event wins; EOF alone is not success.</li>
    <li>Mid-stream failures are surfaced and never replayed automatically.</li>
    <li>Connections have an upstream maximum lifetime of 25 minutes.</li>
  </ul>
</DocsLayout>
```

### NEW — `site/src/pages/docs/voice/realtime.astro`

```astro
---
import DocsLayout from '../../../layouts/DocsLayout.astro';
const title = 'Realtime Voice';
---
<DocsLayout title={title}>
  <h1>Realtime Voice</h1>
  <p>Use <code>wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-2.0</code> directly for native speech-to-speech.</p>
  <h2>Session</h2>
  <pre><code>{`{"type":"session.update","session":{"voice":"eve","resumption":{"enabled":true}}}`}</code></pre>
  <p>Document audio formats, VAD, resumption, pronunciation replacement, tools, function calls, MCP, DTMF, cancellation, and ping/pong.</p>
  <h2>Browser-direct authentication</h2>
  <p>The local web app mints a new one-use client secret through same-origin <code>POST /v1/realtime/client_secrets</code> for every connection and reconnect, then passes it once as <code>xai-client-secret.&lt;token&gt;</code> on the direct xAI socket. Never cache or reuse the secret, and never expose the OAuth refresh token.</p>
</DocsLayout>
```

### NEW — `site/src/pages/docs/voice/streaming.astro`

```astro
---
import DocsLayout from '../../../layouts/DocsLayout.astro';
const title = 'Streaming TTS and STT';
---
<DocsLayout title={title}>
  <h1>Streaming TTS and STT</h1>
  <h2>STT</h2>
  <p>Send binary audio frames directly to <code>wss://api.x.ai/v1/stt</code>, then <code>finalize</code> and <code>audio.done</code>.</p>
  <p>Browser clients mint a new one-use ephemeral secret for every STT connection and reconnect. Never cache or reuse it.</p>
  <p>Treat a partial event with <code>speech_final=true</code> as final even when <code>transcript.done.text</code> is empty.</p>
  <h2>TTS</h2>
  <p>Connect directly to <code>wss://api.x.ai/v1/tts</code> and configure voice, language, codec, sample rate, latency optimization, speed, normalization, and timestamps in the query string.</p>
  <p>Use server-side bearer authentication for TTS; browser ephemeral authentication has not been verified.</p>
</DocsLayout>
```

### NEW — `site/src/pages/docs/webapp.astro`

```astro
---
import DocsLayout from '../../layouts/DocsLayout.astro';
const title = 'Local Web App';
---
<DocsLayout title={title}>
  <h1>Local Web App</h1>
  <pre><code>{`progrok chat
# open http://127.0.0.1:18646`}</code></pre>
  <p>The web app uses same-origin local HTTP for text Responses and one-use client-secret minting, then connects realtime Voice and STT directly to <code>wss://api.x.ai</code>. It mints a new secret for every connection and reconnect and never reuses one.</p>
  <p>OAuth access and refresh tokens are never serialized into HTML, JavaScript, storage, or browser logs. The ephemeral client secret exists only in memory and one WebSocket subprotocol handshake. TTS browser ephemeral authentication is not claimed without live proof.</p>
</DocsLayout>
```

### MODIFY — Voice와 웹앱 관련 기존 사이트 페이지

| 경로 | Before | After |
|---|---|---|
| `site/src/pages/docs/voice/overview.astro` | “WebSocket endpoints are not proxied” | REST proxy, direct xAI WS, `/realtime`·`/stt`의 연결별 1회용 browser ephemeral flow, `/tts` bearer-only 문서 범위를 표로 비교 |
| `site/src/pages/docs/voice/tts.astro` | REST만 설명 | REST와 direct `wss://api.x.ai/v1/tts` 링크, object `output_format` 유지 |
| `site/src/pages/docs/voice/stt.astro` | streaming은 progrok 미지원 | direct `wss://api.x.ai/v1/stt` query/event/final 규칙 링크 |
| `site/src/pages/docs/cli/chat.astro` | “web-based chat UI” 한 문장 | text SSE, Responses WS, realtime voice, 보안 경계, URL 설명 |
| `site/src/pages/docs/cli/proxy.astro` | HTTP `/v1/*`만 | HTTP relay와 direct xAI WS client를 구분하고 local WS upgrade가 없음을 명시 |
| `site/src/pages/docs/concepts/oauth-bridge.astro` | WS를 proxy하지 않음 | OAuth는 server-side에 남고 webapp은 `/realtime`·`/stt` 연결마다 새 1회용 client secret을 mint한 뒤 direct xAI WS 사용; `/tts` ephemeral은 미확인 |
| `site/src/pages/docs/advanced/smoke-matrix.astro` | WS는 external setup 없어 미검증 | wp14의 STT streaming/client-secret 결과, 날짜, artifact field를 기록 |

### MODIFY — 모델과 계약 오류가 있는 사이트 페이지

| 경로 | Before | After |
|---|---|---|
| `site/src/pages/docs/models.astro` | 고정 catalog가 중심 | `/v1/models`가 권위, Voice alias와 pinned 2.0 추가 |
| `site/src/pages/docs/pricing.astro` | Voice 0.05/min, TTS $15/M을 무기한 단정 | 가격표에 검증일/출처를 붙이거나 숫자를 제거하고 live terms로 안내 |
| `site/src/pages/docs/cli/models.astro` | grok-3/grok-4/grok-4-image 표 | `progrok models --detail` 출력 해석과 runtime 권위 설명 |
| `site/src/pages/docs/tools/function-calling.astro` | `gpt-4o` | `grok-4.6` 예시, Responses와 Chat tool shape 차이 설명 |
| `site/src/pages/docs/tools/web-search.astro` | `gpt-4o`, Chat tools | `grok-4.6`, Responses `web_search` 예시 |
| `site/src/pages/docs/text/structured-outputs.astro` | 설명은 `response_format` | Responses는 `text.format`; Chat만 `response_format` |
| `site/src/pages/docs/images/generation.astro` | `size` | `aspect_ratio`, `resolution` |
| `site/src/pages/docs/images/editing.astro` | `size` | `aspect_ratio`, `resolution`, `image` object |
| `site/src/pages/docs/images/multi-image-editing.astro` | `size` | `aspect_ratio`, `resolution`, `images[]` |
| `site/src/pages/docs/advanced/batch-api.astro` | JSONL 한 번 제출로 설명 | create batch → add requests → poll/results/cancel 실제 REST 순서 |

### NO CHANGE

다음 페이지는 endpoint 사실과 충돌이 없어 문구를 건드리지 않는다:
`site/src/pages/docs/cli/image.astro`, `cli/search.astro`, `cli/video.astro`,
`video/**`, `advanced/files.astro`, `voice/custom-voices.astro`. 링크가 새 페이지로
이어지는지만 site build 결과에서 확인한다.

## 문서 검증 명령

```bash
rg -n 'grok-voice-(fast|think-fast)-1\.0|ws://127\.0\.0\.1:18645/v1/(responses|realtime|stt|tts)|local WebSocket relay' \
  README.md docs/api.md skills/progrok/SKILL.md site/src/pages/docs
rg -n 'gpt-4o|"size": "1024x1024"' site/src/pages/docs
rg -n 'ima2-gen.*(bundl|supervis|18645)' README.md docs skills site/src/pages/docs
npm --prefix site run build
npm run typecheck
npm test
git diff --check
```

첫 세 `rg`는 exit 1(금지 문구 0건)이 성공이다. ima2-gen의 정확한 v3.16.1 관계를
설명하는 허용 문구는 별도 정규식으로 확인한다.

```bash
rg -n 'ima2-gen v3\.16\.1.*no longer bundles|only share.*~/.progrok/auth\.json' README.md
```

## 완료 조건

- README, API reference, packaged skill, site가 같은 HTTP/direct-WS/webapp URL을 말한다.
- 네 direct `wss://api.x.ai/v1/...` endpoint와 `/realtime`·`/stt`의 연결별 1회용 browser ephemeral auth 흐름이 copy-paste 가능한 예제를 가진다. `/tts`는 server-side bearer만 보장한다.
- `grok-voice-think-fast-1.0`, `grok-voice-fast-1.0`, `gpt-4o`, local WS URL/relay 문구가
  공개 문서에서 0건이다.
- `grok-voice-latest`는 rolling alias, `grok-voice-think-fast-2.0`은 production pin으로
  설명된다.
- ima2-gen v3.16.1이 progrok을 번들/실행하지 않고 auth file만 공유한다는 경계가
  README에 명시된다.
- site build, typecheck, test, `git diff --check`가 모두 exit 0이다.
