# 검증 보고서 (wp5)

측정일 2026-09-19. 브라우저: Codex in-app browser.
하네스: `devlog/_plan/260918_web_ui_redesign/harness/serve.mjs` + `dist/public`. backend: mock.

판정 표기: `checked` / `issue` / `unverified` / `n-a`.

## V1. 뷰포트 — checked

9개 폭 × 3개 탭 = **27개 조합 전수 측정**.

| 측정 | 결과 |
|---|---|
| 가로 오버플로 (`scrollWidth > innerWidth`) | **0건 / 27** |
| 컨트롤 클리핑 | 탐지기가 1건을 보고했으나 대상이 `label.sr-only`(의도적 1px 클립)였다. **실제 클리핑 0건** |

측정 폭: 320 / 390 / 640 / 768 / 834 / 1024 / 1280 / 1440 / 1600.

렌더 중 발견해 수정한 결함은 [042](042_wp2_check.md), [062](062_wp4_check.md)에 기록.

## V2. 챗 상태

| 상태 | 판정 | 근거 |
|---|---|---|
| empty | checked | 새 세션에서 `.empty-state` 렌더 |
| streaming | checked | 하네스 SSE 중 `data-status="streaming"` |
| complete | checked | 스트림 종료 후 `data-status="complete"` |
| 카탈로그 오류 + 재시도 | checked | 062. unavailable → Retry → 6 models, 배너 제거 |
| 새 응답 어포던스 | checked | 062. 위치 보존 1351px + 어포던스 노출 → 클릭 시 0 |
| pending/queued | unverified | 모의 SSE가 220ms 간격이라 queued 프레임을 안정적으로 포착하지 못했다. 하네스에 첫 청크 지연 옵션 필요 |
| stopped/cancelled | unverified | Stop 클릭 타이밍을 잡지 못했다. 같은 하네스 보강으로 가능 |
| failed | unverified | `/v1/responses` 실패 토글을 하네스에 넣지 않았다 |
| permission-denied | **n-a** | 챗은 브라우저 권한을 사용하지 않는다 |

## V3. 보이스 상태 — 정적 상태 하네스

fixture: `static state harness` (`harness/states.html`). 런타임 아님.

| 상태 | 판정 | 구분 신호 |
|---|---|---|
| idle | checked | 속 빈 원 + 중성색 |
| requesting-permission | checked | 점선 링 + amber |
| minting-secret | checked | 점선 링 + amber |
| connecting | checked | amber 링 + pulse |
| listening | checked | 채워진 점 + 링 글로우 + jade, 입력 미터 반응 |
| responding | checked | raised 칩 + 느린 pulse |
| speaking | checked | 채워진 점 + jade, 출력 미터 반응 |
| stopped | checked | 사각 마커 + 중성색 |
| failed | checked | 삼각 마커 + rose + 실제 권한 거부 문구 |
| muted 변형 | checked | MUTED 배지 |
| interrupted 변형 | checked | GROK 라벨 옆 INTERRUPTED |
| 레벨 13단계 | checked | `data-level` 0..12가 높이 2→27px **단조 증가** |
| **reconnecting** | **n-a** | 클라이언트에 재연결 로직이 없다(리뷰어가 `voice.ts:185-195`로 확인). 없는 상태를 그리는 것은 FE-AI-HONESTY-01 위반 |
| 실제 마이크 신호 모션 | **unverified** | 아래 참조 |

## V4. 미디어 상태

| 상태 | 판정 | 근거 |
|---|---|---|
| idle | checked | 빈 상태 + Ready |
| queued / running | checked | `Video job vid_mock_1: 60%`, progress 표시, Stop polling 노출 |
| completed (image) | checked | 캡션 `grok-imagine-image-0.9 · 1 image · 0.0s` |
| completed (video) + provenance | checked | 캡션 `grok-imagine-video-0.9 · 5s · 16:9 · 480p · 4.0s · job vid_mock_1` — 전부 제출 스냅샷과 실측 시간 |
| failed | unverified | 하네스에 실패 토글 미구현 |
| cancelled | unverified | 취소 타이밍 미포착 |

## V5. 상호작용·환경

| 항목 | 판정 | 근거 |
|---|---|---|
| 탭 키보드 경로 | checked | Right×2 → media-tab 선택+포커스, Home → chat-tab. roving tabindex 동작 |
| focus-visible | checked | 캡처에 jade 포커스 링 |
| open menu/dialog | **n-a** | `<dialog>`, `role="menu"`, `role="dialog"` grep **0건**. native select만 사용 |
| error boundary | checked | V2 카탈로그 오류가 곧 패널 경계 |
| translucency fallback | **n-a** | `backdrop-filter` grep **0건** |
| layout-shift / 스트리밍 안정성 | checked | 스트리밍 중 스크롤 위치 보존 확인(062) |
| 긴 식별자 fixture | checked | 톱바 endpoint/model이 말줄임으로 처리, 오버플로 0 |
| 한국어 fixture | checked | 한국어 메시지·프롬프트 입력. 버블 오버플로 0, `overflow-wrap: anywhere`, 문서 오버플로 0 |
| prefers-reduced-motion | unverified | 사용 가능한 브라우저 제어에 미디어 기능 에뮬레이션이 없다. 코드 수준으로는 `voice-meter.ts`가 rAF를 생성하지 않고 CSS 쿼리도 존재 |
| prefers-contrast: more | unverified | 같은 사유 |
| forced-colors | unverified | 같은 사유 |

## 정적 게이트 — 전부 checked

| 검사 | 결과 |
|---|---|
| emoji (`src/web`) | 0 |
| inline `style="` | 0 |
| inline `<style>` | 0 |
| 외부 http(s) 리소스 | 0 |
| `100vh` | 0 |
| `transition: all` | 0 |
| `backdrop-filter` | 0 |
| gradient (linear/radial/conic) | **0** |
| `--accent` 정의 | 1개 |
| hue 계열 | 4개 (ink / jade / amber / rose) |

## 대비 — checked (14쌍, 상태 파생 포함)

| pair | ratio |
|---|---|
| fg / bg | 18.30:1 |
| muted / surface | 7.32:1 |
| hover fg / surface-active | 14.18:1 |
| focus ring / bg | 9.58:1 |
| selected tab fg / surface-active | 14.18:1 |
| selected session fg / accent-tint | 15.70:1 |
| disabled fg / surface | 4.29:1 |
| error / danger-tint | 6.84:1 |
| warning / warning-tint | 7.95:1 |
| accent / accent-tint | 8.21:1 |
| primary btn fg / accent | 7.44:1 |
| primary btn hover fg / accent-hover | 9.18:1 |
| input border / surface-raised | 3.48:1 (UI 3:1 통과) |
| jump pill fg / accent-tint | 8.21:1 |

## 게이트

- `npm run typecheck` exit=0
- `node scripts/run-tests.mjs` → tests 234 / pass 234 / fail 0

## 남은 unverified 요약

| 항목 | 사유 | 닫는 방법 |
|---|---|---|
| 실제 마이크 신호 → 미터 모션 | OAuth 토큰 만료로 라이브 세션 불가. CSP가 `connect-src`를 `wss://api.x.ai`로 고정해 음성 소켓 모의 불가. 운영 코드 dev 우회는 거부 | `progrok login` 후 재측정 |
| 챗 pending / cancelled / failed | 하네스에 지연·실패 토글 미구현 | 하네스 보강 |
| 미디어 failed / cancelled | 같은 사유 | 하네스 보강 |
| reduced-motion / contrast / forced-colors 렌더 | 브라우저 제어에 미디어 기능 에뮬레이션 없음 | 에뮬레이션 지원 환경에서 재측정 |

정적 코드 검토를 렌더 검증으로 대체하지 않았다. 위 4건은 `unverified`로 남긴다.

