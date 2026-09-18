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
