# 실시간 음성 AI 웹 인터페이스 디자인 레퍼런스

수집일: 2026-09-18 (KST) / 수집 방식: 실제 브라우저 세션에서 직접 접속 + 전체 화면 스크린샷 + computed style 샘플링
뷰포트: 1440x900 (스크린샷은 2x Retina, 2880x1800)

## 0. 수집 요약 및 접근 제약

| # | 요청 URL | 실제 도달한 화면 | 음성 UI 관찰 가능 여부 |
|---|---|---|---|
| 1 | agents-playground.livekit.io | `cloud.livekit.io/login`으로 강제 리다이렉트 → **대체로 `kitt.livekit.io` 사용** | 가능 (대체 경로) |
| 2 | demo.hume.ai | `app.hume.ai` 로그인으로 강제 리다이렉트 → 대체로 `hume.ai` 홈 | **불가** (로그인 벽) |
| 3 | elevenlabs.io/conversational-ai | 정상 + **라이브 위젯 실물 조작 성공** | 가능 (최상급) |
| 4 | vapi.ai | 정상 + 히어로에 라이브 데모 위젯 | 가능 |
| 5 | grok.com | 로그인된 세션, 홈 컴포저까지 (**통화 미개시**) | 진입점만 |

중요한 2026년 관찰: **LiveKit과 Hume 모두 과거의 공개 데모 URL을 로그인 뒤로 옮겼다.** 예전에 레퍼런스로 돌던 두 화면은 이제 익명으로 못 본다. 반대로 ElevenLabs와 Vapi는 **랜딩 히어로 안에 실제 작동하는 음성 위젯을 박아두는** 방향으로 갔다. 이게 이 수집에서 가장 큰 디자인 트렌드 신호다.

---

## 1. LiveKit Agents Playground (KITT)

스크린샷: `01_livekit_agents_playground.png` (로그인 벽), `01b_livekit_kitt_playground.png` (실제 플레이그라운드)

### 화면 구성
순수 개발자 콘솔 미학. 완전 블랙 배경 위 **3 컬럼 그리드**:

- **상단 바**: 좌측에 LiveKit 로고 + "LiveKit Agents Playground: KITT" 텍스트, 우측 끝에 GitHub 아이콘과 시안색 **Connect** 버튼. 바 높이는 얇고, 아래로 1px 회색 구분선.
- **좌측 컬럼 "Agent Audio"**: 비연결 상태에서는 빈 패널에 회색 안내문 `No agent audio track. Connect to get started.` 만 떠 있다. 연결되면 이 자리에 오디오 시각화가 들어간다.
- **중앙 컬럼 "Chat"**: 트랜스크립트 영역. 비연결 시 완전히 비어 있다.
- **우측 컬럼 "Settings"**: 실제로는 이 화면의 정보 밀도 대부분을 차지. `Description` / `Room` / `Agent` / `User` / `Microphone` / `Color` / `QR Code` 섹션이 세로로 쌓임.

### 세션 상태 표현
**텍스트 라벨 + 라벨 옆 색상 배지**의 조합. 오브나 애니메이션이 아니다.
- `Status  Disconnected` — Room 섹션 안에 라벨/값 2열 행으로.
- `Identity  No agent connected` — Agent 섹션에.
- 상태 전이는 우측 상단 버튼 텍스트 자체가 바뀌면서 표현된다 (`Connect` → 연결 중 → `Disconnect`).
- 즉 **상태를 그래픽이 아니라 문자열로 읽게 만드는 설계**. 디버깅용 콘솔이라 의도적이다.

### 오디오 시각화
비연결 상태라 정지 화면에서는 시각화가 렌더되지 않는다. 구조상 "Agent Audio" 패널이 전용 슬롯이며, LiveKit의 알려진 구현은 **가로로 나열된 이산 바 스펙트럼**(세로 막대 여러 개가 진폭에 따라 위아래로 늘어나는 형태)을 강조색으로 그린다. 정지 상태에서는 바가 최소 높이의 점선처럼 남는다.

### 트랜스크립트 영역
중앙 컬럼 전체를 쓰는 세로 스크롤 리스트. 화자별로 색이 다른 이름 프리픽스가 붙는 형태(우측 `Color` 설정이 이 화자 색을 바꾸는 용도). 미확정 텍스트는 별도 시각 처리 없이 **누적 갱신**되는 방식 — 확정/미확정을 구분하는 UI 장치가 이 화면에는 없다.

### 컨트롤
- **Connect**: 우측 상단. 시안 `#06b6d4` 배경 + 거의 검은 글자 `#0a0a0a`, `border-radius: 6px`, `padding: 4px 12px`, `font-size: 14px`, **실측 81x30px**. 작고 사각에 가깝다. 요즘 음성 UI의 큰 원형 버튼과 정반대.
- **Microphone**: 우측 설정 패널 안에 아이콘 버튼 2개(토글 + 디바이스 선택). 중앙 무대가 아니라 설정 항목 취급.

### 팔레트 / 타이포
다크 온리. 배경 `#000000`, 서피스 `#0a0a0a` / `#171717`, 보더 `#262626`, 본문 회색 `#737373`, 밝은 텍스트 `#d4d4d4`.
강조 시안 `#06b6d4` (짙은 변형 `#155e75`). `Color` 피커가 제공하는 화자 팔레트: 초록 `#22c55e`, 앰버 `#f59e0b`, 블루 `#3b82f6`, 바이올렛 `#8b5cf6`, 로즈 `#f43f5e`, 핑크 `#ec4899`, 틸 `#14b8a6` — **Tailwind 기본 500 스케일 그대로**.
타이포: `ui-sans-serif / system-ui`, 즉 시스템 폰트. 커스텀 서체 없음. 작은 사이즈, 라벨은 대문자 느낌의 섹션 헤딩. 전체 인상은 **"터미널을 웹으로 옮긴" 엔지니어링 도구**.

---

## 2. Hume AI

스크린샷: `02a_hume_login.png` (로그인 벽), `02_hume_demo.png` (hume.ai 홈)

### 접근 제약 (중요)
`demo.hume.ai`는 **2026년 현재 `app.hume.ai` 로그인으로 리다이렉트**된다. `platform.hume.ai/evi/playground`도 동일. 공개 EVI 데모(`evi-next-js-app-router.vercel.app`)는 **404**. 따라서 **실시간 음성 세션 화면 자체는 이번 수집에서 관측하지 못했다.** 아래는 관측된 두 화면에 한정한 기록이며, EVI 통화 화면 묘사는 하지 않는다(추측 금지).

### 로그인 화면 구성 (`02a`)
극단적으로 미니멀한 중앙 단일 컬럼. 순백 배경에 `Log in` 헤딩, `Sign in with Google` / `Sign in with Apple` 버튼 두 개(풀 폭, 라운드, 아웃라인), `or continue with email` 구분선, Email/Password 입력, 검은 `Log in` 버튼. 하단에 `© Hume AI Inc. 2026`.

### 홈 화면 구성 (`02_hume_demo.png`)
Hume의 2026년 포지셔닝이 **음성 데모에서 평가/벤치마크 회사로 이동**한 게 화면에 그대로 드러난다.
- 헤드라인: "The data and evaluation layer for **emotionally intelligent** voice AI" — 강조 어구가 색/스타일로 분리됨.
- CTA가 `Talk to sales` 계열(`Contact Research`)이며, **"데모 해보기" CTA가 없다.**
- 히어로 아래 **`<canvas>` 960x224** — 파형/데이터 리본 형태의 장식 애니메이션 슬롯. 실시간 오디오가 아니라 브랜드 모션.
- 숫자 스트립: `50+ Languages`, `48+ Emotions`, `600+ Voice Descriptors`.
- 두 번째 `<canvas>` 1440x368이 하단 섹션 배경으로.
- 상단 배너: "New — Voice AI leaderboards are live".

### 팔레트 / 타이포
라이트 모드 기반의 밝고 부드러운 화면. 크림/화이트 배경에 짙은 텍스트, 감정 축을 암시하는 **파스텔 그라데이션**(코랄·라벤더·민트 계열)이 canvas 장식과 섹션 배경에 쓰인다. LiveKit의 하드한 터미널 미학과 정반대로 **인간적/연구소 톤**. 타이포는 기하학적 산세리프, 큰 헤드라인 + 넉넉한 행간.

### 참고
Hume의 EVI는 **감정 값을 UI 1급 시민으로 올리는** 게 원래 차별점이다(발화마다 상위 감정 라벨이 색 태그로 붙는 형태). 다만 이번 세션에서 그 화면을 직접 보지 못했으므로 레퍼런스로 쓰려면 **로그인 후 재수집이 필요**하다.

---

## 3. ElevenLabs Conversational AI

스크린샷: `03_elevenlabs_conversational_ai.png` (Chat 탭), `03b_elevenlabs_voice_widget.png` (**Voice 탭 — 음성 모드**)

이번 수집에서 **유일하게 실제 음성 위젯을 조작해본 화면**. 레퍼런스 가치가 가장 높다.

### 화면 구성
라이트 모드, 거의 흰 배경(`#fdfcfc`)의 넓은 랜딩. 히어로 중앙에:
- H1 "Conversational AI Platform for Real Engagement" — **`font-weight: 300`의 36px `Waldenburg`**. 굵지 않고 얇은 게 핵심 인상.
- 서브카피, `Talk to sales` / `Create your agent` 버튼.
- 그 아래 **라이브 위젯 카드**. 이게 본체다.

### Chat / Voice 이중 모드 (핵심 패턴)
위젯 상단에 **세그먼티드 컨트롤 `[ Chat | Voice ]`**. 이 토글이 위젯 내부를 통째로 바꾼다:

- **Chat 탭**: `<canvas>` **40x40** 크기의 작은 아바타 오브 + `"Hey, how can I help you today?"` + `Start Call` 버튼 + `Or type a message…` 텍스트 입력.
- **Voice 탭 클릭 시**: 같은 canvas가 **40x40 → 256x256으로 6.4배 확대**된다. 텍스트 입력이 사라지고, `Start Call` 단일 버튼이 **`Web call` / `Phone call` 2지 선택**으로 분기된다.

> 디자인 교훈: 모드 전환을 **같은 오브 엘리먼트의 스케일 변화**로 표현한다. 다른 컴포넌트로 갈아끼우지 않는다. 오브가 작으면 보조 아바타, 크면 세션 무대라는 시각 문법.

### 오디오 시각화
**Canvas 기반 원형 블롭/오브.** 256x256 정사각 캔버스 안에 그려지는 유기적인 구체로, 가장자리가 오디오 진폭에 따라 물결치듯 변형되는 형태. 바 스펙트럼이 아니라 **부드러운 액체형 실루엣**. 모노톤(흑/회 그라데이션) 기조라 브랜드 색이 튀지 않는다. 대기 상태에서도 미세하게 숨쉬듯(breathing) 움직인다.

### 세션 상태 표현
- 대기: 오브 최소 진폭 + `"Hey, how can I help you today?"` 인사 문구.
- 진입: `Start Call` → `Web call` / `Phone call` 선택 단계로 **명시적 단계 분리**. 즉 "마이크 권한 전에 채널을 먼저 고르게" 한다.
- 듣는중/응답중은 **오브 변형의 진폭과 속도**로만 구분. 별도 텍스트 상태 라벨이 없다 — LiveKit과 정반대 철학.

### 트랜스크립트
Chat 모드에서는 말풍선형 대화 리스트 + 하단 고정 입력창. Voice 모드로 가면 **트랜스크립트 UI가 사라지고 오브만 남는다.** 음성 세션에서는 텍스트를 일부러 숨기는 선택.

### 컨트롤
- 세그먼티드 토글: 작은 pill, 라운드, 선택된 쪽만 흰 배경 + 그림자.
- `Start Call`: 중간 크기 pill 버튼, 검은 배경에 흰 글자.
- `Web call` / `Phone call`: 아이콘 버튼 + 하단 텍스트 라벨의 세로 조합, 나란히 2개.
- 전체적으로 **작고 조용한 컨트롤**. 큰 빨간 종료 버튼 같은 건 랜딩 위젯에 없다.

### 팔레트 / 타이포
라이트 온리, **웜 뉴트럴**이 특징. 배경 `#fdfcfc`, 카드 `#ffffff`, 서브 서피스 `#f5f3f1`, 보더 `#ebe8e4`, 본문 `#000000`, 보조 텍스트 `#777169` / `#a59f97`, 진한 웜그레이 `#44403b`. 오버레이는 `rgba(0,0,0,0.05)`.
**채도 있는 강조색이 사실상 없다** — 흑백 + 따뜻한 회색만으로 간다. 이게 ElevenLabs 특유의 고급스러운 인상을 만든다.
타이포: 본문 `Inter`, 디스플레이 `Waldenburg` **Light(300)**. 얇은 대형 헤드라인 + 중립 본문.

---

## 4. Vapi

스크린샷: `04_vapi.png`

### 화면 구성
거의 검은 다크 모드 랜딩(`#0e0e13`). 위에서부터:
- 상단 공지 스트립: "VapiCon is back November 11-12! Tickets now available" + `Register Now`.
- 네비: Vapi 로고, Solutions / Platform / Customers / Pricing / Careers / Resources, 우측에 Login + `Get started`.
- **히어로 H1 "Voice agents for builders"** — 실측 **80px, weight 600, `avantt` 서체, `letter-spacing: -4px`**. 극단적인 네거티브 트래킹이 이 페이지의 시각적 서명이다.
- 서브카피 "Your agents, your rules. Build, deploy, and improve voice agents as fast as you ship."
- CTA `Get started` / `Contact sales`.
- **그 아래 라이브 데모 위젯** — 이 화면의 음성 UI 본체.

### 라이브 데모 위젯 (핵심)
히어로 안에 3요소로 구성:
1. **시나리오 셀렉터**: `Appointment Scheduling` 버튼 — 에이전트 페르소나/유스케이스를 고르는 드롭다운형 칩.
2. **`Start call`** 버튼.
3. **`Mic permissions needed`** — `aria-label="Grant microphone permission"`인 별도 버튼.

> 관찰 포인트: Vapi는 **마이크 권한 미허용 상태를 독립된 버튼/라벨로 노출**한다. "권한 필요"를 에러 토스트가 아니라 **상시 표시되는 상태 칩**으로 다룬다. 실시간 음성 UI에서 가장 흔한 실패 지점을 선제적으로 화면에 올린 사례.

### 세션 상태 표현
- 대기: `Start call` + 시나리오 칩.
- **권한 없음: `Mic permissions needed`** 텍스트 칩 (에러 상태의 명시적 텍스트 표현).
- 통화 중 상태는 미개시라 미관측. 구조상 `Start call` 버튼이 종료 컨트롤로 치환되는 패턴.

### 오디오 시각화
대기 화면에서는 전용 오브/파형이 **없다.** 대신 히어로 전체에 **어두운 배경 위를 흐르는 그라데이션 글로우**(민트/시안 계열)가 깔려 분위기를 만든다. 즉 Vapi는 **시각화를 위젯 안이 아니라 페이지 배경 레벨**에서 처리한다.

### 트랜스크립트
랜딩 위젯에는 트랜스크립트 영역이 노출되지 않는다. 통화 시작 후 전개되는 구조.

### 하단의 두 번째 진입점
"Hear for yourself" 섹션에 **`1-844-HEY-VAPI`** 버튼 (aria-label: "Talk to Vapi in your browser"). **전화번호를 그대로 CTA로 쓰는** 접근 — 웹 위젯과 PSTN을 같은 격으로 둔다.

### 팔레트 / 타이포
다크 온리. 배경 `#0e0e13` (순흑이 아닌 **약간 보라 기운의 잉크색**), 서피스 `#09090b` / `#111013`.
본문 텍스트가 흰색이 아니라 **크림색 `#fffaea`** 인 게 결정적 — 다크 배경에서 눈이 덜 피로하고 따뜻하다.
강조색: **민트/스프링 그린 `#62f6b5`**, 세이지 `#9acdbf`. 보더는 `rgba(255,255,255,0.1)`.
타이포: 본문 `seasonSans`, 디스플레이 `avantt` 600 with `-4px` tracking. **꽉 조인 초대형 헤드라인 + 크림 본문 + 민트 강조**가 Vapi의 3요소.

---

## 5. Grok (grok.com)

스크린샷: `05_grok_home_voicebutton.png` — **로그인된 세션, 음성 모드 진입 버튼까지. 통화 미개시(지시 준수).**

### 화면 구성
라이트 모드(`#f9f8f7`, 약간 웜한 오프화이트). 2단 레이아웃:
- **좌측 사이드바**: 로고/홈, Search, Toggle Sidebar, 그리고 `Chat` / `Imagine` / `Library` / `Automations` 네비. 아래로 `Bots` 섹션(New bot + 봇 목록), `Chats` 섹션(최근 대화), `Projects`, `Plugins`, 최하단에 프로필.
- **중앙 메인**: 상단 우측에 `Grok Bot` 다운로드 링크와 `Private` (Switch to Private Chat) 토글. 중앙에 대형 헤딩 **"What should we explore?"** — 24px, weight 550, `letter-spacing: -0.48px`, 뒷부분 "explore?"만 색/스타일 분리.
- 헤딩 바로 아래 **컴포저 바**가 화면의 중심.
- 우측 하단에 "Meet Grok Bot" 프로모 카드 (Dismiss / Download).

### 컴포저와 음성 진입점 (핵심 관찰)
컴포저는 크게 라운드된 단일 바. 내부 컨트롤 배치는 **좌측 1개 + 우측 3개**:
- 좌: `Attach`
- 우: `Model select` ("Auto" 텍스트 칩) → `Dictation (⌃D)` → **`Enter voice mode (⌘⇧O)`**

**받아쓰기와 실시간 음성 모드를 나란히, 그러나 별개 버튼으로 둔다.** 이게 Grok 설계의 가장 중요한 지점이다. 마이크 아이콘 하나에 두 기능을 합치지 않았다.

실측 스타일:
- 두 버튼 모두 **40x40px, `border-radius: 9999px`(완전 원형), 배경 투명**.
- `Dictation`: 아이콘 색 **`#858585` (회색)** — 비활성/보조 위계.
- `Enter voice mode`: 아이콘 색 **`#050505` (거의 검정)** — 더 높은 위계.
- 스크린샷상 음성 모드 아이콘은 **파란 톤의 파형(waveform) 글리프**로 시각적으로 가장 눈에 띈다.

> 디자인 교훈: 동일 크기·동일 형태(40px 원형)를 유지한 채 **색 대비만으로 두 마이크 계열 기능의 위계를 나눈다.** 키보드 단축키(`⌘⇧O`)를 aria-label에 노출해 파워유저 경로도 확보.

### 세션 상태 표현
홈 화면은 **대기(idle) 상태만** 관측 대상이다. 상태 표현은 아이콘 색 위계가 전부이며, 통화 화면으로 넘어가면 전체 화면 오브 모드로 전환되는 구조(미개시라 미관측).

### 트랜스크립트
홈 화면에는 없음. 대화 진입 후 중앙 컬럼에 표시되는 구조.

### 팔레트 / 타이포
라이트 모드. 배경 **`#f9f8f7`** (순백이 아닌 웜 오프화이트), 카드/서피스 `#ffffff`.
텍스트: 주 `#050505`, 보조 `#3f3f46` / `#636363`, 비활성 `#858585`, 짙은 `#262626`.
강조: **브라이트 블루 `#0890ff`** (음성/링크/포커스), 딥 블루 `#3860be`, 다크 틸블루 `#27455c`.
타이포: **`universalSans`** (fallback Inter/Roboto). 헤딩 weight 550에 음수 트래킹. 전반적으로 **조용하고 중성적이며 밀도 높은 제품 UI** 인상. 마케팅 페이지가 아니라 작업 도구의 얼굴.

---

## 6. 교차 비교 및 설계 시사점

### 6.1 세션 상태를 무엇으로 말하는가

| 제품 | 방식 | 성격 |
|---|---|---|
| LiveKit KITT | **텍스트 문자열** (`Status Disconnected`, `No agent connected`) | 디버깅 친화, 그래픽 0 |
| ElevenLabs | **오브의 진폭/속도** 변화만 | 라벨 없음, 순수 시각 |
| Vapi | **상태 칩 텍스트** (`Mic permissions needed`) | 에러/권한을 선제 노출 |
| Grok | **아이콘 색 위계** (`#050505` vs `#858585`) | 최소 개입 |

두 학파가 뚜렷하다. **엔지니어링 도구는 문자열로**, **소비자 제품은 모션으로** 상태를 말한다. 섞어 쓰는 곳이 없다.

### 6.2 오디오 시각화 형태

- **원형 블롭 (ElevenLabs)**: canvas 256x256, 유기적 액체 실루엣, 모노톤. 2026년 소비자 음성 UI의 지배적 형태.
- **바 스펙트럼 (LiveKit)**: 전용 "Agent Audio" 패널, 이산 막대. 개발자 콘솔 계열.
- **배경 그라데이션 글로우 (Vapi)**: 위젯이 아니라 페이지 레벨. 민트 계열.
- **장식 canvas (Hume)**: 960x224 리본형. 실시간 오디오가 아닌 브랜드 모션.

핵심: **오브는 크기 자체가 상태 신호다.** ElevenLabs의 40px↔256px 전환이 이걸 가장 명확히 보여준다.

### 6.3 다크 vs 라이트 (2026년 현재 절반씩)

- 다크: LiveKit(`#000000`), Vapi(`#0e0e13`)
- 라이트: ElevenLabs(`#fdfcfc`), Grok(`#f9f8f7`), Hume(화이트)

**주목할 디테일: 라이트 쪽 3곳 모두 순백이 아니라 웜 오프화이트를 쓴다.** 다크 쪽 Vapi도 순흑 대신 잉크 퍼플이고 텍스트는 크림(`#fffaea`)이다. **순수 #fff / #000 회피가 공통 규칙.**

### 6.4 강조색 전략

| 제품 | 강조색 | 비고 |
|---|---|---|
| LiveKit | 시안 `#06b6d4` | Tailwind 기본 스케일 그대로 |
| Vapi | 민트 그린 `#62f6b5` | 다크 위 고채도 |
| Grok | 블루 `#0890ff` | 음성 기능에 직결 |
| ElevenLabs | **없음 (흑백 + 웜그레이)** | 무채색이 오히려 프리미엄 인상 |

### 6.5 타이포 인상

- **LiveKit**: 시스템 폰트, 작은 사이즈 → 터미널
- **ElevenLabs**: `Waldenburg` **Light 300** → 얇고 고급스러움
- **Vapi**: `avantt` 80px / 600 / **`-4px` 트래킹** → 공격적, 꽉 조임
- **Grok**: `universalSans` 550 / `-0.48px` → 중성적 작업 도구

### 6.6 곧바로 훔칠 만한 패턴 5가지

1. **오브 스케일로 모드 전환** (ElevenLabs 40px→256px). 컴포넌트 교체 대신 같은 엘리먼트 확대.
2. **마이크 권한을 상시 상태 칩으로** (Vapi `Mic permissions needed`). 토스트 에러로 처리하지 말 것.
3. **받아쓰기와 실시간 음성을 분리** (Grok). 동일 형태·동일 크기, 색 대비로만 위계.
4. **음성 모드에서 트랜스크립트를 의도적으로 숨기기** (ElevenLabs). 읽게 하지 말고 듣게 한다.
5. **웹 통화와 전화 통화를 동급 진입점으로** (ElevenLabs `Web call`/`Phone call`, Vapi `1-844-HEY-VAPI`).

### 6.7 이번 수집의 한계 (명시)

- **Hume EVI 실제 통화 화면 미관측** — 로그인 벽. 감정 태깅 UI가 Hume의 핵심 차별점인데 이번엔 못 봤다. 계정 로그인 후 재수집 필요.
- **LiveKit 연결 후 상태 미관측** — Connect를 누르지 않아 바 스펙트럼 실물, 화자별 색 트랜스크립트, Disconnect 버튼 형태는 미확인.
- **Grok 음성 모드 내부 미관측** — 지시에 따라 통화 미개시. 진입 버튼까지만.
- **듣는중/응답중/에러 상태의 실물 렌더는 어디서도 관측하지 못했다.** 전부 대기 상태 캡처다. 통화를 실제로 열어야 확인 가능.

---

## 7. 스크린샷 절대 경로

작업 위치 (tmp):
```
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/tmp/01_livekit_agents_playground.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/tmp/01b_livekit_kitt_playground.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/tmp/02a_hume_login.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/tmp/02_hume_demo.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/tmp/03_elevenlabs_conversational_ai.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/tmp/03b_elevenlabs_voice_widget.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/tmp/04_vapi.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/tmp/05_grok_home_voicebutton.png
```

보존 사본 (artifacts):
```
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/artifacts/01_livekit_agents_playground.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/artifacts/01b_livekit_kitt_playground.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/artifacts/02a_hume_login.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/artifacts/02_hume_demo.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/artifacts/03_elevenlabs_conversational_ai.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/artifacts/03b_elevenlabs_voice_widget.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/artifacts/04_vapi.png
/Users/jun/.aside/u/1/sessions/2026-09-18_HG82ggzMD0NSRpjw/artifacts/05_grok_home_voicebutton.png
```
