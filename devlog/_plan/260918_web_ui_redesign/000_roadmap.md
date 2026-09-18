# progrok 웹 워크스페이스 리디자인 — 방향 고정 및 로드맵

작성: 2026-09-18 / 세션 01a0b4e7 / work-phase wp1 (docs-only)

## 0. 이 문서의 역할

`src/web` 로컬 워크스페이스(챗 / 라이브 보이스 / 미디어)의 프런트엔드를 전면 재설계한다.
이 문서는 디자인 방향을 고정(lock)하고 구현 work-phase를 분해한다. 구현은 다음 사이클부터 시작한다.

근거 문서:

- [010_dom_contract.md](010_dom_contract.md) — JS가 요구하는 DOM 계약, CSP 제약, 오디오 레벨 확장점
- [020_frontend_gates.md](020_frontend_gates.md) — 이 서피스에 적용되는 프런트엔드 게이트 (D8 / TOOL)
- [030_voice_ui_reference.md](030_voice_ui_reference.md) — 2026 실시간 음성 UI 제품 레퍼런스와 출처
- Aside 브라우저 수집 — LiveKit Agents Playground / Vapi / ElevenLabs / Hume / Grok 실제 화면 계측

## 1. 현재 상태 진단

현재 UI는 동작은 하지만 개발자 도구가 아니라 문서 페이지처럼 생겼다. 구체적 문제:

| 문제 | 위치 | 위반 게이트 |
|---|---|---|
| 톱바에 "One runtime, three surfaces" 마케팅 카피 | index.html:30-31 | FE-METACOPY-01, FE-HERO-01 |
| 패널마다 대형 h1 + 소개 문단 ("Live voice", "Create media") | index.html:70-74, 113-117 | FE-HERO-01, FE-DENSITY-01 |
| 페이지에 h1이 3개 | index.html:46, 72, 115 | FE-SHELL-01 |
| 라이브 세션이 살아있다는 신호가 status 텍스트 한 줄뿐 | index.html:98 | FE-VOICE-01, FE-STREAM-01 |
| 오디오 레벨 시각화 없음. `data-state`를 CSS가 소비조차 안 함 | style.css 전체 | c-2 미충족 |
| 트랜스크립트가 문단 2개, partial/final 구분이 `data-final` 색 하나 | index.html:101-107 | FE-STREAM-02 |
| 런타임 상태(프록시 포트, 세션, 모델)가 어디에도 없음 | — | FE-DENSITY-01 |
| label 8rem 고정 2열 폼 그리드 | style.css:263 | FE-DENSITY-03 |
| accent `#67a7ff` = 무검토 기본 블루 | style.css:12 | FE-ICON-01 계열 |

진단 요약: 정보 밀도가 낮고, 상태가 보이지 않으며, 마케팅 레이아웃 문법이 도구 안에 들어와 있다.

## 2. 고정하는 방향 (LOCK)

### 2.1 서피스 분류와 다이얼

`D8 Developer console` / 모션 버킷 `TOOL`.
`DESIGN_VARIANCE=3`, `MOTION_INTENSITY=3`, `VISUAL_DENSITY=7`.

모션 예산 전부를 실제 오디오 신호에 묶인 시각화 한 곳에 쓴다. 스크롤 reveal, parallax, 진입 애니메이션은 0개.

### 2.2 컬러 락 (FE-COLORLOCK-01)

- 베이스는 중성 off-black. 순수 `#000` 금지, 쿨/웜 회색 혼용 금지.
- 액센트는 1개. progrok 저장소 배지 계보(`#16a085` / `#4cc9a6`)를 잇는 teal-green을 OKLCH primitive로 재정의하고 화면 면적 10% 미만으로 제한한다.
- 상태색은 액센트와 분리된 semantic 토큰: info / success / warning / danger.
- 사용자와 어시스턴트를 색만으로 구분하지 않는다. 위치, 라벨, 아이콘, 레벨 미터 방향을 함께 쓴다. 입력 레벨은 중성 foreground, 출력 레벨은 액센트로 고정한다.
- 토큰은 primitive → semantic → component 3계층 단방향. 컴포넌트는 primitive를 직접 소비하지 않는다.
- OKLCH는 `@supports` feature gate로 올린다. 기본 선언은 hex/sRGB.

### 2.3 형태 락 (FE-SHAPE-01)

컨트롤 8px / 패널 12px / 다이얼로그 16px / chip만 pill. 전부 pill 금지.
강조는 flat tint, 1px border, accent bar, elevation, semantic status 중 정확히 한 채널.
장식용 gradient fill, glass, neon glow 전면 금지 (FE-GRADIENT-02, FE-GLASS-01, FE-GLOW-01).

### 2.4 타이포그래피

CSP `style-src 'self'` / `default-src 'self'` 때문에 외부 폰트 로드가 불가능하다.
시스템 스택만 사용하되 CJK 폴백을 명시한다. mono는 코드/ID/시간/수치 정렬에만 쓴다 (FE-MONO-01).
UI 카피는 영어를 유지한다. 출시 제품(README, npm, CLI)이 영어이고 혼용이 더 나쁘다. `lang="en"` 유지.

### 2.5 셸 구조

- h1은 페이지 전체에 정확히 하나(워크스페이스 제목). 패널 제목은 h2.
- 톱바는 솔리드. liquid-glass pill 헤더 금지 (FE-TOPBAR-01).
- 톱바가 마케팅 카피 대신 실제 런타임 상태를 표시한다: 프록시 엔드포인트, OAuth 세션 상태, 활성 런타임 모델.
- 패널 소개 문단 제거. 각 패널은 compact toolbar 한 줄로 시작하고 첫 뷰포트에서 바로 작업 가능해야 한다 (FE-DENSITY-01).

### 2.6 라이브 보이스 — 이 리디자인의 시그니처

레퍼런스 결론(030 §1.1, §2.1)에 따라 대형 감성 오브를 쓰지 않는다.
로컬 개발 도구에는 상태 인디케이터 + 실측 레벨 바 + 대화 스트림 + 이벤트 진단이 맞다.

확정 구성:

1. 상태 칩. `#voice-status[data-state]`를 스타일 훅으로 쓴다. 8개 상태(idle / requesting-permission / minting-secret / connecting / listening / speaking / stopped / failed)를 색 + 형태 + 텍스트 3중으로 구분한다. 색만으로 표시하지 않는다 (FE-VOICE-01, FE-NAME-01).
2. 듀얼 레벨 미터. 입력(마이크)과 출력(Grok) 각각 5~9개 바. AnalyserNode 실측값만 반응한다. noise floor 이하에서는 1~2px로 수렴 (FE-VOICE-03). `prefers-reduced-motion`에서는 rAF 루프를 생성조차 하지 않고 정적 레벨 + 텍스트로 대체 (FE-REDUCED-01).
3. 트랜스크립트 스트림. partial은 55~70% opacity + caret, final은 본문 대비 100%. partial은 append가 아니라 replace (030 §3.1).
4. 인터럽션. 출력 레벨이 80~120ms 안에 수축하고 상태 칩이 즉시 전환.
5. 에러 분기. 권한 거부 / 디바이스 없음 / 보안 컨텍스트 미지원 / 네트워크를 각각 다른 복구 행동과 함께 표시 (FE-VOICE-02).

### 2.7 하지 않는 것

전체 화면 오브, WebGL, 파티클, 감정 표현 블롭, 무지개 그라디언트, soft 3D, 마스코트.
가짜 파형, 가짜 진행률, 가짜 타이핑 애니메이션 (FE-AI-HONESTY-01, FE-MEDIA-01).

## 3. 보존해야 하는 계약

010 문서 §4.1 전체. 요약:

- 필수 ID 28개와 각 native 타입(select / textarea / form / progress / button).
- `#workspace-tabs` 아래 `[role="tab"]` button과 `aria-controls` → 패널 ID 연결.
- `#chat-form` / `#media-form`의 form 의미와 `type="submit"`, 미디어 옵션이 form 자손이라는 구조.
- `.media-options--image` / `.media-options--video`가 label과 control 양쪽에 붙는 계약.
- `[hidden] { display: none !important; }` 동등 동작.
- status / messages / fatal 영역의 role, aria-live. JS가 복구해주지 않는다.
- self-hosted 경로만: `/assets/app.js`, `/style.css`, `/favicon.svg`, `/assets/pcm-worklet.js`.

## 4. Work-phase 분해

| ID | 범위 | 쓰기 스코프 | 전용 스펙 문서 |
|---|---|---|---|
| wp1 | 조사와 방향 고정 (docs only) | `devlog/_plan/260918_web_ui_redesign/` | 이 문서 |
| wp2 | 디자인 파운데이션 + 앱 셸 | `public/style.css`, `public/index.html` 셸 영역 | 040_design_system.md |
| wp3 | 라이브 보이스 서피스 | voice 패널, style.css, `client/voice.ts`, `client/pcm-playback.ts`, 신규 `client/voice-meter.ts` | 050_voice_surface.md |
| wp4 | 챗 + 미디어 서피스 | chat/media 패널, style.css, `client/render.ts` | 060_chat_media.md |
| wp5 | 검증과 폴리시 | 스크린샷 증거, 문서 동기화 | 070_verification.md |

wp3이 유일하게 TypeScript를 건드린다. 이유는 오디오 레벨 훅이 현재 존재하지 않기 때문이다(010 §3.3).
확장점은 결합도가 가장 낮은 두 곳으로 고정한다.

- 입력: MediaStreamAudioSourceNode 뒤에 병렬 AnalyserNode. 기존 PCM 전송 경로를 건드리지 않는다.
- 출력: PcmPlaybackQueue에 공용 bus 노드를 주입하고 모든 source가 그 bus를 거치게 한다.
- 정리: 기존 stop 경로(voice.ts:352-367)에서 analyser disconnect와 rAF cancel.

## 5. 완료 기준 매핑

| 기준 | 담당 work-phase | 증거 |
|---|---|---|
| c-1 1440/834/390 렌더 무파손 | wp5 | 스크린샷 |
| c-2 실측 반응 시각화 + 8상태 | wp3 | 스크린샷 + 코드 |
| c-3 partial/final 구분과 스크롤 추종 | wp3, wp4 | 스크린샷 |
| c-4 typecheck | wp5 | `npm run typecheck` |
| c-5 tests | wp5 | `node scripts/run-tests.mjs` |
| c-6 anti-slop | wp2~wp4 | 렌더 + grep |
| c-7 a11y 베이스라인 | wp2~wp5 | 키보드 경로 + 대비 측정 |
| c-8 근거 문서화 | wp1 | 이 디렉터리 |

## 6. 검증 방식

실제 렌더 캡처로만 판정한다. 정적 코드 검토는 렌더 검증을 대체하지 않는다 (FE-VISUAL-REPORT-01).

OAuth 세션이 없으면 모델 카탈로그 fetch가 실패해 UI가 fatal 상태로 고정된다.
따라서 검증은 모의 백엔드 하네스로 수행하고 각 캡처에 backend: mock을 기록한다.
모의 하네스는 `src/web/public`을 그대로 서빙하고 최소 응답만 제공한다. 운영 코드에는 모의 경로를 넣지 않는다.

