# wp2 검증 기록

측정 환경: Codex in-app browser, 하네스 `devlog/_plan/260918_web_ui_redesign/harness/serve.mjs` + `dist/public`, backend: mock.

## 브레이크포인트 감사 (실측)

각 폭에서 `document.documentElement.scrollWidth > innerWidth` 와
탭/버튼/칩/제목/미터 라벨의 `scrollWidth > clientWidth` 클리핑을 측정했다.

| 목표 폭 | 실측 innerWidth | scrollWidth | 가로 오버플로 | 클리핑된 컨트롤 |
|---|---|---|---|---|
| 320 | 320 | 320 | 없음 | 없음 |
| 640 | 640 | 640 | 없음 | 없음 |
| 768 | 767 | 767 | 없음 | 없음 |
| 1024 | 1024 | 1024 | 없음 | 없음 |
| 1280 | 1280 | 1280 | 없음 | 없음 |
| 1600 | 1600 | 1600 | 없음 | 없음 |

## 렌더 중 발견하고 고친 결함

| 결함 | 원인 | 수정 |
|---|---|---|
| 런타임 생성 빈 상태가 스타일 없이 렌더 | `chat.ts`가 만드는 클래스는 `.empty-state`인데 CSS는 `.empty`만 정의 | 셀렉터를 `.empty, .empty-state`로 확장하고 `.empty-state h2/h3` 처리 추가 |
| 레벨 바가 선처럼 늘어남 | 바가 `flex: 1`이라 7개가 전체 폭을 분할 | 고정 폭 4px 바 + 트랙 테두리. 상태 칩과 같은 행으로 통합 |
| 보이스 스테이지에 빈 패널 2개 | 상태/미터가 각각 전폭 패널 | 하나의 라이브 스트립으로 병합, stage 행을 2개로 축소 |
| Transport 헤딩만 남고 값이 없음 | 행만 hidden이고 헤딩은 노출 | `#voice-transport` 래퍼를 hidden으로 시작 |
| 모바일 rail이 251px로 부풀음 | 셸 그리드가 남는 높이를 auto 행에 분배 | ≤48rem에서 `grid-template-rows: auto minmax(0,1fr)` + `align-content: start` |
| `/assets/app.js` 404 | `copy-public.mjs`가 `dist/public`을 지워 번들 제거 | 캡처 전 항상 `npm run build` 전체 실행 |

## 보존 계약 확인

필수 ID 36개(패널 id 포함) 전부 존재. native 타입, `type="submit"`, form 자손 구조,
`.media-options--image` 2회 / `.media-options--video` 6회(라벨+컨트롤 양쪽),
`[hidden]{display:none!important}`, live-region 4종, `type="module"` 엔트리,
외부 js/css URL 0개, inline style 0개, emoji 0개, `100vh` 0개, `transition: all` 0개 — 전부 확인.

## 남은 항목

톱바 런타임 3행과 Transport 행은 hidden 상태다. 실제 값 주입은 wp4(톱바)와 wp3(Transport)가 한다.
상태별 캡처(listening/speaking/streaming 등)는 wp5에서 수행한다.

