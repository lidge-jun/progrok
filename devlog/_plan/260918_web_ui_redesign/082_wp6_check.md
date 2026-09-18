# wp6 검증 기록 — 모델 식별자 최신화

## 근거

`../opencodex/scripts/model-metadata.source.json`의 `xai` 프로바이더 블록(33개 모델)과
xAI 공개 문서. 두 출처가 `grok-4.6`을 현행으로 가리킨다.

한계: 카탈로그에 `release_date`/`last_updated` 필드가 없어 파일만으로 "오늘 기준"을 증명하지 못한다.
계정 실제 카탈로그(`progrok models --json`) 대조는 OAuth 토큰 만료로 미수행.

## 변경 결과

| 항목 | 이전 | 이후 |
|---|---|---|
| `DEFAULT_MODEL` (auth/constants.ts:34) | `grok-4.3` | `grok-4.6` |
| 실시간 음성 상수 | `PINNED_REALTIME_MODEL = "grok-voice-think-fast-2.0"` | `DEFAULT_REALTIME_MODEL = "grok-voice-latest"` |
| `DEFAULT_LIVE_MODEL` | `grok-voice-think-fast-2.0` | `grok-voice-latest` |
| 웹앱 보이스 입력창 기본값 | `grok-voice-think-fast-2.0` | `grok-voice-latest` |
| `live --model` 검증 | 두 리터럴 화이트리스트 | `grok-voice-` 접두사 검사 |
| imagine 영상 | `grok-imagine-video-1.5-preview` | `grok-imagine-video-1.5` |
| composer 표기 | `grok-composer-2.5` (오기) | `grok-composer-2.5-fast` |
| README/SKILL 코딩 모델 표 | 중복 행 2개 | 병합 + `grok-code-fast-1` 추가 |
| README `grok-4.6` 컨텍스트 | 1M (grok-4.3 값 답습) | 500K |
| SKILL `grok-4.6` 가격 | $1.25 / $2.50 (구버전 값) | $2.00 / $6.00 |

## 잔존 검사 (전부 0)

| 검사 | 결과 |
|---|---|
| `PINNED_REALTIME_MODEL` in src/tests | 0 |
| `grok-4.3` in src, README, docs, site/src, skills | 0 |
| `grok-composer-2.5` (non-fast) | 0 |
| `imagine-video-1.5-preview` in src | 0 |
| `grok-voice-think-fast` in src | 0 |
| `DEFAULT_REALTIME_MODEL` 참조 | 4개 파일 전부 갱신 |

`devlog/`의 과거 기록과 `tests/webapp.test.ts`의 의도된 고정 예시는 범위에서 제외했다(리뷰어 확인).

## 게이트

- `npm run typecheck` exit=0
- `node scripts/run-tests.mjs` → tests 234 / pass 234 / fail 0

리뷰어가 예측한 4건이 정확히 실패했고(`auth.test.ts:146`, `capabilities.test.ts:95`,
`voice-cli.test.ts:59,232`) 새 기본값으로 갱신해 통과시켰다.

## 렌더 확인

하네스 카탈로그를 현행 식별자로 교체한 뒤 실제 UI에서:

- 톱바 `Catalog 7 models`, `Model grok-4.6`
- 챗 모델 목록: `grok-4.5 / grok-4.6 / grok-build-0.1 / grok-code-fast-1 / grok-composer-2.5-fast`
- 보이스 입력창 기본값 `grok-voice-latest`
- 미디어 이미지 모델 `grok-imagine-image-2.0`

## 남은 항목

계정 실제 카탈로그 대조는 `progrok login` 이후 `progrok models --json`으로 닫는다.

