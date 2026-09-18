# 웹 UI 리디자인 프런트엔드 게이트

대상: 다크 테마의 로컬 개발자 도구 워크스페이스. 챗, 실시간 음성, 미디어 생성 탭을 포함하며 데이터 밀도는 중간~높음이다. 마케팅 랜딩 규칙은 적용하지 않는다.

판정 표기:

- **STRICT**: 하나라도 실패하면 리뷰 실패.
- **DEFAULT**: 원칙적으로 적용. 예외는 제품상 이유와 검증 증거를 기록해야 한다.
- **N/A**: 해당 기능이 없을 때만 허용하며 사유를 기록한다.

## 1. 서피스 분류와 권장 다이얼

- [ ] **FE-PROFILE-01 (STRICT)** 서피스를 `D8 Developer console`로 분류한다. 코드, 로그, 메시지, 생성 작업의 inspectable state를 우선한다.
- [ ] **FE-PROFILE-02 (STRICT)** 모션 버킷은 `TOOL`로 고정한다. 스크롤 구동 모션은 0개이며, 상태 전환과 조작 피드백만 허용한다.
- [ ] **FE-DIAL-01 (DEFAULT)** `DESIGN_VARIANCE=3`. 반복 작업의 예측 가능성과 빠른 스캔을 우선하되, 탭·분할 패널·미디어 캔버스의 비대칭 구성 정도만 허용한다.
- [ ] **FE-DIAL-02 (DEFAULT)** `MOTION_INTENSITY=3`. hover, active, focus, 녹음/연결/생성 상태 전환만 사용한다. 시네마틱 진입, 패럴랙스, 스크롤 reveal은 금지한다.
- [ ] **FE-DIAL-03 (DEFAULT)** `VISUAL_DENSITY=7`. D8의 높은 정보량을 유지하되 행간, 구분선, 그룹 헤더, 안정된 툴바로 혼잡을 방지한다.
- [ ] **FE-DENSITY-01 (STRICT)** 주요 작업은 첫 뷰포트에서 시작할 수 있어야 한다. 거대한 제목, 소개용 hero, 기능 홍보 카드가 작업 영역을 밀어내면 실패다.
- [ ] **FE-DENSITY-02 (STRICT)** 모든 지표·상태를 별도 플로팅 카드로 박스화하지 않는다. 테이블, 분할 패널, compact row, 인라인 상태, 고정 툴바를 우선한다.
- [ ] **FE-DENSITY-03 (STRICT)** dense는 cramped가 아니다. 클릭 대상, 행 구분, 계층, 타임스탬프와 상태 라벨이 서로 충돌하거나 읽기 어려우면 실패다.

## 2. 반드시 지켜야 할 STRICT 게이트

### 구조와 내비게이션

- [ ] **FE-SHELL-01 (STRICT)** `nav`, `main`, `aside`, `section`, `button` 등 의미에 맞는 HTML을 사용하고 페이지당 `h1`은 정확히 하나만 둔다. 제목 단계는 한 단계 이상 건너뛰지 않는다.
- [ ] **FE-TOPBAR-01 (STRICT)** 개발자 도구의 상단 바는 예측 가능한 솔리드 헤더다. 분리된 liquid-glass pill 헤더, hero 위 부유 캡슐, 다중 pill 내비게이션을 사용하지 않는다.
- [ ] **FE-NAV-01 (STRICT)** 챗·실시간 음성·미디어 생성 탭은 올바른 tabs 패턴을 사용한다. `tablist/tab/tabpanel`, `aria-selected`, `aria-controls`를 연결하고 화살표·Home·End·Tab 키 경로를 제공한다.
- [ ] **FE-NAV-02 (STRICT)** 고정 헤더·패널·오버레이가 포커스된 요소를 가리지 않는다. skip link와 `scroll-margin` 또는 동등한 보정이 동작해야 한다.
- [ ] **FE-PANEL-01 (STRICT)** 모달, 메뉴, 콤보박스, 명령 팔레트, 시트는 각 동작에 맞는 ARIA 패턴을 사용한다. Escape로 닫고 포커스를 트리거로 돌려보내며, 모달은 포커스를 가둔다.

### 상호작용과 접근성

- [ ] **FE-KEYBOARD-01 (STRICT)** 모든 핵심 플로우를 키보드만으로 완료할 수 있다. 시각 순서와 탭 순서가 같고 `tabindex>0`은 없다.
- [ ] **FE-FOCUS-01 (STRICT)** 모든 인터랙티브 요소에 명확한 `:focus-visible` 표시가 있다. 기본·hover·focus·active 상태 변화가 레이아웃 치수를 바꾸지 않는다.
- [ ] **FE-TARGET-01 (STRICT)** 모바일 포인터 대상은 보수적 기준 44x44px을 만족한다. hover로만 발견되거나 실행되는 기능은 없다.
- [ ] **FE-NAME-01 (STRICT)** 아이콘 전용 버튼은 접근 가능한 이름을 가진다. 색만으로 연결·녹음·오류·완료·선택 상태를 표현하지 않고 아이콘, 텍스트, 형태를 함께 쓴다.
- [ ] **FE-REDUCED-01 (STRICT)** `prefers-reduced-motion: reduce`에서 비필수 애니메이션을 제거한다. JS 애니메이션·루프·리스너도 생성 전에 short-circuit하고 정적인 최종 상태를 표시한다.
- [ ] **FE-HIGHCONTRAST-01 (STRICT)** `forced-colors`와 `prefers-contrast: more`에서도 포커스, 경계, 선택, 오류 상태를 식별할 수 있다.
- [ ] **FE-SR-01 (STRICT)** VoiceOver로 제목·랜드마크 순서가 논리적이고, 탭·메뉴·대화상자·상태가 역할과 현재값을 정확히 읽는다.

### 상태와 신뢰성

- [ ] **FE-STATE-01 (STRICT)** 챗, 음성, 미디어 생성 각각에 loading/pending, empty, error, disabled, success, cancel/retry, permission-denied 상태를 실제 계약에 맞게 제공한다.
- [ ] **FE-AI-HONESTY-01 (STRICT)** 존재하지 않는 스트리밍, 인용, 도구 호출, 생성 단계, 진행률을 연출하지 않는다. 서버 이벤트가 없으면 타이핑 효과나 가짜 단계 메시지로 대신하지 않는다.
- [ ] **FE-ERROR-01 (STRICT)** 오류는 `window.alert()`나 사용자용 stack trace가 아니라 해당 필드·작업·섹션 가까이에 원인과 복구 행동을 표시한다.
- [ ] **FE-ERROR-02 (STRICT)** 주요 독립 패널은 섹션 단위 오류 경계를 가지며 재시도 수단을 제공한다. 한 패널 오류가 전체 워크스페이스를 가리지 않는다.
- [ ] **FE-CONNECTION-01 (STRICT)** SSE/WebSocket/음성 스트림은 중앙에서 소유하고 unmount·세션 종료 시 정리한다. 컴포넌트별 무제한 연결을 만들지 않고 가능한 경우 multiplex한다.

### 시각 체계

- [ ] **FE-EMOJI-01 (STRICT)** 사용자 메시지 콘텐츠를 제외하고 emoji를 버튼, 기능 아이콘, 섹션 표식, 상태 아이콘으로 쓰지 않는다. 하나의 승인된 SVG 아이콘 레이어를 사용한다.
- [ ] **FE-THEME-01 (STRICT)** 페이지 전체가 하나의 다크 테마를 유지한다. 중간 섹션만 밝거나 다른 hue로 뒤집지 않는다.
- [ ] **FE-SHAPE-01 (STRICT)** radius 체계를 문서화하고 잠근다. 예: 입력 8px, 패널 12px, 모달 16px, chip만 pill. 모든 요소를 pill로 만들지 않는다.
- [ ] **FE-COLORLOCK-01 (STRICT)** 강조색은 하나로 잠그고 전체 화면에서 같은 의미로 쓴다. 상태색(success/warning/danger/info)은 의미 토큰으로 별도 관리한다.
- [ ] **FE-GLASS-01 (STRICT)** 본문 카드, 로그 패널, 입력 폼, 사이드바 배경에 glass를 쓰지 않는다. 부득이한 미디어 오버레이도 최악 배경 대비, solid fallback, reduced-transparency 대응을 통과해야 한다.
- [ ] **FE-TYPE-01 (STRICT)** 한국어는 CJK-safe 스택을 사용하고 `lang="ko"`, `word-break: keep-all`, 긴 토큰용 `overflow-wrap`을 적용한다. 한글이 버튼·탭·테이블 헤더에서 잘리면 실패다.

## 3. 이 화면에서 위험한 2026 AI-slop tell

- [ ] **FE-GRADIENT-01 (DEFAULT)** 뒷배경 glow, gradient border, gradient card, gradient button을 겹치지 않는다. 기능 패널은 flat surface만 사용한다. ambient gradient가 꼭 필요해도 뷰포트당 최대 1개다.
- [ ] **FE-GRADIENT-02 (STRICT)** 불투명 기능 패널, 사이드바, badge, 버튼에 장식용 gradient fill을 쓰지 않는다. 강조는 flat tint, 1px border/ring, accent bar, elevation, semantic status 중 정확히 한 채널로 한다.
- [ ] **FE-ONENOTE-01 (STRICT)** terminal green, cyber cyan, CRT amber, synthwave magenta로 배경·테두리·텍스트·glow·이미지를 모두 물들이지 않는다. neutral off-black base와 면적 10% 미만의 단일 accent를 쓴다.
- [ ] **FE-BLACK-01 (DEFAULT)** 순수 `#000` 대신 깊이가 있는 off-black 계열을 사용하며 warm/cool gray를 무계획하게 섞지 않는다.
- [ ] **FE-CARD-01 (STRICT)** 모든 메트릭·메시지·도구 상태를 동일한 둥근 카드로 만들지 않는다. floating card stack, 3개 동일 카드 행, hairline border+shadow의 기계적 반복을 피한다.
- [ ] **FE-HERO-01 (STRICT)** 도구 내부에 oversized bold hero, 중앙 정렬 소개문, 버전 badge, scroll cue, 기능 홍보 문구를 넣지 않는다.
- [ ] **FE-FAKEUI-01 (STRICT)** 랜덤 수치의 fake dashboard, styled div로 만든 가짜 제품 preview, 결정 가치 없는 chart를 넣지 않는다.
- [ ] **FE-ICON-01 (STRICT)** Lucide/shadcn 기본 조합을 무검토로 복제하거나 rocket=launch, shield=security 같은 상투 아이콘을 반복하지 않는다. 한 라이브러리·한 optical weight를 유지한다.
- [ ] **FE-METACOPY-01 (STRICT)** UI가 자신의 레이아웃, 반응형 동작, 디자인 시스템, 에이전트 제작 과정을 설명하지 않는다. 문구는 사용자 작업·데이터·실제 상태만 말한다.
- [ ] **FE-COPY-01 (STRICT)** “혁신적인 솔루션”, “원활한 경험”, “Elevate”, “Seamless”, “Next-Gen”, “Oops!” 같은 번역체·AI 상투어와 lorem성 placeholder를 쓰지 않는다.
- [ ] **FE-MONO-01 (DEFAULT)** 모든 카드에 monospace uppercase micro-label을 찍지 않는다. mono는 코드, 로그, ID, 시간, 수치 정렬처럼 기능이 있는 곳에만 쓴다.
- [ ] **FE-GLOW-01 (STRICT)** neon outer glow와 과도한 그림자를 선택·포커스·활성 상태 대신 쓰지 않는다.
- [ ] **FE-SPINNER-01 (DEFAULT)** 무조건적인 원형 spinner보다 실제 레이아웃을 닮은 skeleton 또는 명확한 작업 상태를 사용한다. 단, 진행 정도를 모르면 퍼센트를 만들지 않는다.
- [ ] **FE-DECORATION-01 (STRICT)** soft 3D, mascot, 추상 blob, 장식용 영상은 이 개발자 도구의 핵심 상태를 설명하지 못하면 사용하지 않는다.

## 4. 실시간·스트리밍 UI 게이트

- [ ] **FE-STREAM-01 (STRICT)** 스트림 상태 모델은 `idle -> connecting -> streaming -> completed | cancelled | failed`처럼 실제 프로토콜 상태에 대응한다. 화면 문구와 제어가 현재 상태와 모순되지 않는다.
- [ ] **FE-STREAM-02 (STRICT)** 토큰/청크는 append-only 메시지 모델로 다루고 완료 전/후 상태를 구분한다. 이미 받은 콘텐츠를 타이핑 애니메이션으로 재생하지 않는다.
- [ ] **FE-STREAM-03 (STRICT)** 스트리밍 중에는 중지/취소가 실제 요청을 중단해야 하며, 실패 시 부분 결과의 보존 여부와 retry 범위를 명확히 표시한다.
- [ ] **FE-STREAM-04 (STRICT)** 상태 알림용 독립 live region을 둔다. 일반 진행·연결·완료는 `role="status" aria-live="polite"`, 즉시 조치가 필요한 치명 오류만 `assertive`를 사용한다.
- [ ] **FE-STREAM-05 (STRICT)** live region에 매 토큰을 넣어 화면 읽기를 폭주시켜서는 안 된다. 의미 있는 문장/상태 경계로 throttle·batch하고, 스트림 본문은 사용자가 탐색 가능한 정적 콘텐츠로 유지한다.
- [ ] **FE-STREAM-06 (STRICT)** 새 청크 도착만으로 포커스를 이동하지 않는다. 사용자가 명시적으로 “최신으로 이동”을 선택한 경우에만 논리적 위치로 이동한다.
- [ ] **FE-SCROLL-01 (STRICT)** 사용자가 최신 메시지 근처에 있을 때만 자동 추적한다. 위로 스크롤해 과거를 읽는 중이면 위치를 보존하고 “새 응답” affordance를 제공한다.
- [ ] **FE-VOICE-01 (STRICT)** 음성 UI는 권한 요청, 장치 준비, 연결 중, 듣는 중, 말하는 중, 처리 중, 음소거, 재연결, 실패 상태를 텍스트+아이콘으로 구분한다. 파형 색만으로 상태를 표시하지 않는다.
- [ ] **FE-VOICE-02 (STRICT)** mic permission denied와 device unavailable을 구분하고 각각 설정 이동 또는 재선택 같은 실제 복구 행동을 제공한다.
- [ ] **FE-VOICE-03 (STRICT)** 음성 레벨/파형은 실제 입력 신호가 있을 때만 움직인다. 장식용 가짜 파형은 금지하며 reduced-motion에서는 정적 레벨·텍스트 상태로 대체한다.
- [ ] **FE-MEDIA-01 (STRICT)** 미디어 생성은 queued/running/completed/failed/cancelled와 산출물 단위를 실제 backend 이벤트에 맞춰 표시한다. 미지의 잔여 시간을 가짜 카운트다운·퍼센트로 표현하지 않는다.
- [ ] **FE-MEDIA-02 (STRICT)** 생성 결과에는 요청과 결과의 연결, 모델/옵션·시간 등 필요한 provenance, 재시도·변형·다운로드의 명확한 결과를 제공한다.
- [ ] **FE-LIVE-01 (STRICT)** 연결 단절, 백오프 재연결, 오프라인, stale 결과를 서로 다른 상태로 표시한다. 마지막 성공 시각 또는 최신성 정보를 숨기지 않는다.
- [ ] **FE-LIVE-02 (STRICT)** 모든 비동기 버튼은 요청 중 중복 실행을 방지하되 취소나 안전한 병렬 실행까지 막지 않는다. disabled 사유는 접근 가능하게 전달한다.

## 5. 반응형·텍스트 게이트

- [ ] **FE-RESP-01 (STRICT)** canonical viewport tier를 사용한다: `<640`, `640`, `768`, `1024`, `1280`, `1536`. 재사용 패널은 viewport media query보다 container query를 우선한다.
- [ ] **FE-RESP-02 (STRICT)** 640~1024px split-screen을 독립 제품 상태로 설계한다. 좌우 패널은 최소 너비를 넘으면 접기·탭 전환·drawer 전환 중 명시된 동작을 한다.
- [ ] **FE-RESP-03 (STRICT)** 전체 셸은 폭 제한 또는 패널별 line-length 제한을 갖는다. 로그·코드는 수평 스크롤/줄바꿈 정책을 명시하고 일반 본문은 약 65ch를 넘지 않는다.
- [ ] **FE-RESP-04 (STRICT)** full-height가 필요하면 `100dvh/min-height:100dvh`를 쓰고 `100vh/h-screen`을 쓰지 않는다. 모바일 고정 바에는 safe-area inset을 적용한다.
- [ ] **FE-RESP-05 (STRICT)** 모바일은 데스크톱 열을 단순 세로 적층하지 않는다. 보조 패널은 drawer/sheet/tab으로 전환하고 핵심 composer·통화 제어는 안정적으로 접근 가능해야 한다.
- [ ] **FE-WRAP-01 (STRICT)** 제목·1~3줄 설명은 `text-wrap: balance`, 4줄 이상 본문은 `pretty`, 편집기·실시간 입력은 `stable`을 사용한다.
- [ ] **FE-WRAP-02 (STRICT)** CTA, badge, nav label은 한 줄을 유지하되 좁은 폭에서 잘리지 않도록 문구 축약 또는 레이아웃 전환을 한다. 임의 `<br>`과 폭별 문구 교체로 해결하지 않는다.
- [ ] **FE-WRAP-03 (STRICT)** URL·경로·긴 identifier·사용자 입력은 컨테이너를 깨지 않도록 `overflow-wrap:anywhere` 또는 목적에 맞는 스크롤 정책을 사용한다.
- [ ] **FE-WRAP-04 (STRICT)** 200% zoom/OS text scaling에서도 콘텐츠·조작이 손실되지 않는다. font size를 bare `vw/cqi`로만 정하지 않는다.

## 6. OKLCH 컬러 토큰과 대비 게이트

- [ ] **FE-COLOR-TOKEN-01 (STRICT)** 토큰은 primitive -> semantic -> component 3계층으로 단방향 참조한다. 컴포넌트는 primitive나 하드코딩 색을 직접 소비하지 않는다.
- [ ] **FE-COLOR-TOKEN-02 (STRICT)** 다크 테마 전환은 semantic 토큰만 재정의한다. 최소 세트에 `background`, `surface`, `surface-raised`, `foreground`, `muted-foreground`, `border`, `primary`, `primary-foreground`, `info/success/warning/danger` role triplet을 둔다.
- [ ] **FE-COLOR-OKLCH-01 (DEFAULT)** 신규 primitive는 `oklch(L C H)`로 작성하여 lightness 단계를 지각적으로 균일하게 만든다. 상태 파생은 `color-mix(in oklch, ...)`로 만들되 결과도 별도 대비 대상으로 취급한다.
- [ ] **FE-COLOR-FALLBACK-01 (STRICT)** OKLCH 미지원 fallback은 `var()` fallback이 아니라 feature gate로 제공한다. 기본 hex/sRGB 선언 후 `@supports (color: oklch(...))`에서 현대 값을 override한다.
- [ ] **FE-COLOR-ACCENT-01 (STRICT)** functional emphasis는 flat tint, border/ring, accent bar, elevation, semantic status 중 하나만 사용한다. gradient tint를 토큰 체계에 넣지 않는다.
- [ ] **FE-COLOR-CONTRAST-01 (STRICT)** 모든 테마와 모든 text/background semantic pair를 WCAG 2.2 AA로 검증한다: 일반 텍스트 4.5:1, 큰 텍스트 및 UI/그래픽 객체 3:1.
- [ ] **FE-COLOR-CONTRAST-02 (STRICT)** hover, pressed, selected, disabled, focus, 오류와 `color-mix()` 파생 상태도 각각 검증한다. 기본 상태 통과로 대신하지 않는다.
- [ ] **FE-COLOR-CONTRAST-03 (STRICT)** 입력 경계는 주변 배경과 3:1을 만족하고 default/focus/error/disabled 모두 식별 가능해야 한다.
- [ ] **FE-COLOR-CONTRAST-04 (STRICT)** 투명 미디어 오버레이가 있으면 가장 복잡하고 밝거나 어두운 실제 배경 위에서 대비를 측정한다. blur 없이는 읽을 수 없다면 불투명도를 높인다.
- [ ] **FE-COLOR-CONTRAST-05 (STRICT)** APCA는 보조 진단으로만 사용하며 WCAG 2.2 판정을 대체하지 않는다.

## 7. 모션·재질 게이트

- [ ] **FE-MOTION-01 (STRICT)** 스크롤 구동 reveal, parallax, sticky card stacking, 가로 스크롤 hijack, cinematic page load는 0개다.
- [ ] **FE-MOTION-02 (STRICT)** `transition-all`을 쓰지 않고 `transform`, `opacity`, `background-color`, `border-color`, `box-shadow` 등 필요한 속성만 열거한다.
- [ ] **FE-MOTION-03 (STRICT)** 레이아웃 위치·크기 애니메이션(`top/left/width/height`)을 피하고 transform/opacity를 사용한다. 상태 정보는 애니메이션이 없어도 이해 가능해야 한다.
- [ ] **FE-MOTION-04 (DEFAULT)** 조작 피드백은 짧고 반복 업무를 지연하지 않는다. hover/active 피드백은 허용하되 콘텐츠 카드가 과도하게 들뜨거나 이동하지 않는다.
- [ ] **FE-GLASS-PERF-01 (STRICT)** `backdrop-filter`는 기본적으로 사용하지 않는다. 꼭 필요한 작은 미디어 overlay에서도 스크롤 컨테이너 내부·크기 애니메이션과 결합하지 않으며 solid fallback을 제공한다.

## 8. 시각 검증 캡처 매트릭스

구현 완료 판정은 코드 리뷰가 아니라 실제 앱 렌더 캡처를 기준으로 한다. 각 캡처에는 route, fixture/입력, backend/mock/staging 여부, 상태, 파일 경로를 기록한다.

### 필수 뷰포트

- [ ] **FE-VISUAL-1440-01 (STRICT)** `1440x1000`: 전체 워크스페이스, 패널 비율, 정보 계층, 과도한 빈 공간, 한 줄 길이, 상단 바와 composer 고정을 확인한다.
- [ ] **FE-VISUAL-1024-01 (STRICT)** `1024x768`: desktop half/small desktop에서 사이드 패널 축소·접힘, 탭과 툴바 충돌, 미디어 프리뷰 최소 크기를 확인한다.
- [ ] **FE-VISUAL-768-01 (STRICT)** `768x1024`: split-screen/tablet portrait에서 3열이 남지 않는지, 보조 패널 전환, 키보드 포커스와 composer 접근성을 확인한다.
- [ ] **FE-VISUAL-390-01 (STRICT)** `390x844`: 모바일 정보 구조, safe area, 44px target, 음성 제어, 새 메시지 affordance, sheet/drawer 경로를 확인한다.
- [ ] **FE-VISUAL-320-01 (STRICT)** `320x700`: 긴 한국어 탭·버튼, model name, 경로·URL·수치가 잘리거나 겹치지 않는지 확인한다.
- [ ] **FE-VISUAL-WIDE-01 (STRICT)** `1536px 이상`: 패널이 무한히 늘어나지 않고 본문 line length와 작업 중심이 유지되는지 확인한다.

### 필수 상태 캡처

- [ ] **FE-VISUAL-STATE-01 (STRICT)** 챗: empty, connecting/pending, 실제 streaming, completed, cancelled, failed/retry, permission-denied를 캡처한다.
- [ ] **FE-VISUAL-VOICE-01 (STRICT)** 음성: permission prompt/denied, connecting, listening, speaking, muted, reconnecting, failed를 캡처한다.
- [ ] **FE-VISUAL-MEDIA-01 (STRICT)** 미디어: queued, running, partial/preview가 실제 존재할 때만 partial, completed, failed, cancelled를 캡처한다.
- [ ] **FE-VISUAL-INTERACTION-01 (STRICT)** keyboard focus-visible, selected tab, disabled control, open menu/dialog, error boundary, 새 메시지 affordance를 캡처한다.
- [ ] **FE-VISUAL-PREF-01 (STRICT)** reduced-motion, increased-contrast, forced-colors 및 translucency fallback을 확인한다.

### 캡처별 실패 조건

- [ ] **FE-VISUAL-FIT-01 (STRICT)** overlap, clipped text, 가려진 focus, 예상치 못한 가로 스크롤, 레이아웃 shift가 없다.
- [ ] **FE-VISUAL-KO-01 (STRICT)** 실제 한국어 긴 라벨과 혼합 한글/Latin/숫자 fixture에서 고아 어미, 중간 음절 분리, CTA 줄바꿈이 없다.
- [ ] **FE-VISUAL-LIVE-01 (STRICT)** 스트리밍 중 레이아웃이 매 청크마다 크게 흔들리지 않고, 과거 메시지를 읽는 사용자의 스크롤 위치를 빼앗지 않는다.
- [ ] **FE-VISUAL-COLOR-01 (STRICT)** 기본·hover·focus·selected·disabled·error의 대비 측정 결과를 캡처 보고서와 함께 남긴다.
- [ ] **FE-VISUAL-A11Y-01 (STRICT)** 키보드만으로 탭 전환, 메시지 전송/중단, 통화 시작/종료, 미디어 작업 취소/재시도, dialog 닫기를 완료한다.
- [ ] **FE-VISUAL-REPORT-01 (STRICT)** 각 항목을 `checked / issue / unverified / n-a`로 기록한다. 실행할 수 없었다면 실패한 명령이나 누락된 fixture/환경을 정확히 써서 `UNVERIFIED`로 남기며 정적 코드 검토를 렌더 검증으로 대체하지 않는다.

## 9. 리뷰 종료 조건

- [ ] **FE-DONE-01 (STRICT)** 모든 STRICT 항목이 checked 또는 정당한 N/A다. unresolved issue나 이유 없는 unverified가 하나라도 있으면 승인하지 않는다.
- [ ] **FE-DONE-02 (STRICT)** 디자인 다이얼, D8/TOOL 분류, 색·shape·theme lock이 실제 렌더와 일치한다.
- [ ] **FE-DONE-03 (STRICT)** 캡처 경로, 측정한 대비 pair, 테스트한 상태와 viewport, 키보드/VoiceOver 결과가 리뷰 기록에 있다.
- [ ] **FE-DONE-04 (STRICT)** 챗·음성·미디어 생성의 표시 상태가 실제 runtime 이벤트와 일치한다는 증거가 있다. 가짜 스트리밍 또는 추정 진행률이 발견되면 즉시 실패다.
