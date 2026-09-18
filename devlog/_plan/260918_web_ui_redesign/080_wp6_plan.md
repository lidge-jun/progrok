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

