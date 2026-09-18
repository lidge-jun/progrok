# 260919 구조·모듈화·CI 정비 로드맵 (docs-only)

cxc-dev 와 cxc-dev-scaffolding 규율에 맞춘 정비. 이 사이클은 **문서 전용**이며
구현은 wp10부터 시작한다 (LOOP-DOCS-FIRST-01).

## 0. 실측 현황

`src/` 89개 TS 파일, 11,229줄. 11개 디렉터리.

| 레이어 | 파일 | 줄 | 책임 |
|---|---:|---:|---|
| `auth` | 8 | 1371 | OAuth PKCE/device-code, 토큰 저장·갱신, 상수 |
| `transport` | 4 | 539 | xAI 요청 라우팅·서명·재시도, 헤더 |
| `wire` | 4 | 1212 | SSE/스트림 파싱, tool-call 조립, chat/responses 변환 |
| `surfaces` | 13 | 1208 | REST 타입드 클라이언트 (models/files/batches/...) |
| `proxy` | 9 | 1008 | 로컬 `/v1` 프록시, 릴레이, composer 주입 |
| `voice` | 8 | 1245 | 음성 프로토콜·WS 클라이언트·realtime/stt/tts |
| `web` | 13 | 2513 | 로컬 웹앱 서버 + 브라우저 클라이언트 |
| `commands` | 17 | 1670 | CLI 명령 15종 |
| `core` | 3 | 190 | 공용 타입·에러 |
| `utils` | 8 | 214 | 로거, URL 열기 등 |
| `chat` | 1 | 9 | `chat` 명령 얇은 위임 |

### 의존 방향 (실측)

```
commands ──> utils(25) auth(14) surfaces(8) voice(4) transport(4) proxy(1) chat(1)
surfaces ──> transport(10) core(2) wire(1) auth(1)
proxy    ──> core(3) wire(2) utils(2) auth(2) transport(1)
voice    ──> transport(4) utils(1) auth(1)
wire     ──> core(5)
web      ──> utils(2) proxy(1) auth(1)
transport──> utils(1) auth(1)
```

**순환 없음.** `core`/`utils`가 바닥, `commands`가 꼭대기다. 레이어 규율은 이미 지켜지고 있다.

### 공개 경계 (SCAF §1 pillar 3)

`index.ts`는 `src/index.ts`(CLI 엔트리)와 `src/surfaces/index.ts` 둘뿐이다.
나머지 레이어는 경계 파일 없이 내부 경로를 직접 import 한다.

**판단: 지금은 문제가 아니다.** 단일 패키지이고 외부 소비자가 CLI 하나뿐이라
경계 파일을 8개 더 만드는 것은 SCAF §5 "flat until you can't"에 어긋난다.
structure 문서에 현재 경계를 기록하되 새 배럴을 만들지 않는다.

## 1. structure/ 설계 (wp10)

opencodex 가 쓰는 `structure/` 관례를 따른다. 저장소에 durable SoT 문서가 없고
(SCAF-SOT-01 탐지 결과 `devlog/_plan/`만 존재) 아키텍처 기록이 필요하다.

```
structure/
  INDEX.md          # 진입점, 레이어 지도, 읽는 순서
  00_philosophy.md  # 설계 원칙과 하지 않기로 한 것
  10_layers.md      # 11개 디렉터리 책임·의존 방향·공개 경계
  20_contracts.md   # 보존해야 하는 계약 (DOM, 프로토콜, CSP, capabilities 스키마)
  30_evidence.md    # devlog 근거 문서 인덱스와 결정 추적
```

`devlog/_plan/` 기존 관례는 그대로 두고 `structure/30_evidence.md`에서 교차 링크한다.
`AGENTS.md`에 structure 진입점을 한 줄 추가한다.

## 2. 모듈 분할 (wp11)

400줄 초과 3개. SCAF §9 split smell 기준.

### 2.1 `src/web/client/voice.ts` (595줄)

`VoiceController` 하나가 5가지 책임을 들고 있다.

| 책임 | 현재 위치 | 분리 대상 |
|---|---|---|
| 연결 수명주기 (start/stop/socket/media) | 114-243, 319-380, 525-568 | `VoiceController` 유지 |
| 상태·컨트롤 동기화 | 569-596 | `VoiceController` 유지 |
| **진단 패널 렌더** (mute/elapsed/device/network/event log) | 244-318 | → `voice-diagnostics.ts` |
| **이벤트 → UI 반영** (stt/realtime 분기, 트랜스크립트) | 414-485 | → `voice-events.ts` |
| 세션 설정 페이로드 | 492-524 | → `voice-session.ts` |

분할 후 `voice.ts`는 약 300줄. `VoiceElements`와 `VoiceController` export 는 그대로 둔다
(`app.ts`와 `tests/`가 의존).

### 2.2 `src/wire/tool-calls.ts` (458줄)

읽고 책임 경계를 정한 뒤 분할한다. 후보: 조립(accumulate) / 정규화(normalize) / citation 추출.

### 2.3 `src/voice/ws-client.ts` (438줄)

후보: 소켓 수명주기 / 수신 큐 / 프로토콜 디스패치.

**제약**: 공개 export 와 동작을 바꾸지 않는다. 테스트 244건이 그대로 통과해야 한다.
순수 이동 + import 정리만 한다. 로직 수정은 이번 범위가 아니다.

## 3. CI 점검 (wp12)

현재 3개 워크플로: `ci.yml`, `pages.yml`, `publish.yml`.

`ci.yml`은 이미 최소 권한, 동시성 취소, npm 캐시, 3 OS × Node 매트릭스를 갖췄다.
점검 항목:

| 항목 | 확인할 것 |
|---|---|
| 액션 버전 | `checkout@v4`, `setup-node@v4`가 현행인지 |
| 사이트 빌드 | `npm --prefix site run build`가 CI에 없다 — 추가 검토 |
| Node 버전 | `engines: node>=18`인데 CI는 22만 — 매트릭스 하한 확인 |
| `pages.yml` | 사이트 배포 경로와 권한 |
| `publish.yml` | npm 배포 트리거와 provenance |

**하지 않는 것**: 새 CI 서비스 도입, 액션 대량 교체, 배포 정책 변경.

## 4. 근거 자료 매칭 (wp10에 포함)

`devlog/_plan/260918_web_ui_redesign/`의 15개 문서를 `structure/30_evidence.md`에서
주제별로 인덱싱하고, 각 결정이 어느 문서에 근거하는지 `path:line`으로 연결한다.

## 5. 범위 밖

새 기능, 전송 계층 변경, 의존성 추가, 동작을 바꾸는 리팩터링, 새 배럴 파일 8개.


---

# 감사 반영 (wp9 A-phase fold)

리뷰어가 실측 오류 다수를 잡았다. 직접 재검증해 전부 확인했다. **앞 절의 틀린 서술을 철회한다.**

## M1. 의존 그래프 정정 — 순환이 **있다**

앞 절의 "순환 없음"은 **거짓이다.** `sed` 패턴이 `from "../x/y"` 형태만 잡고
`from "../x.js"`(같은 깊이) 형태를 놓쳐 간선이 누락됐다.

실측한 순환:

```
auth ──> utils     src/auth/token-store.ts:11 (ensureConfigDir)
                   src/auth/pkce.ts:12,13 (openUrl, log)
                   src/auth/device-code.ts:12 (log)
utils ──> auth     src/utils/config.ts:7 (CONFIG_DIR, CONFIG_FILE)
                   src/utils/star-prompt.ts:1 (GITHUB_URL)
```

`auth ↔ utils` 양방향이다. 원인은 `auth/constants.ts`가 순수 상수 파일인데
`auth` 안에 있어서, 상수만 필요한 `utils`가 `auth`를 끌어오는 것이다.

누락했던 간선도 추가: `web → voice`(voice-socket.ts:5, voice.ts:10),
`web → core`, `chat → web`(server.ts:1), `chat → auth`(server.ts:2).

**wp10에서 할 일**: structure 문서에 이 순환을 **사실대로 기록**하고 해소 방향을 적는다.
해소 자체(상수를 `core`로 옮기기)는 동작 변경이 없는 순수 이동이지만
import 경로가 여러 파일에서 바뀌므로 wp11 모듈화와 함께 다룰지 wp10에서 판단한다.

## M2. `structure/` 신설 근거 보강

리뷰어 지적: 기존 `docs/api.md`를 무시했다.

정정. `docs/api.md`는 **API 레퍼런스**(엔드포인트·파라미터·예제)이고
`structure/`는 **내부 아키텍처**(레이어 책임·의존 방향·보존 계약)다. 독자가 다르다.
그럼에도 SCAF §2 "기존 저장소 우선"에 따라:

- `structure/INDEX.md`가 `docs/api.md`와 `devlog/_plan/`을 명시적으로 가리킨다.
- 내용 중복이 생기면 structure 가 링크만 하고 원본을 유지한다.
- 문서 수를 5개에서 **4개로 줄인다**: `00_philosophy.md`는 별도 파일로 둘 만큼
  내용이 없으므로 `INDEX.md`에 흡수한다.

```
structure/
  INDEX.md        # 진입점, 설계 원칙, 기존 문서(docs/, devlog/)로의 링크
  10_layers.md    # 11개 레이어 책임·의존 방향(순환 포함)·공개 경계
  20_contracts.md # 보존 계약: DOM, 음성 프로토콜, CSP, capabilities 스키마
  30_evidence.md  # devlog 근거 인덱스와 결정 추적
```

## M3. voice.ts 분할 계획 정정

리뷰어 지적: private 상태와 결합돼 "단순 이동"이 불가능하다.

맞다. `renderMute()`는 `#muted`, `#stream`을, `recordEvent()`는 `el.events`를,
`renderElapsed()`는 `#startedAt`을 읽는다. 클래스 밖으로 빼면 상태 주입이 필요하다.

**계획 변경**: 무상태 헬퍼만 먼저 분리하고, 상태 결합 메서드는 그대로 둔다.

| 분리 대상 | 근거 |
|---|---|
| `sessionUpdate()` 페이로드 (492-524) | 순수 함수. 입력은 `voice` 값 하나 |
| `describeMediaError()` | 이미 모듈 스코프 순수 함수 |
| `followBottom()` | 이미 모듈 스코프 순수 함수 |
| 진단 렌더 (244-318) | **보류.** 상태 결합이 커서 옮기면 주입 보일러플레이트가 더 길어진다 |
| 이벤트 분기 (414-485) | **보류.** `this.setStatus`, `this.#playback` 등 다수 결합 |

결과적으로 voice.ts 는 595 → 약 540줄로만 줄어든다. **그래도 그게 정직한 결과다.**
줄 수를 맞추려고 억지 주입 계층을 만드는 것이 SCAF §9 의 의도가 아니다.
이 판단을 structure 문서에 근거와 함께 기록한다.

## M4. tool-calls.ts / ws-client.ts 분할 후보 재조사

리뷰어 지적: citation 책임은 `tool-calls.ts`에 없고, ws-client 의 "프로토콜 디스패치"도 부정확하다.

**wp11 P 단계에서 두 파일을 실제로 읽고 책임 경계를 다시 도출한다.**
현재 로드맵의 후보는 추측이었으므로 철회한다.

## M5. CI 점검 항목 정정

| 앞 절 서술 | 실제 |
|---|---|
| "CI는 Node 22만" | **거짓.** `ci.yml:61` 매트릭스가 `['20','22','24']`. typecheck/build 잡만 22 고정 |

추가로 발견한 실제 문제:

| 파일 | 문제 |
|---|---|
| `ci.yml` | `package.json engines`가 `node>=18`인데 매트릭스 하한이 20. 선언과 검증이 불일치 |
| `pages.yml:26` | `npm install` 사용 → 잠금파일 무시. `npm ci`가 맞다 |
| `publish.yml:14` | `npm install` 사용 → 동일 문제 |
| `publish.yml` | `permissions` 블록 없음 → 기본 권한 상속. 최소 권한 명시 필요 |
| `publish.yml:16` | `npm publish`에 provenance 없음 → `--provenance` + `id-token: write` 검토 |
| `ci.yml` | 사이트 빌드(`npm --prefix site run build`)가 CI에 없음 |

## M6. 분할 후 회귀 검증 추가

리뷰어 요구사항. wp11 C 단계에 넣는다.

- 분할된 모듈의 **직접 import 경로**가 실제로 존재하는지 (`rg`로 대조)
- facade export 가 유지되는지 (`rg 'export.*VoiceController'` 등)
- `npm run build` 후 `dist/public/assets/app.js`가 생성되는지
- 테스트 244건 유지


---

# 재감사 반영 (wp9 A-phase fold, round 2)

## N1. `chat` 간선 줄 번호 정정

`src/chat/server.ts:1` → `auth`, `:2` → `web`. M1에서 뒤바꿔 적었다.

## N2. 회귀 검증을 자동화한다

`rg` 수동 확인은 이번 한 번만 막을 뿐 다음 변경을 막지 못한다.
`tests/`에 **모듈 경계 계약 테스트**를 추가한다.

```ts
// tests/module-boundaries.test.ts
describe("module boundaries", () => {
  it("keeps the public voice client surface importable", async () => {
    const mod = await import("../src/web/client/voice.js");
    assert.equal(typeof mod.VoiceController, "function");
    assert.equal(typeof mod.buildVoiceSocketSpec, "function");
  });

  it("keeps the layer dependency direction acyclic above the shared base", () => {
    // src 전체를 읽어 레이어 간선을 추출하고, 허용 목록 밖의 역방향 간선을 실패시킨다.
    // auth <-> utils 는 현재 알려진 순환으로 명시적 예외에 둔다(해소 시 예외를 지운다).
  });
});
```

이 테스트가 두 가지를 지속적으로 막는다.

1. 분할이 facade export 를 깨면 import 가 실패한다.
2. 새 역방향 간선이 생기면 허용 목록에 없어서 실패한다. `auth ↔ utils`는
   **알려진 예외로 명시**하고, 해소되면 예외를 제거해 재발을 막는다.

`npm run typecheck`는 import 경로 오류를 이미 잡으므로 중복하지 않는다.
계약 테스트는 typecheck 가 못 잡는 **런타임 export 존재**와 **레이어 방향**을 본다.

wp11 C 단계 검증 항목에 이 테스트 통과를 포함한다.

