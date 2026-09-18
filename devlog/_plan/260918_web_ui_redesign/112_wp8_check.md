# wp8 검증 기록 — 문서·capability 정렬

## 잔존 검사 (전부 0)

| 검사 | 결과 |
|---|---|
| `imagine-video-1.5-preview` (README/docs/site/skills) | 0 |
| `grok-4.6` + $1.25 가격 충돌 | 0 |
| `grok-composer-2.5` non-fast | 0 |
| README가 login을 브라우저 기본으로 서술 | 0 |

## 게이트

- `npm run build` 성공 (typecheck 포함)
- `node scripts/run-tests.mjs` → tests 244 / pass 244 / fail 0
- `npm --prefix site run build` → 45 page(s) built

## capabilities --json 실측

`webApp.surfaces`: chat(5 features) / voice(8) / media(4)
`limitations`: 2 → **5**
`recommendations.note`: "Rolling alias used as the operational default; realtime voice models are not listed in /v1/models."

`tests/capabilities.test.ts`에 surfaces 이름 순서와 feature 비어있지 않음 단언을 추가했다.

## 수정한 불일치

| 항목 | 이전 → 이후 |
|---|---|
| login 기본 플로우 | 브라우저 → **device-code**. `--browser`/`--manual-paste` 별도 명시 (README 3곳, docs/api.md 섹션 재배치, SKILL) |
| imagine 영상 모델 | `-preview` 접미사 제거 (8개 파일) |
| README 모델 표 | 실제 카탈로그 12종 기준 재작성. grok-4.5 / grok-4.3 / grok-imagine-image-2.0 추가 |
| 카탈로그 미노출 모델 | `grok-composer-2.5-fast`, `grok-voice-latest`를 별도 절로 분리하고 "not in /v1/models" 명시 |
| grok-4.6 가격 | pricing.astro $1.25/$2.50 ↔ SKILL $2/$6 충돌 → **$2/$6으로 통일**. grok-4.5/4.3 행 추가 |
| 가격 출처 | docs.x.ai/developers/models, 확인일 2026-09-19 명시. progrok이 1차 출처가 아님을 적시 |
| webapp.astro | 한 문단 요약 → 3탭 구조, 9개 상태, 레벨 미터 출처, 이벤트 로그 비기록 원칙, 패널별 오류 경계, provenance 캡션 |
| PROMO.md/txt | "한 화면" → 3탭 워크스페이스 + 실측 표시 항목 |
| skills/progrok/SKILL.md | Pattern 5b에 워크스페이스 실제 기능과 보이스 이벤트 계약 추가 |
| CHANGELOG.md | Unreleased 절 신설: Added 7건, Fixed 1건, Changed 3건 |
| capabilities.ts | `webApp.surfaces` 추가, note를 alias 의미로 교정, limitations 3건 추가 |

## 범위 밖으로 남긴 것

- 외부 URL 응답성 확인 (조사자도 미확인)
- `docs/api.md:218` 비디오 기본 duration 8초 서술: 상류 REST 기본값인지 progrok 기본값인지
  저장소 안에서 확정할 근거를 찾지 못해 손대지 않았다
- `site/src/pages/index.astro`의 명령 노출 확대: 랜딩 구성 변경이라 문서 정렬 범위를 넘는다

