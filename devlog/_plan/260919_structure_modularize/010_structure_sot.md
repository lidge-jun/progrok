# wp10 — structure/ 소스오브트루스 신설

## 만들 파일

```
structure/
  INDEX.md        # 진입점, 설계 원칙, 기존 문서 링크
  10_layers.md    # 11개 레이어 책임·의존 방향(순환 포함)·공개 경계
  20_contracts.md # 보존 계약
  30_evidence.md  # devlog 근거 인덱스
```

`AGENTS.md`에 한 줄 추가: structure/INDEX.md 를 아키텍처 진입점으로 명시.

## INDEX.md 내용

- progrok 이 무엇인지 두 문단 (OAuth 브리지, 4개 표면)
- 설계 원칙: 단일 패키지, 레이어 단방향, 직접 import(배럴 없음), 계약 보존 우선
- **하지 않기로 한 것**: 레이어별 배럴 8개 신설(단일 패키지라 §5 "flat until you can't"),
  프레임워크 도입, 전송 계층 추상화
- 링크: `docs/api.md`(API 레퍼런스), `devlog/_plan/`(작업 단위 기록), `DESIGN.md`(웹 디자인)

## 10_layers.md 내용

레이어 표(파일 수·줄 수·책임)와 **실측 의존 간선**. 순환을 숨기지 않는다.

```
core, utils ──────── 바닥
auth ←──────────────  utils 와 양방향 (알려진 순환)
transport ──> auth, utils
wire ──> core
surfaces ──> transport, core, wire, auth
proxy ──> core, wire, utils, auth, transport
voice ──> transport, utils, auth
web ──> utils, proxy, auth, voice, core
chat ──> auth, web
commands ──> 거의 전부
```

`auth ↔ utils` 순환의 원인(`auth/constants.ts`가 순수 상수인데 auth 안에 있음)과
해소 방향(`core`로 이동)을 적되, **이번 사이클에서 해소하지 않는다**는 결정과 이유를 남긴다.

공개 경계: `src/index.ts`(CLI), `src/surfaces/index.ts` 둘뿐. 나머지는 직접 import.

## 20_contracts.md 내용

깨면 안 되는 것들. 각 항목에 근거 파일:줄.

| 계약 | 근거 |
|---|---|
| 웹앱 DOM ID 28개와 native 타입 | devlog/_plan/260918_web_ui_redesign/010_dom_contract.md |
| CSP (`connect-src wss://api.x.ai` 등) | src/web/server.ts WEB_CSP |
| 음성 이벤트 관용 파싱 (모르는 이벤트 무시, error 만 실패) | src/voice/protocol.ts tryParse*, tests/voice-tolerant-parse.test.ts |
| capabilities 스키마 v2 | src/commands/capabilities.ts, tests/capabilities.test.ts |
| 일회용 client secret (연결당 1개) | src/voice/protocol.ts, tests/voice-ws.test.ts |
| 레이어 의존 방향 | tests/module-boundaries.test.ts (wp11에서 신설) |

## 30_evidence.md 내용

`devlog/_plan/260918_web_ui_redesign/` 15개 문서를 주제별 인덱싱.

| 주제 | 문서 |
|---|---|
| 제품 레퍼런스 조사 | 030_voice_ui_reference.md, 035_aside_capture.md |
| 프런트엔드 게이트 | 020_frontend_gates.md |
| DOM 계약 | 010_dom_contract.md |
| 디자인 토큰·대비 | 040_design_system.md |
| 검증 기록 | 042, 052, 062, 090, 102, 112 |
| 감사 fold | 005_audit_fold.md |

각 주요 결정이 어느 문서에 근거하는지 연결한다.

## 검증

- `npm run typecheck`, `node scripts/run-tests.mjs` (문서만 추가하므로 회귀 없음 확인)
- 문서 내 상대 링크가 실제 파일을 가리키는지 확인


---

# 감사 반영 (wp10 A-phase fold)

## O1. 일회용 secret 계약 근거 정정

`src/voice/protocol.ts`는 타입과 파서다. 연결당 발급이 실제로 일어나는 곳은
`src/web/client/voice.ts`의 `openFreshSocket()`이다 — `mintClientSecret()` 호출 후
`buildVoiceSocketSpec()`로 subprotocol 을 만든다. 근거를 그쪽으로 바꾼다.

## O2. 아직 없는 테스트를 근거로 쓰지 않는다

`tests/module-boundaries.test.ts`는 wp11에서 신설한다. 존재하지 않는 파일을
"계약 근거"로 적으면 거짓이다. `20_contracts.md`에서는 레이어 방향을
**현재 상태(순환 포함)로 기술**하고, 테스트는 wp11 완료 후 근거로 추가한다.

## O3. 문서 수 정정

`devlog/_plan/260918_web_ui_redesign/`의 Markdown 은 **24개**다(15개 아님).
`harness/` 하위 파일은 문서가 아니므로 제외하고 센 수치다.

## O4. commands 간선 명시

`commands`가 참조하는 레이어는 실측 7개: `auth`, `chat`, `proxy`, `surfaces`,
`transport`, `utils`, `voice`. "거의 전부"라는 모호한 서술을 이 목록으로 대체한다.

## O5. 경계 테스트의 허용·금지 간선 사전 명시

wp11 테스트가 무엇을 통과시키고 무엇을 막는지 지금 정한다.

**허용(현재 실측 간선)**

```
auth      -> utils
utils     -> auth            (알려진 순환, 해소 시 제거)
transport -> auth, utils
wire      -> core
surfaces  -> transport, core, wire, auth
proxy     -> core, wire, utils, auth, transport
voice     -> transport, utils, auth
web       -> utils, proxy, auth, voice, core
chat      -> auth, web
commands  -> auth, chat, proxy, surfaces, transport, utils, voice
```

**금지**: 위 목록에 없는 모든 레이어 간선. 새로 생기면 테스트가 실패한다.
`core`와 `utils`는 다른 레이어를 참조하지 않는다(단 `utils -> auth` 예외).

