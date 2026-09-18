# wp2 — 디자인 파운데이션과 앱 셸

소유 파일: `src/web/public/style.css`(토큰·reset·셸·톱바·탭·반응형 스켈레톤), `src/web/public/index.html`(셸·톱바·탭·아이콘 스프라이트).

## 1. primitive 토큰

hex가 기본 선언이고 OKLCH는 `@supports`로 올린다 (FE-COLOR-FALLBACK-01).
아래 OKLCH 값은 hex에서 직접 변환해 계산한 값이며 눈대중이 아니다.

| 토큰 | hex | oklch |
|---|---|---|
| --p-ink-950 | #0a0b0d | oklch(0.1493 0.0046 264.47) |
| --p-ink-900 | #101214 | oklch(0.1809 0.0052 248.12) |
| --p-ink-880 | #15181b | oklch(0.2071 0.0076 248.19) |
| --p-ink-850 | #1a1e22 | oklch(0.2326 0.0098 248.25) |
| --p-ink-800 | #21262b | oklch(0.2657 0.0118 248.27) |
| --p-ink-700 | #2b3137 | oklch(0.3098 0.0136 248.27) |
| --p-ink-600 | #3a424a | oklch(0.3749 0.0173 248.29) |
| --p-ink-450 | #69737e | oklch(0.5509 0.0210 250.74) |
| --p-ink-400 | #6f7a86 | oklch(0.5745 0.0227 250.53) |
| --p-ink-300 | #98a3ae | oklch(0.7102 0.0204 248.11) |
| --p-ink-200 | #c3cbd3 | oklch(0.8383 0.0142 248.00) |
| --p-ink-100 | #e3e8ec | oklch(0.9283 0.0076 241.67) |
| --p-ink-050 | #f4f7f9 | oklch(0.9744 0.0042 236.50) |
| --p-jade-700 | #0f7d68 | oklch(0.5281 0.0962 174.98) |
| --p-jade-600 | #16a085 | oklch(0.6318 0.1156 174.52) |
| --p-jade-500 | #22b795 | oklch(0.6977 0.1282 172.30) |
| --p-jade-400 | #4cc9a6 | oklch(0.7569 0.1222 171.19) |
| --p-jade-300 | #7edcc0 | oklch(0.8282 0.0990 172.52) |
| --p-jade-950 | #07211c | oklch(0.2258 0.0334 178.41) |
| --p-amber-400 | #e3a54a | oklch(0.7643 0.1290 73.96) |
| --p-amber-950 | #241a09 | oklch(0.2255 0.0326 79.19) |
| --p-rose-400 | #f08383 | oklch(0.7299 0.1338 20.86) |
| --p-rose-950 | #2a1416 | oklch(0.2235 0.0362 14.59) |

하늘색·보라·핑크 계열은 팔레트에 없다. 총 색상 hue는 중성 + jade + amber + rose 세 개뿐이다.

## 2. semantic 토큰

```
--bg            : ink-950
--surface       : ink-900
--surface-raised: ink-850
--surface-active: ink-800
--border        : ink-700     /* 장식 경계 */
--border-strong : ink-600     /* 구조 경계 */
--border-control: ink-450     /* 입력 경계. 3:1 게이트 대상 */
--fg            : ink-050
--fg-secondary  : ink-200
--fg-muted      : ink-300
--fg-disabled   : ink-400
--accent        : jade-500
--accent-hover  : jade-400
--accent-fg     : #04140f
--accent-tint   : jade-950
--warning       : amber-400
--danger        : rose-400
```

컴포넌트는 primitive를 직접 소비하지 않는다 (FE-COLOR-TOKEN-01).

## 3. 대비 측정 결과 (FE-COLOR-CONTRAST-01)

계산값이다. 추정이 아니다.

| pair | ratio | 판정 |
|---|---|---|
| fg / bg | 18.30:1 | AA 통과 |
| fg / surface | 17.45:1 | AA 통과 |
| fg-muted / bg | 7.67:1 | AA 통과 |
| fg-muted / surface-raised | 6.53:1 | AA 통과 |
| accent-hover / bg | 9.58:1 | AA 통과 |
| accent / bg | 7.76:1 | AA 통과 |
| accent-fg / accent | 7.44:1 | AA 통과 |
| accent-fg / accent-hover | 9.18:1 | AA 통과 |
| warning / surface | 8.71:1 | AA 통과 |
| danger / surface | 7.40:1 | AA 통과 |
| border-control / bg | 4.08:1 | UI 3:1 통과 |
| border-control / surface | 3.89:1 | UI 3:1 통과 |
| border-control / surface-raised | 3.48:1 | UI 3:1 통과 |
| border-control / surface-active | 3.16:1 | UI 3:1 통과 |
| fg-disabled / surface | 4.29:1 | 비활성 텍스트 식별 가능 |

`--border`와 `--border-strong`는 장식/구조 경계이며 3:1 대상이 아니다.
**입력 요소 경계에는 반드시 `--border-control`을 쓴다.**

## 4. 형태와 여백

| 용도 | radius |
|---|---|
| 입력·버튼·셀렉트 | 8px |
| 패널·카드 | 12px |
| 다이얼로그 | 16px |
| 상태 칩·배지 | pill |

간격 스텝: 4 / 8 / 12 / 16 / 24 / 32 / 48px. 임의 값 금지.

## 5. 타이포그래피

외부 폰트 금지(CSP). 스택:

```
--font-sans: ui-sans-serif, -apple-system, "Segoe UI Variable Text", "Segoe UI",
             "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, "Cascadia Mono", monospace;
```

스케일(모두 rem, 200% 확대 안전): 11 / 12 / 13 / 14 / 16 / 20 / 24px.
`h1`은 페이지에 하나뿐이고 20px를 넘지 않는다. 도구 안에 히어로 타이포를 만들지 않는다 (FE-HERO-01).
mono는 엔드포인트, 모델 ID, 시간, 샘플레이트, 이벤트 타입에만 쓴다.

## 6. 셸 구조

```
app-shell (grid: rail | workspace)
├─ rail      (세션 목록. 240px. 1024 미만에서 drawer)
└─ workspace (grid-rows: topbar | panels)
   ├─ topbar  (48px 솔리드. 좌: 브랜드+h1 / 중앙: 탭 / 우: 런타임 상태)
   └─ main    (패널 3개. 선택된 것만 표시)
```

톱바 우측 런타임 상태는 사실 3종만 표시한다 (005 B7-b):
`Endpoint` = `location.origin + "/v1"`, `Catalog` = `N models` 또는 `unavailable`, `Model` = 현재 선택값.

## 7. 아이콘

`index.html` 최상단 `<svg hidden aria-hidden="true">` 스프라이트 + `<use href="#i-*">`.
심볼: `i-mic`, `i-mic-off`, `i-stop`, `i-send`, `i-plus`, `i-alert`, `i-check`, `i-wave`, `i-chevron`.
stroke 1.5, 24x24 viewBox, `currentColor`. 아이콘 전용 버튼은 반드시 `aria-label`을 갖는다 (FE-NAME-01).
emoji, 외부 아이콘 CDN, 아이콘 폰트 금지.

## 8. 브레이크포인트 (FE-RESP-01)

| 폭 | 구조 |
|---|---|
| ≥1536 | 셸 최대폭 1680px, 중앙 정렬. 무한 확장 금지 |
| 1280~1535 | 기본 3열 유지 |
| 1024~1279 | 보이스/미디어 사이드 패널 축소 |
| 768~1023 | rail을 상단 가로 스크롤 스트립으로. 패널 1열 |
| 640~767 | 컨트롤 서피스가 패널 위로 접힘 |
| <640 | 탭 하단 고정, 컴포저 sticky, safe-area inset 적용 |

`100dvh`만 쓴다. `100vh` 금지 (FE-RESP-04).

## 9. 모션

전역 transition은 `transform`, `opacity`, `background-color`, `border-color`, `color`만 열거한다.
`transition: all` 금지. 지속시간 120~200ms. 스크롤 구동 모션 0개.
`prefers-reduced-motion: reduce`에서 비필수 애니메이션 제거.

