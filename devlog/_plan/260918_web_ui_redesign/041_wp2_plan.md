# wp2 실행 계획 v2 (diff-level) — 감사 반영 후 재절단

1차 감사 판정 fail. 블로커 5건의 **근본 원인은 work-phase 경계가 잘못 그어진 것**이다.
셸 CSS와 패널 CSS가 `#workspace`, `.panel`, `.panel__toolbar`, `.status-line`,
`.control-surface`, `.form-grid`, `.actions`에서 얽혀 있고(style.css:187, 244),
반응형 블록도 셸·chat·voice·media를 한 곳에서 동시에 바꾼다(style.css:266, 271).
게다가 기존 패널 규칙이 `--text`, `--muted`, `--accent-strong`를 소비하므로(style.css:123)
새 semantic 토큰으로 바꾸면 "옮겨만 두기"가 성립하지 않는다.

따라서 경계를 **화면 영역**이 아니라 **표현 계층 vs 런타임 계층**으로 다시 자른다.

## 재절단 (005 B5 표를 대체한다)

| work-phase | 새 범위 | 파일 |
|---|---|---|
| **wp2** | 마크업과 스타일 **전체**. 셸 + 보이스/챗/미디어 패널 마크업, 토큰, 전 구간 반응형 | `public/index.html`, `public/style.css` |
| **wp3** | 보이스 **런타임**: 오디오 레벨 계측, 상태·transport·event drawer 값 주입, mute | `client/voice.ts`, `client/pcm-playback.ts`, 신규 `client/voice-meter.ts` |
| **wp4** | 챗·미디어 **런타임** + 톱바 데이터: 스크롤 추종, 패널별 오류 경계, provenance, 런타임 상태 주입 | `client/chat.ts`, `client/media.ts`, `client/render.ts`, `client/app.ts` |
| wp5 | 검증 전용 (변경 없음) | — |

이렇게 하면 wp2 종료 시점에 **화면이 완결된 상태**가 되고, wp3/wp4는 그 위에 실제 데이터를 붙인다.
중간 상태에 h1이 3개 남거나 토큰이 반쪽만 적용되는 일이 없어진다.

## 블로커 해소

| 블로커 | 해소 |
|---|---|
| h1 3개 vs 유일 h1 모순 | wp2가 패널 마크업도 소유하므로 패널 h1을 h2로 강등한다. 톱바 h1 하나만 남는다 |
| `[hidden]` 등 DOM 계약 보존 미명시 | 아래 §보존 체크리스트를 검증 항목으로 승격 |
| 톱바 em dash 플레이스홀더 | **철회.** 런타임 상태 행은 `hidden`으로 시작하고, wp4가 실제 값을 주입할 때만 표시한다. `unavailable`도 실제 실패를 관측한 뒤에만 쓴다 |
| CSS 단순 이동 불가 | wp2가 style.css를 **한 번에 전면 재작성**한다. 부분 이관을 하지 않는다 |
| breakpoint 검증 부족 | 6개 구간 전부 wp2 책임으로 명시하고 320/640/768/1024/1280/1600 정적 검증 |

## 보존 체크리스트 (B 완료 전 전부 확인)

| 항목 | 확인 방법 |
|---|---|
| 필수 ID 28개 존재 | 010 §1.1 표와 grep 대조 |
| native 타입 일치 | `#chat-model`/`#media-kind`/`#media-model`/`#voice-mode`/`#voice-name`=select, `#chat-input`/`#media-prompt`=textarea, `#voice-model`=input, `#chat-form`/`#media-form`=form, `#media-progress`=progress, 나머지 button |
| `type="submit"` | `#chat-send`, `#media-submit` |
| form 자손 구조 | `#media-cancel`, `#image-count`, `#video-duration`, `#video-aspect`, `#video-resolution`가 `#media-form` 안에 |
| media 옵션 클래스 | `.media-options--image`/`.media-options--video`가 label과 control **양쪽**에 |
| 탭 계약 | `#workspace-tabs` 안 button[role=tab], aria-controls → 패널 id, 초기 aria-selected/tabindex/hidden 일관 |
| `[hidden]` 규칙 | `[hidden]{display:none!important}` 존재. 새 규칙이 display를 덮지 않는지 |
| live-region | `#fatal-error` role=alert, `#chat-status`/`#voice-status`/`#media-status` role=status aria-live=polite, `#messages` aria-live |
| 초기 disabled | 모델 의존 컨트롤이 HTML에서 disabled로 시작 |
| 자산 경로 | `/assets/app.js`, `/assets/pcm-worklet.js`, `/style.css`, `/favicon.svg`. 외부 js/css URL 0개 |
| 앱 엔트리 | `<script type="module" src="/assets/app.js">`. `type="module"` 유지 |
| 런타임 생성 class/data schema | 010 §2.1의 이름을 CSS가 계속 스타일링한다: `.empty-state`, `.message`, `.message--user`, `.message--assistant`, `.message__label`, `.message__body`, `.reasoning`, `.tool-call`, `.tool-call__status`, `.tool-call__payload`, `.citation-list`, `.muted`, `article[data-status]`, `details.tool-call[data-status]`, `#voice-status[data-state]`, `#voice-user-transcript[data-final]` |

## index.html diff-level

1. head: meta description 교정, theme-color 추가.
2. body 최상단 `<svg hidden aria-hidden="true">` 심볼 스프라이트 9개.
3. 셸: `.shell` / `.shell__rail` / `.shell__main`. 톱바 좌측 h1 하나, 중앙 탭, 우측 런타임 상태(초기 hidden).
4. "One runtime, three surfaces" 카피와 `.eyebrow` 제거.
5. 보이스 패널: 050 문서의 stage/console 구조로 전면 교체. h1→h2. 상태 칩, 미터 덱, 트랜스크립트 스트림, transport rows, event drawer 마크업 생성.
6. 챗 패널: 소개 제거, compact toolbar, 컴포저 재구성, "New response" 버튼 마크업(초기 hidden).
7. 미디어 패널: 소개 제거, compact toolbar, 옵션 그리드 재구성, 결과 영역.

## style.css 재작성 구조

`/* === SECTION: ... === */` 배너 순서:
tokens → reset/base → a11y utils → shell/rail/topbar/tabs → voice → chat → media → responsive → preferences.

반응형은 6구간 전부 wp2가 작성한다: `<640`, `640`, `768`, `1024`, `1280`, `1536+`.
`100dvh`만 사용. `transition: all` 금지. 인라인 style 0개.

## 검증

- `npm run typecheck`, `node scripts/run-tests.mjs`
- 위 보존 체크리스트 전 항목
- 정적 grep: emoji 0, inline style 0, 외부 URL 0, `100vh` 0, `transition: all` 0
- 렌더 스크린샷 320 / 640 / 768 / 1024 / 1280 / 1600 (6개 breakpoint 경계 전부. 본 상태 캡처는 wp5)

## 문서 소유권 정정

이 v2 문서가 [005_audit_fold.md](005_audit_fold.md) §B5 소유권 표와
[050_voice_surface.md](050_voice_surface.md) 머리말의 소유 파일 선언을 **대체한다.**
050이 기술하는 voice 패널 마크업과 `.voice-*` CSS는 wp2가 소유하고,
050의 API 계약·배선표·상태표는 wp3가 소유한다.
