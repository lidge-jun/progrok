# wp5 실행 계획 (diff-level) — 검증

[070_verification.md](070_verification.md)를 P에서 재검증했다. 캡처 매트릭스는 그대로 두되
wp2~wp4에서 이미 실측해 기록한 항목은 **재실행하지 않고 근거 문서를 인용**한다.

wp5는 **검증 전용**이다. 결함을 발견하면 소유 work-phase로 되돌리고 여기서 고치지 않는다.
단, 이미 고친 것들(wp4에서 잡은 셸 높이 버그)은 042/062에 기록돼 있다.

## 이미 확보된 증거 (재실행 안 함)

| 항목 | 근거 |
|---|---|
| 6 브레이크포인트 가로 오버플로 0건, 컨트롤 클리핑 0건 | [042_wp2_check.md](042_wp2_check.md) |
| 보이스 Start 경로 실측(권한·디바이스·endpoint·elapsed·failed 칩) | [052_wp3_check.md](052_wp3_check.md) |
| 패널별 오류 경계 + 재시도, 스크롤 추종 3상태 | [062_wp4_check.md](062_wp4_check.md) |
| 레벨 산출 회귀 테스트 7건 | `tests/voice-meter.test.ts` |

## 이번에 새로 수행할 것

1. **정적 게이트** — `src/web` 전체에 대해:
   emoji 0, inline `style=` 0, inline `<script>` 0, 외부 `http(s)` 리소스 0,
   `100vh` 0, `transition: all` 0, 필수 DOM ID 전수 대조.
2. **a11y 실측** — 키보드만으로 탭 전환(Arrow/Home/End), 컴포저 전송, 보이스 시작/정지 도달.
   `:focus-visible` 가시성, 아이콘 전용 버튼의 접근 가능한 이름, 랜드마크/헤딩 순서.
3. **대비 재확인** — 040의 계산값을 현재 토큰과 대조해 어긋난 값이 없는지 확인.
4. **reduced-motion** — `prefers-reduced-motion`에서 미터 rAF가 생성되지 않고 칩 애니메이션이 멈추는지.
5. **최종 렌더 캡처** — 1440에서 챗/보이스/미디어 3탭, 390에서 보이스 1장.
6. **문서 동기화** — README의 웹앱 설명이 새 화면과 어긋나지 않는지 확인.

## UNVERIFIED로 남길 항목 (사유 명시)

- 실제 오디오 신호에 대한 미터 모션 (OAuth 토큰 만료)
- 보이스 listening/speaking/responding/muted 런타임 캡처 (같은 사유 + CSP가 `wss://api.x.ai` 고정)
- 미디어 결과 provenance 캡션 실물 (하네스 모의 응답이 실제 형태와 다름)

정적 코드 검토를 렌더 검증으로 대체하지 않는다 (FE-VISUAL-REPORT-01).

## 산출물

`devlog/_plan/260918_web_ui_redesign/090_verification_report.md` — 항목별
`checked / issue / unverified / n-a` 판정과 근거.


---

# wp5 감사 반영 (A-phase fold)

## H1. 브레이크포인트 재측정 (필수)

042는 wp2 시점 측정이고 이후 `style.css`/`index.html`이 바뀌었다
(미터 재배치, `data-level` 규칙, 셸 `grid-template-rows`/`min-height` 수정, `banner--panel`).
**6개 브레이크포인트 오버플로·클리핑 측정을 재실행한다.** 인용으로 대체하지 않는다.
c-1이 요구하는 834px도 측정 집합에 추가한다: 320 / 390 / 640 / 768 / **834** / 1024 / 1280 / 1600.

## H2. criteria 매핑 명시

| criterion | wp5에서 충족 방법 |
|---|---|
| c-1 | 320~1600 + 834 재측정 및 데스크톱/태블릿/모바일 실제 캡처 |
| c-2 | **정적 상태 하네스**로 9개 `data-state` 렌더 캡처 + 레벨 산출 단위 테스트. 실제 오디오 모션은 UNVERIFIED 유지 |
| c-4 | `npm run typecheck` |
| c-5 | `node scripts/run-tests.mjs` |
| c-6 | 정적 게이트: emoji 0, `linear-gradient`/`radial-gradient` 출현 수, accent 토큰 단일성, 가짜 상태 부재 |
| c-7 | 키보드 전 경로, `:focus-visible`, 대비 재계산, reduced-motion |
| c-9 | **wp5 범위 아님.** 모델 식별자 기준이므로 wp6이 충족한다 |

## H3. 정적 상태 하네스 (c-2)

070이 이미 지정한 방법이다. UNVERIFIED로 미루지 않는다.

`devlog/_plan/260918_web_ui_redesign/harness/states.html`을 만든다.
`/style.css`를 그대로 불러오고, 보이스 스테이지 마크업을 9개 `data-state`
(idle / requesting-permission / minting-secret / connecting / listening / responding / speaking / stopped / failed)로
복제해 한 화면에 나열한다. `data-muted`와 `data-interrupted` 변형도 포함한다.
미터 바는 `data-level`을 고정값으로 박아 13단계 CSS 규칙이 실제로 그려지는지 확인한다.

캡처마다 `fixture: static state harness`를 기록한다. 런타임 증거와 섞어 주장하지 않는다.

## H4. 미디어 provenance 실측 (하네스 보강)

062가 wp5로 미뤄둔 항목이다. 하네스를 고쳐 실제로 확인한다.

- `GET /v1/videos/:id`가 폴링 2회 후 `status: "done"`과 재생 가능한 `video_url`을 반환하도록 한다.
- 이미지 응답은 현행 data URL SVG를 유지한다. 캡션 렌더 확인에는 충분하다.
- 이미지와 영상 각각 1회 생성해 `figcaption`의 모델·옵션·실측 소요초·job id를 확인한다.

## H5. 추가 캡처 매트릭스 (020 §8)

- 뷰포트: 320 / 768 / 1024 / 1600 각 1장 이상.
- 상태: 챗 empty / streaming / complete / failed / 카탈로그 오류+재시도 / 새 응답 어포던스.
  미디어 idle / running / completed. 보이스는 H3 하네스.
- 환경: `prefers-reduced-motion`, `prefers-contrast: more`, `forced-colors`.
- 텍스트: 긴 모델 ID와 URL fixture로 오버플로 확인.
  **한국어 fixture는 N/A** — UI 카피가 영어 전용이다(005 B4에서 근거와 함께 N/A 처리).
- 대비: 기본 외에 hover / focus / selected / disabled / error 상태를 계산해 기록.

## H6. 남는 UNVERIFIED (1건)

실제 마이크 신호 → analyser → `data-level` → CSS 전 구간의 런타임 모션.
사유: OAuth 토큰 만료로 라이브 세션 불가, CSP가 `connect-src`를 `wss://api.x.ai`로 고정해
음성 소켓을 모의할 수 없음, 운영 코드에 dev 우회를 넣는 것은 거부.
`progrok login` 이후 재측정으로 닫는다.


---

# wp5 감사 반영 round 2 — 전수 매트릭스와 사전 판정

3연속 지적의 근본 원인은 "매트릭스를 설명만 하고 **항목별 판정 표를 만들지 않은 것**"이다.
아래가 020 §8 전수 목록이며, 각 항목의 수행 방법과 사전 판정을 미리 고정한다.
실행 후 실제 결과를 `090_verification_report.md`에 같은 순서로 기록한다.

## V1. 뷰포트 (전부 실측 재실행)

| 폭 | 방법 | 사전 판정 |
|---|---|---|
| 320 / 390 / 640 / 768 / 834 / 1024 / 1280 / 1440 / 1600 | 오버플로·클리핑 측정 + 각 1장 캡처 | checked 목표 |

## V2. 챗 상태

| 상태 | 방법 | 사전 판정 |
|---|---|---|
| empty | 새 세션 | checked 목표 |
| pending/queued | 전송 직후 프레임 | checked 목표 |
| streaming | 하네스 SSE 중 | checked 목표 |
| complete | 스트림 종료 | checked 목표 |
| stopped/cancelled | Stop 클릭 | checked 목표 |
| failed | 하네스가 500 반환하도록 토글 | checked 목표 |
| 카탈로그 오류 + 재시도 | `FAIL_CATALOG=once` | 062에서 실측 완료, 재확인 |
| 새 응답 어포던스 | 위로 스크롤 후 수신 | 062에서 실측 완료, 재확인 |
| permission-denied | **n-a** — 챗은 브라우저 권한을 쓰지 않는다. 권한 개념이 없는 서피스다 | n-a |

## V3. 보이스 상태

| 상태 | 방법 | 사전 판정 |
|---|---|---|
| idle / requesting-permission / minting-secret / connecting / listening / responding / speaking / stopped / failed | 정적 상태 하네스 `states.html` | checked (fixture: static state harness) |
| muted / interrupted 변형 | 같은 하네스 | checked (동일 fixture) |
| permission-denied | 하네스에서 실제 Start 후 권한 거부 경로. 불가하면 `describeMediaError` 분기의 문구를 하네스에 주입해 렌더 확인 | checked 목표 |
| **reconnecting** | **n-a** — 클라이언트에 재연결 로직이 존재하지 않는다(`voice-socket.ts` 전체, `voice.ts` close 핸들러). 005 B4에서 근거와 함께 N/A로 확정했다. 없는 상태를 그리는 것은 FE-AI-HONESTY-01 정면 위반이다 | n-a (근거 확정) |
| 실제 마이크 신호 모션 | 라이브 세션 필요 | **unverified** (H6 사유) |

## V4. 미디어 상태

| 상태 | 방법 | 사전 판정 |
|---|---|---|
| idle | 초기 | checked 목표 |
| queued / running | 영상 폴링 중(하네스가 progress 반환) | checked 목표 |
| completed (image) | 이미지 생성 | checked 목표 |
| completed (video) + provenance | 하네스 보강 후 `status: done` | checked 목표 |
| failed | 하네스가 `status: failed` 반환 | checked 목표 |
| cancelled | Stop polling 클릭 | checked 목표 |

## V5. 상호작용·환경

| 항목 | 방법 | 사전 판정 |
|---|---|---|
| 키보드 전 경로 | 탭 Arrow/Home/End, 컴포저 전송, 보이스 시작/정지, 미디어 제출/취소, 재시도 버튼 도달 | checked 목표 |
| focus-visible 가시성 | 포커스 링 캡처 | checked 목표 |
| open menu/dialog | **n-a** — 이 화면에는 메뉴·다이얼로그·콤보박스·시트가 없다. native `select`만 쓴다 | n-a |
| error boundary | V2의 카탈로그 오류가 곧 패널 오류 경계다 | checked 목표 |
| translucency fallback | **n-a** — `backdrop-filter`와 glass를 한 곳도 쓰지 않는다(FE-GLASS-01 준수). grep으로 0건 증명 | n-a (grep 증명) |
| prefers-reduced-motion | 미터 rAF 미생성, 칩 애니메이션 정지 | checked 목표 |
| prefers-contrast: more | 토큰 오버라이드 렌더 | checked 목표 |
| forced-colors | 강제 색상 모드 렌더 | checked 목표 |
| layout-shift / 스트리밍 안정성 | 스트리밍 중 메시지 영역 높이 변화와 스크롤 위치 유지 측정 | checked 목표 |
| 긴 식별자 fixture | 긴 모델 ID와 URL로 오버플로 확인 | checked 목표 |
| 한국어 fixture | **수정: n-a 철회.** 고정 UI 카피는 영어지만 사용자 입력과 모델 응답은 임의 문자열이며 한국어가 들어온다(`index.html:92,227`의 입력 필드, `chat.ts:91`의 렌더). 한국어 메시지와 한국어 미디어 프롬프트로 줄바꿈·고아 어미·버블 오버플로를 확인한다 | checked 목표 |
| 상태별 대비 | 기본·hover·focus·selected·disabled·error 계산 기록 | checked 목표 |

## V6. 보고 형식

`090_verification_report.md`는 V1~V5의 **모든 행**에 대해
`checked / issue / unverified / n-a` 중 하나와 근거(측정값·캡처·grep 결과)를 남긴다.
`unverified`는 실패한 명령이나 누락된 fixture를 정확히 적는다.
정적 코드 검토를 렌더 검증으로 대체하지 않는다.

## c-2 처리 (명시)

c-2는 "마이크 입력에 반응하는 실시간 시각화와 명시적 연결 상태를 렌더한다"이다.
정적 하네스는 **상태 렌더와 13단계 레벨 CSS**를 증명하지만 마이크 반응 자체는 증명하지 않는다.
따라서 **c-2를 met으로 표시하지 않는다.** 라이브 세션 확보 후 닫는다.
