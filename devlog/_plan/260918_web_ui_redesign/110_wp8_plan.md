# wp8 실행 계획 (diff-level) — 문서와 capability 정렬

읽기 전용 조사자가 실제 CLI·카탈로그와 대조해 불일치를 파일:줄로 특정했다.

## 기준 사실 (관측값)

- 실제 `/v1/models` 12종: grok-4.20-0309-non-reasoning, grok-4.20-0309-reasoning,
  grok-4.20-multi-agent-0309, grok-4.3, grok-4.5, grok-4.6, grok-build-0.1,
  grok-imagine-image, grok-imagine-image-2.0, grok-imagine-image-quality,
  grok-imagine-video, grok-imagine-video-1.5
- `grok-composer-2.5-fast`는 카탈로그에 없다
- `DEFAULT_MODEL=grok-4.6`, `DEFAULT_REALTIME_MODEL=grok-voice-latest`
- `capabilities --json` 명령 15개, 스키마 v2

## 중대 불일치 5건

| # | 위치 | 현재 → 실제 |
|---|---|---|
| 1 | README:154-155, docs/api.md:565-575, site cli/login.astro:14-28, quickstart.astro:27-34, SKILL.md:32 | `login` 기본이 브라우저 → **실제 기본은 device-code**, 브라우저는 `--browser` |
| 2 | README:231-236,266,277,327 / docs/api.md:699-724 / SKILL.md:172 / models.astro:43 / pricing.astro:32 / cli/video.astro:12,21 / video/generation.astro:11,39 / video/smoke-matrix.astro:26-27 | `grok-imagine-video-1.5-preview` → `grok-imagine-video-1.5` |
| 3 | README:314-329, SKILL.md:305-334, models.astro:15-45 | 모델 표에 grok-4.3 / grok-4.5 / grok-imagine-image-2.0 누락. Voice 모델이 카탈로그에 없다는 구분 불명확 |
| 4 | pricing.astro:19 vs SKILL.md:311 | grok-4.6 가격이 $1.25/$2.50 ↔ $2/$6 로 **서로 충돌**. 실제는 $2/$6 |
| 5 | src/commands/capabilities.ts:125-138 | `webApp`이 host/port/url만 노출. `recommendations.note`의 "Pinned operational default"가 rolling alias와 모순 |

## 그 외

| 위치 | 수정 |
|---|---|
| README:71 | composer가 일반 카탈로그처럼 보임 → 카탈로그 미노출 사실 명시 |
| README:159 | "browser chat UI" → Chat/Voice/Media 워크스페이스 |
| docs/api.md:218 | 비디오 기본 duration 8초 → 상류 REST 기본과 progrok 기본(5초) 구분 |
| webapp.astro:11-13, cli/chat.astro:11 | 새 화면 기능 대량 누락 |
| index.astro:17-20,70-74,117-134 | Voice·워크스페이스와 7개 명령 노출 없음 |
| PROMO.md:12, PROMO.txt:12 | "한 화면" → 3탭 워크스페이스 |
| CHANGELOG.md:30-31 | 새 웹앱·보이스 런타임·파싱 변경 미기재 |
| capabilities.ts:90-92 | `voiceModels: []`가 오해 소지 → 주석/필드 의미 명확화 |
| capabilities.ts:153-156 | limitations에 브라우저 TTS ephemeral 미검증, one-secret-per-connection 누락 |

## 변경 방침

1. **사실 정정 우선.** login 기본값, video 모델 ID, 가격 충돌은 관측값으로 교정한다.
2. **모델 표는 실제 카탈로그 12종을 기준으로 재작성한다.** 카탈로그에 없는 것
   (composer, voice)은 별도 절로 분리하고 "not in /v1/models"를 명시한다.
3. **새 웹앱 기능을 문서화한다.** 3탭, 톱바 Endpoint/Catalog/Model, 보이스 상태 9종·
   입출력 미터·mute·경과시간·transport rows·이벤트 로그, 챗 스크롤 추종·New response,
   패널별 Retry, 미디어 provenance 캡션.
4. **보이스 이벤트 계약을 문서화한다.** "모르는 이벤트는 기록 후 무시하고 통화 유지,
   서버 error 이벤트만 실패."
5. **capabilities 확장.** `webApp`에 surfaces 메타데이터 추가, `recommendations.note`를
   alias 의미에 맞게 고치고, limitations 2건 추가. 스키마 v2를 깨지 않는 **추가**만 한다.
6. **CHANGELOG에 Unreleased 절**로 이번 변경을 기록한다.

## 하지 않는 것

새 기능 추가, 전송 계층 변경, 리팩터링. 외부 URL 응답성 확인(조사자도 미확인).

## 검증

- `npm run typecheck`, `node scripts/run-tests.mjs` (capabilities 스키마 테스트 포함)
- `node dist/index.js capabilities --json` 재실행해 새 필드 확인
- `rg 'imagine-video-1\.5-preview'` → 0건
- `rg 'login --device-code'` 서술이 "기본"으로 표현되지 않는지 확인
- site 빌드가 있으면 실행, 없으면 사유 기록


---

# wp8 감사 반영 (A-phase fold)

## L1. `webApp.surfaces` 구조 확정 + 테스트 단언

필드 구조를 미리 못박는다. 스키마 v2의 `webApp` 아래 **추가 키**로만 들어간다.

```ts
webApp: {
  host, port, url,                     // 기존 유지
  surfaces: [
    { name: "chat",  summary: "...", features: ["streaming", "reasoning-summary", "tool-calls", "scroll-follow", "panel-retry"] },
    { name: "voice", summary: "...", features: ["stt", "realtime", "input-meter", "output-meter", "mute", "elapsed", "transport-rows", "event-log"] },
    { name: "media", summary: "...", features: ["image", "video-polling", "provenance-caption", "cancel"] },
  ],
}
```

테스트 단언을 `tests/capabilities.test.ts`에 추가한다:
`webApp.surfaces`가 배열이고 길이 3이며 name이 정확히 `["chat","voice","media"]`,
각 항목의 `features`가 비어 있지 않은 문자열 배열일 것.

## L2. 검증 순서 정정

`dist`를 읽는 모든 검증 **앞에** `npm run build`를 둔다. 순서:

```
npm run build          # typecheck + copy-public + tsup
node dist/index.js capabilities --json   # 새 필드 확인
node scripts/run-tests.mjs
npm --prefix site run build              # site/package.json:7
```

## L3. 가격 출처 표기

`$2/$6`은 저장소 내부 근거가 아니다. 두 출처에서 왔다.

- xAI 공식 문서 `https://docs.x.ai/developers/models` (확인일 2026-09-19)
- `../opencodex/scripts/model-metadata.source.json`의 `xai.grok-4.6.cost` (input 2, output 6)

문서에 가격을 적을 때 **출처와 확인일을 함께 표기한다.** progrok 저장소가 가격의
1차 출처가 아니라는 점을 명시하고, 변동 가능성을 적는다.
`pricing.astro`와 `skills/progrok/SKILL.md`의 충돌은 $2/$6으로 통일한다.

## L4. 경로 표기 정정

계획 본문의 `SKILL.md`는 전부 `skills/progrok/SKILL.md`를 가리킨다.
저장소 루트에 동명 파일이 없으므로 혼동을 막기 위해 전체 경로로 읽는다.

## L5. 검증 항목 추가

- `rg 'imagine-video-1\.5-preview'` → 0건
- `rg -n 'grok-4\.6.*1\.25|1\.25.*grok-4\.6'` → 0건 (가격 충돌 잔존 확인)
- `capabilities --json`의 `webApp.surfaces` 길이 3, `limitations` 항목 수 증가 확인
- site 빌드 성공

