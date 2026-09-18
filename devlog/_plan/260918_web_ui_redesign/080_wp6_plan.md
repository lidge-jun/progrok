# wp6 실행 계획 (diff-level) — 모델 식별자 최신화

조사일 2026-09-19. 근거는 xAI 공식 문서.

## 확인된 현행 식별자

| 용도 | 식별자 | 출처 |
|---|---|---|
| 텍스트·추론·코딩 | `grok-4.6` (컨텍스트 500K, in $2/1M, out $6/1M) | docs.x.ai/developers/models, docs.x.ai/developers/grok-4-6 |
| 실시간 음성 | `grok-voice-latest` 별칭 | docs.x.ai/developers/model-capabilities/audio/voice |
| 이미지 | `grok-imagine-image-2.0` | docs.x.ai/developers/model-capabilities/images/generation |
| 영상 | `grok-imagine-video-1.5` (`-preview` 없음) | docs.x.ai/developers/model-capabilities/video/generation |

별칭 규칙: `<model>-latest`는 최신 추적, `<model>-<date>`는 재현용 고정.

## 범위에서 제외 (근거 있는 보류)

`grok-composer-2.5`와 `grok-build-0.1`은 **변경하지 않는다.**

- 공식 모델 목록에 없다. `grok-build`는 모델이 아니라 코딩 에이전트 제품이고 내부 모델이 `grok-4.6`다.
  `composer`는 Cursor 쪽 이름으로 보인다.
- 그러나 progrok은 API 키가 아니라 개인 OAuth 세션을 쓴다. 계정에 따라 공개 문서에 없는 식별자가
  `/v1/models`에 실제로 내려올 수 있다.
- 공개 문서 부재만으로 지우면 실제 동작 경로를 죽일 위험이 있다.
- 판단 근거는 `progrok models --json`의 실제 출력이다. OAuth 토큰이 만료 상태라 이번에 받을 수 없다.
- 사용자 확인 후 별도 단위로 처리한다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/voice/protocol.ts:2` | `PINNED_REALTIME_MODEL`을 `grok-voice-latest`로. 고정 버전 대신 별칭 |
| `src/commands/live.ts:32-33` | 화이트리스트를 별칭 + 날짜 고정 버전 패턴으로 완화 |
| `src/commands/command-manifest.ts:22` | `DEFAULT_LIVE_MODEL` 동기화 |
| `src/web/public/index.html:157` | 보이스 입력창 기본값 동기화 |
| `src/commands/video.ts:175` | `grok-imagine-video-1.5-preview` → `grok-imagine-video-1.5` |
| `src/proxy/composer-inject.ts:28` | 주석의 `grok-4.3` → `grok-4.6` |
| `README.md`, `docs/api.md`, `site/src/pages/**`, `skills/progrok/SKILL.md` | 예제의 `grok-4.3` → `grok-4.6` |
| `devlog/.../harness/serve.mjs` | QA 모의 목록을 현행 식별자로 |

## 보이스 기본값을 별칭으로 바꾸는 이유

`REALTIME_MODEL_ALIAS = "grok-voice-latest"`가 이미 `protocol.ts:3`에 있는데 기본값으로 쓰이지 않는다.
별칭을 기본값으로 두면 다음 음성 모델이 나와도 저장소를 다시 고칠 필요가 없고,
재현이 필요한 사용자는 입력창이나 `--model`에 날짜 고정 버전을 직접 넣으면 된다.

`live.ts`의 화이트리스트는 두 문자열만 허용해서 새 모델이 나오면 CLI가 막힌다.
`grok-voice-` 접두사 검사로 완화하되, 빈 문자열과 공백은 계속 거부한다.

## 검증

- `npm run typecheck`, `node scripts/run-tests.mjs`
- `rg 'grok-4\.3|imagine-video-1\.5-preview'`로 잔존 0건 확인
- `rg 'grok-voice-think-fast'`로 고정 버전 잔존 위치가 의도된 곳뿐인지 확인
- 웹앱 렌더에서 보이스 입력창 기본값 확인
- 기존 테스트가 `grok-voice-think-fast-2.0`을 단언하는지 확인하고, 단언하면 별칭 기준으로 함께 갱신


---

# wp6 계획 개정 — opencodex 카탈로그 확인 후

## 보류 철회

앞선 계획은 `grok-composer-2.5`와 `grok-build-0.1`을 "공식 문서에 없음"을 이유로 보류했다.
**철회한다.** `../opencodex/scripts/model-metadata.source.json`의 `xai` 프로바이더 블록에
33개 모델이 유지되고 있고 그 안에 둘 다 실재한다.

| ID | name | in/out ($/1M) |
|---|---|---|
| `grok-4.6` | Grok 4.6 | 2 / 6 |
| `grok-4.5` | Grok 4.5 | 2 / 6 |
| `grok-4.3` | Grok 4.3 | 1.25 / 2.5 |
| `grok-build-0.1` | Grok Build 0.1 | 1 / 2 |
| `grok-composer-2.5-fast` | Grok Composer 2.5 Fast | 0 / 0 |
| `grok-code-fast-1` | Grok Code Fast 1 | 0.2 / 1.5 |
| `grok-4.20-multi-agent-0309` | Grok 4.20 Multi-Agent (0309) | 1.25 / 2.5 |

핵심 발견: progrok README의 `grok-composer-2.5`는 **버전 문제가 아니라 오기**다.
실제 ID는 `grok-composer-2.5-fast`다.

한계: 이 카탈로그에는 `release_date`/`last_updated` 필드가 없어 파일만으로
"오늘 기준 최신"을 증명하지 못한다. 공개 문서가 `grok-4.6`을 권장하는 것과 일치한다는 점을 근거로 삼는다.

## 리뷰어가 잡은 누락 (전부 반영)

| 위치 | 내용 |
|---|---|
| `src/auth/constants.ts:34` | `DEFAULT_MODEL`. 앞 계획이 통째로 빠뜨렸다 |
| `tests/auth.test.ts:146` | 기본 모델 단언 |
| `tests/voice-cli.test.ts:59,232` | 음성 기본값 단언 |
| `tests/capabilities.test.ts:95` | capabilities 출력 단언 |
| `tests/webapp.test.ts:150,155` | 웹앱 단언 |
| `PROMO.md:43`, `PROMO.txt:36` | 홍보 문구 |

## 이름 정정

`PINNED_REALTIME_MODEL`을 별칭 값으로 바꾸면 이름이 거짓이 된다.
`DEFAULT_REALTIME_MODEL`로 **개명**한다. `REALTIME_MODEL_ALIAS`는 그대로 둔다.

`RealtimeVoiceModel`은 현재 `string`이라 별칭·접두사 허용과 타입 충돌이 없다.
리터럴 유니온으로 좁히지 않는다. 좁히면 임의 날짜 버전이 컴파일되지 않는다.

## 검증 정정

"`grok-4.3` 잔존 0건"은 성립하지 않는다. 과거 devlog 기록과 동작 검사용 fixture가 있다.
검증 대상을 `src/`, `README.md`, `docs/`, `site/src/`, `PROMO.*`, `skills/`로 한정하고
`devlog/`와 `tests/`의 의도적 fixture는 제외 사유를 적는다.


---

# wp6 감사 반영 (A-phase fold)

## J1. `PINNED_REALTIME_MODEL` 개명 파급처 전수

| 파일 | 위치 |
|---|---|
| `src/voice/protocol.ts` | 2 (정의) |
| `src/voice/realtime.ts` | 8, 18, 205 |
| `src/web/client/voice.ts` | 2, 325 |
| `tests/voice-ws.test.ts` | 17, 292 |

이 **8개 참조**를 동시에 바꾼다(protocol.ts 정의 1 + realtime.ts 3 + voice.ts 2 + voice-ws.test.ts 2).
하나라도 빠지면 컴파일이 깨진다.
`src/commands/live.ts`와 `src/commands/command-manifest.ts`는 리터럴 문자열을 쓰므로 별도로 처리한다.

## J2. `grok-composer-2.5` 오기 정정 대상 전수

| 파일 | 위치 |
|---|---|
| `README.md` | 71, 321 |
| `skills/progrok/SKILL.md` | 314 |
| `devlog/.../harness/serve.mjs` | 22 |

전부 `grok-composer-2.5-fast`로 바꾼다.

## J3. 수정하지 않기로 한 것 (리뷰어 지적 수용)

| 위치 | 사유 |
|---|---|
| `tests/webapp.test.ts:150,155` | 의도된 고정 예시다. 모델 최신성과 무관한 동작 검사 |
| `PROMO.md`, `PROMO.txt` | 리뷰어 확인 결과 이미 최신 문구다 |

## J4. 최종 변경 목록

**코드**

- `src/voice/protocol.ts` — `PINNED_REALTIME_MODEL` → `DEFAULT_REALTIME_MODEL`, 값은 `grok-voice-latest`
- `src/voice/realtime.ts` (8, 18, 205), `src/web/client/voice.ts` (2, 325), `tests/voice-ws.test.ts` (17, 292) — 참조 갱신
- `src/commands/live.ts` — 화이트리스트를 `grok-voice-` 접두사 검사로 완화
- `src/commands/command-manifest.ts` — `DEFAULT_LIVE_MODEL` 동기화
- `src/web/public/index.html` — 보이스 입력창 기본값
- `src/commands/video.ts:175` — `-preview` 제거
- `src/auth/constants.ts:34` — `DEFAULT_MODEL` → `grok-4.6`
- `src/proxy/composer-inject.ts:28` — 주석 `grok-4.3` → `grok-4.6`

**테스트**

- `tests/auth.test.ts:146`, `tests/voice-cli.test.ts:59,232`, `tests/capabilities.test.ts:95` — 새 기본값 기준으로 갱신

**문서**

- `README.md`, `docs/api.md`, `site/src/pages/**`, `skills/progrok/SKILL.md` — `grok-4.3` → `grok-4.6`, composer 오기 정정
- `devlog/.../harness/serve.mjs` — 모의 목록을 현행 식별자로

## J5. 검증

- `npm run typecheck`, `node scripts/run-tests.mjs`
- `rg 'PINNED_REALTIME_MODEL'` → 0건
- `rg 'grok-composer-2\.5(?!-fast)'` → 0건 (src, README, docs, site, skills, harness)
- `rg 'imagine-video-1\.5-preview'` → 0건
- `rg 'grok-4\.3'` → src/README/docs/site/skills에서 0건. devlog와 tests fixture는 제외(사유: 과거 기록과 의도된 고정 예시)
- 웹앱 렌더에서 보이스 입력창 기본값 확인
