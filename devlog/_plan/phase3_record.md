# Phase 3 Record: cli-jaw opencode 프로바이더 (2026-05-31)

## 목표
progrok OAuth 프록시를 cli-jaw에서 Grok 추론 백엔드로 사용.

## 핵심 발견 — 최초 계획 정정
- **perCli.grok 경로 불가**: cli-jaw `settings.json`의 perCli 설정에는 baseURL/proxy/
  endpoint 필드가 없음. grok 엔진은 xAI 공식 Grok CLI를 `-m <model>`로 실행할 뿐,
  커스텀 OpenAI-호환 엔드포인트를 받는 옵션이 없다.
- **실제 경로**: cli-jaw는 opencode를 `~/.config/opencode/opencode.json`
  (schema https://opencode.ai/config.json)으로 구성. 여기에 커스텀
  `@ai-sdk/openai-compatible` 프로바이더를 추가하는 것이 유일한 통합 지점.

## 적용 내용
- 파일: `~/.config/opencode/opencode.json` (repo 외부 — git에는 안 잡힘)
- 백업: `~/.config/opencode/opencode.json.bak-progrok-20260531-023527`
- 추가한 프로바이더 (기존 lidge/nvidia 패턴과 동일):
  - id `progrok`, npm `@ai-sdk/openai-compatible`
  - baseURL `http://127.0.0.1:18645/v1`
  - model `grok-4.3` (name: "Grok 4.3 (progrok OAuth proxy)")

## 검증
| 체크 | 결과 |
|---|---|
| 프록시 `/v1/chat/completions` (non-stream) | ✅ grok-4.3 유효 응답 |
| 프록시 SSE 스트리밍 (opencode가 쓰는 모드) | ✅ delta → content → finish_reason:stop |
| opencode `progrok/grok-4.3` resolve | ✅ `build · grok-4.3`, exit 0 |
| opencode.json 유효성 + 프로바이더 등록 | ✅ |
| opencode 파이프(non-TTY) 텍스트 출력 | ⚠️ 전 프로바이더 공통 suppress (google 대조군 동일) — progrok 무관 |

## 사용법
```
/cli opencode
/model progrok/grok-4.3
```
프록시(`progrok proxy`)가 127.0.0.1:18645에서 떠 있어야 함.

## 남은 일
- Phase 4: npm publish (`v*` 태그 workflow) + Homebrew formula
