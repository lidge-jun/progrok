# 260918 네이티브 xAI 규격 재작성 — 로드맵

## 목표

progrok을 "인증 헤더를 갈아끼우는 조건부 패스스루 프록시"에서 **xAI 표면을 스스로 이해하는 독립 네이티브 구현**으로 바꾼다.
요청/응답을 바이트로 흘려보내는 대신 canonical IR로 파싱하고, typed event로 환원하고, 클라이언트 프로토콜로 다시 렌더링한다.
동시에 2026-09-18 기준 xAI API 표면 전체(Responses WS, Voice REST/WS, realtime speech-to-speech, SIP, batches, files, collections, embeddings, skills)를 반영하고,
작동하는 웹앱을 붙인다.

## 왜 지금인가

ima2-gen v3.16.1이 번들 progrok 프록시를 제거했다. `vendor/progrok-0.2.0.tgz`가 삭제됐고, 포트 18645와 `IMA2_GROK_PROXY_*` 환경변수도 더는 읽지 않는다.
ima2-gen은 이제 `lib/xaiAuth.ts`와 `lib/grokRuntime.ts`로 `api.x.ai`를 직접 호출한다.

결과적으로 progrok이 지켜야 할 외부 계약이 하나로 줄었다: **`~/.progrok/auth.json`의 경로와 스키마**. ima2-gen이 같은 파일을 읽고 쓴다.
supervisor stdout 파싱, `Bearer dummy` 수용, 고정 포트 18645는 더 이상 계약이 아니다. 이 세 가지에 묶여 있던 설계 제약을 푼다.

## 근거 문서

| 문서 | 출처 |
|---|---|
| `001_endpoint_inventory.md` | grok build 소스 분석(macbookpro-2) + docs.x.ai 전수(OpenAPI/WS 스키마)의 합집합 |
| `002_x_only_voice_research.md` | X(트위터)에만 존재하는 voice/realtime 사실 |
| `003_cookbook_grokbuild_research.md` | xAI Cookbook, grok-build CLI 설정/엔드포인트, SIP |

## 설계 원칙

1. **파서·재시도·OAuth·직렬화를 한 함수에 합치지 않는다.** 각각 별도 소유자를 둔다.
2. **wire 입력은 `unknown`으로 받는다.** OpenAI 호환이라는 이름만 믿고 cast하지 않는다.
3. **첫 terminal 신호가 권위자다.** EOF를 성공으로 추정하지 않는다.
4. **재시도는 commit 단계별로 분리한다.** 응답 헤더 도착 전 네트워크 실패만 재시도하고, mid-stream 실패는 재시도하지 않는다.
5. **패스스루를 없애지 않는다.** 네이티브 파싱이 이득이 없는 경로(바이너리, 멀티파트, 미지원 신규 엔드포인트)는 검증된 릴레이로 남긴다.
6. **크리덴셜 호환을 깨지 않는다.** `~/.progrok/auth.json` 스키마 변경은 마이그레이션을 동반한다.

## 미해결 쟁점 (구현 중 라이브로 판정)

- **OAuth 추론 base URL.** grok build 소스는 OAuth/세션 트래픽이 `https://cli-chat-proxy.grok.com/v1`로 간다고 말한다.
  그러나 2026-09-18 라이브 프로브에서 같은 OAuth 토큰이 `https://api.x.ai/v1`의 `/models`, `/tts`, `/stt`, `/realtime/client_secrets`에서 200을 받았다.
  wp6이 두 base를 모두 시도해 실제 지원 매트릭스를 기록하고, 경로별 라우팅 규칙을 확정한다.
- **모델 카탈로그의 권위.** 정적 스냅샷은 신뢰할 수 없다. 런타임 `GET /v1/models`가 권위이며, OAuth 카탈로그와 API-key 카탈로그가 다를 수 있다.
- 가격표는 이번 범위에서 다루지 않는다. OAuth 세션 경로에서는 의미가 없다.

## 작업 단계 지도

의존 순서대로. 각 단계는 하나의 완전한 PABCD 사이클이다.

| 단계 | 산출 | 의존 | 문서 |
|---|---|---|---|
| wp5 | 인증 코어 | wp1 | `010_wp5_auth_core.md` |
| wp6 | 전송 코어 | wp5 | `020_wp6_transport_core.md` |
| wp7 | 스트리밍 파서 | wp6 | `030_wp7_stream_parser.md` |
| wp8 | 프록시 재작성 | wp7 | `040_wp8_proxy_rewrite.md` |
| wp9 | Voice REST | wp6 | `050_wp9_voice_rest.md` |
| wp10 | Voice WS / realtime | wp9 | `060_wp10_voice_ws.md` |
| wp11 | 나머지 REST 표면 | wp7 | `070_wp11_rest_surfaces.md` |
| wp12 | CLI 표면 | wp8 | `080_wp12_cli_surface.md` |
| wp13 | 웹앱 | wp10 | `090_wp13_webapp.md` |
| wp14 | 검증 | wp13 | `100_wp14_verification.md` |
| wp15 | 문서 동기화 | wp14 | `110_wp15_docs_sync.md` |
| wp16 | 릴리스와 푸시 | wp15 | `120_wp16_release_push.md` |

wp2/wp3/wp4는 이 지도가 세분화되기 전의 우산 단계다. wp2는 wp5–wp8, wp3은 wp9–wp11, wp4는 wp14–wp15가 끝날 때 함께 닫는다.

## 목표 소스 레이아웃

```
src/
  core/
    types.ts            요청/메시지/도구/이벤트의 canonical 타입
    events.ts           AdapterEvent discriminated union
    errors.ts           typed 오류와 안전한 detail 추출
  auth/                 (기존) + 세대 안전 refresh로 확장
  transport/
    base-url.ts         경로별 upstream 결정
    headers.ts          인증·추적 헤더 조립
    retry.ts            재시도 분류
    fetch.ts            요청 실행과 abort 전파
  wire/
    sse.ts              바이트 디코더와 프레임 분해
    chat-stream.ts      Chat SSE 리듀서
    responses-stream.ts Responses SSE 리듀서
    tool-calls.ts       증분 tool-call 조립과 검증
  voice/
    tts.ts  stt.ts  realtime.ts  ws-client.ts
  surfaces/             REST 표면별 얇은 클라이언트
  proxy/                네이티브 코어 위의 HTTP 서버
  web/                  웹앱 (wp13)
```

## 완료 기준

goalplan의 c-1..c-8을 따른다. 요약하면 typecheck exit 0, 테스트 실패 0,
OAuth 라이브 스모크(STT 배치/스트리밍, TTS, realtime client_secret) 기록,
엔드포인트 인벤토리와 근거 대조, 크리덴셜 호환 유지, 작동하는 웹앱, 그리고 origin push.

## 확정 결정 (A 감사 1회차 결과 반영)

독립 감사가 BLOCKER 6건으로 FAIL을 냈다. 단계 간 계약 충돌이 원인이었고, 아래를 로드맵 차원에서 확정한다.
이 절이 개별 단계 문서보다 우선한다. 충돌하는 서술은 이 결정에 맞춰 고친다.

### D1. 로컬 WebSocket relay는 만들지 않는다

progrok의 HTTP 서버는 HTTP 전용이다. `/v1/responses`, `/v1/realtime`, `/v1/stt`, `/v1/tts`의 WebSocket은
클라이언트가 `wss://api.x.ai`에 **직접** 연결한다. 브라우저는 `POST /v1/realtime/client_secrets`로 받은
ephemeral token을 `Sec-WebSocket-Protocol: xai-client-secret.<token>`으로 실어 붙는다.

이유: 로컬 relay는 바이너리 오디오 프레임을 한 번 더 복사하면서 지연을 얹고, origin/세션 인증 계층을 새로 만들어야 하며,
백프레셔 책임까지 떠안는다. ephemeral token이 이미 그 문제를 브라우저 쪽에서 푼다.

### D2. OAuth 레인은 `api.x.ai` 하나다

라이브 판정(001 부록)에 따라 모든 OAuth 기본 경로는 `https://api.x.ai/v1`로 간다.
`cli-chat-proxy.grok.com`은 **명시적 opt-in** 뒤에 격리한 전용 클라이언트로만 노출한다.
`/deployment/config`는 OAuth bearer가 아니라 `GROK_DEPLOYMENT_KEY`를 쓰므로 별도 credential 종류로 분리한다.
근거 URL이 확정되지 않은 `/feedback*`는 자동 라우팅하지 않는다.

### D3. 모듈 소유권

| 모듈 | 소유 단계 |
|---|---|
| `src/core/types.ts`, `src/core/errors.ts`, `src/core/events.ts` | wp7 |
| `src/transport/fetch.ts`의 `XaiTransport`, `createXaiTransport` | wp6 |
| `src/auth/token-manager.ts` | wp5 |
| `src/surfaces/index.ts` | wp11 |

Responses 스트림의 공개 API 이름은 wp7이 정한 `reduceResponsesStream`이다. `decodeResponsesEvent`는 쓰지 않는다.

### D4. Voice 공개 API는 factory 형태다

`createTtsClient().synthesize()`, `createSttClient().transcribe()`, `createRealtimeClient()`가 권위다.
CLI는 이 API를 그대로 쓴다. `synthesizeSpeech` 같은 별도 이름을 만들지 않는다.
TTS 요청에 `model` 필드는 없다. `TtsResult`는 discriminated union이며 `kind`로 분기한다.

### D5. 테스트 소유권은 생성 단계에 있다

`tests/transport.test.ts`는 wp6, `tests/voice-rest.test.ts`는 wp9, `tests/voice-ws.test.ts`는 wp10,
`tests/webapp.test.ts`는 wp13이 만든다. wp14는 그 파일들을 MODIFY하거나 새 파일만 NEW로 만든다.

### D6. 이번 릴리스는 3.0.0이다

`capabilities --json`의 `commands`가 문자열 배열에서 객체 배열로 바뀐다. 기계 소비자가 깨지므로 major다.
legacy shim을 만들어 minor로 우기지 않는다.

### D7. wp10이 browser-safe 프로토콜 모듈을 소유한다

`src/voice/protocol.ts`에 realtime/stt/tts의 이벤트 이름과 타입을 Node 의존 없이 둔다.
wp13의 브라우저 코드는 이 모듈을 import한다. 두 벌로 구현하지 않는다.

### D8. inbound Authorization 헤더는 계속 무시한다

동작은 그대로 유지한다(무엇이 오든 저장된 OAuth bearer로 교체). 다만 이것은 공개 계약이 아니며,
wp16의 major 재판정 조건에서 제외한다. 3.0.0 판정 근거는 D6이다.

### D9. `ws` 의존성은 wp10이 추가한다

wp11은 같은 변경을 `NO CHANGE — precondition`으로 표기한다.

## 추가 결정 (A 감사 2회차 + 라이브 실측)

### D10. ephemeral client secret은 연결 1회용이다

실측으로 확정했다(001 부록 2). 시크릿 하나가 WebSocket 연결 하나를 연다.
`/v1/stt`와 `/v1/realtime` 모두 같은 방식으로 동작하며, 엔드포인트별 차등은 없다.

따라서 브라우저 코드는 **연결할 때마다 새로 발급**한다. 재접속도 새 발급이다. 시크릿을 캐시하거나 재사용하지 않는다.
wp10은 "streaming STT/TTS는 bearer 전용, ephemeral은 realtime 전용"이라고 쓴 부분을 삭제한다. 사실이 아니다.
전달 방식은 `Sec-WebSocket-Protocol: xai-client-secret.<token>` 하나뿐이다. Bearer 헤더로는 실패한다.

### D11. `createProxyApp` 주입 계약은 wp8이 소유한다

`Partial<ProxyAppDependencies>`이며 키는 `getBearer`와 `fetchUpstream`이다. wp14는 이 형태를 그대로 쓴다.

### D12. 재시도 분류 export는 `classifyReplay` 하나다

`classifyRetry`는 존재하지 않는다. wp14의 오라클을 wp6의 실제 시그니처
`classifyReplay(method, headers): ReplayClass`에 맞춘다.

### D13. 타입 중복 선언 금지

canonical `ResponsesRequest`는 wp7의 `src/core/types.ts`가, realtime 모델/effort 타입은
wp10의 `src/voice/protocol.ts`가 단독으로 소유한다. wp9과 wp13은 다시 선언하지 않고 import한다.
`src/surfaces/index.ts`의 named export 목록은 wp11이 문서에 명시한다.

## 추가 결정 (A 감사 3회차)

### D14. `src/voice/protocol.ts`의 소유자는 wp9으로 옮긴다

3차 감사가 전방 의존성을 잡았다. wp9의 `client-secrets.ts`가 `./protocol.js`를 import하는데
그 파일은 다음 단계인 wp10이 만들기로 돼 있었다. 그러면 wp9의 typecheck 게이트가 성립하지 않는다.

`protocol.ts`는 이벤트 이름 상수와 타입만 담은 의존성 없는 모듈이다. voice 계열의 첫 단계인 wp9이 소유하는 편이 자연스럽다.
wp10은 이를 precondition으로 두고 WS 클라이언트 구현만 맡는다. D13의 "realtime 타입 단독 소유"는 유지되며 소유 단계만 wp9으로 바뀐다.

### D15. client secret 응답 타입도 하나다

`POST /v1/realtime/client_secrets`의 응답 타입은 wp9이 `protocol.ts`에 canonical하게 둔다.
wp13은 `EphemeralClientSecret`을 따로 선언하지 않고 type-only import한다.

### D16. `src/surfaces/index.ts`는 REST 전용이 아니다

단일 public boundary라고 선언한 이상 wp11 소유의 `connectResponsesWebSocket`도 함께 export한다.
wp11과 wp14의 목록을 같이 갱신한다.

### D17. `/tts` WS 검증은 wp10 소유다

wp13의 브라우저 voice 범위는 STT와 realtime뿐이다. wp14의 webapp 테스트에서 `/tts` direct WS assertion을 뺀다.
해당 검증은 wp10의 `tests/voice-ws.test.ts`에 남는다.

### D18. 의존 표를 실제 계약에 맞춘다

아래가 실제 의존 관계다. 위쪽 "작업 단계 지도" 표의 의존 열보다 이 표가 우선한다.

| 단계 | 실제 선행 |
|---|---|
| wp5 | wp1 |
| wp6 | wp5 |
| wp7 | wp6 |
| wp8 | wp7 |
| wp9 | wp6, wp7 |
| wp10 | wp9 |
| wp11 | wp7, wp10 (패키지 산출물) |
| wp12 | wp6, wp8, wp9, wp10, wp11 |
| wp13 | wp7, wp9, wp10 |
| wp14 | wp13 |
| wp15 | wp14 |
| wp16 | wp15 |
