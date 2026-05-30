# progrok Roadmap

Phase 1 완료 (2026-05-30): OAuth login, proxy, chat UI (테스트용), tests, CI, npm publish config.

## Phase 1 완료 항목 ✅

- [x] OAuth PKCE + Device Code (xAI 공용 Client ID)
- [x] Proxy server — 전체 /v1/* 포워딩 (화이트리스트 없음)
- [x] Web Chat UI — 테스트/데모용 (sessions, markdown, code highlight, tool parsing)
- [x] CLI: login, logout, proxy, chat, models (--detail), status, skill, capabilities
- [x] 40 unit/integration tests, CI workflow
- [x] 전체 xAI API 표면 OAuth 실증: responses, chat, images, videos, tts, stt
- [x] npm publish workflow, GitHub repo
- [x] ima2-gen 패턴 스킬 시스템: skills/progrok/SKILL.md + capabilities --json

## Phase 2: Grok 검색 스킬 ✅ (2026-05-31 완료)

네이티브 구현 — progrok login 한 사람은 OAuth 토큰 그대로 활용.

- [x] `progrok search <query>` CLI 커맨드 (src/commands/search.ts)
- [x] /v1/responses + web_search/x_search 도구로 검색 (프록시 불필요, getValidBearer 직접 사용)
- [x] AI 요약 + 중복제거 citations URL 반환, --web/--x 소스 선택, --json 구조화 출력
- [x] SKILL.md Pattern 0 + README Commands 표 + skill-contract 검증
- [x] 라이브 실증 (web/x/json 3-mode green) + 10개 신규 테스트 (총 50/50)

## Phase 3: cli-jaw opencode 프로바이더 ✅ (2026-05-31 완료)

> ⚠️ 정정: 최초 계획의 "`settings.json` perCli.grok에 프록시 주소 등록"은 **불가능**.
> cli-jaw perCli.grok에는 baseURL/proxy/endpoint 필드가 없고, grok 엔진은 xAI 공식
> Grok CLI를 `-m <model>`로 실행할 뿐 커스텀 엔드포인트 옵션이 없음. 실제 경로는
> opencode 커스텀 프로바이더(아래)뿐.

- [x] `~/.config/opencode/opencode.json`에 `progrok` 커스텀 프로바이더 등록
      (`@ai-sdk/openai-compatible`, baseURL `http://127.0.0.1:18645/v1`, model `grok-4.3`)
      — 기존 lidge/nvidia 패턴과 동일, 편집 전 백업 생성
- [x] `/cli opencode` + `/model progrok/grok-4.3` → 프록시 경유 Grok 추론
- [x] 라이브 실증: 프록시 non-stream + SSE 스트리밍 round-trip 모두 정상,
      opencode가 `progrok/grok-4.3` resolve (exit 0)
- 참고: `opencode run` 파이프(non-TTY) 출력은 **모든 프로바이더**에서 텍스트 suppress
      (progrok 고유 문제 아님 — google 대조군도 동일)

## Phase 4: 배포

- `v*` 태그 → npm publish (이미 workflow 준비됨)
- Homebrew formula 배포

## API Surface Reference (OAuth 실증 완료)

| Endpoint | Method | Verified |
|----------|--------|:--------:|
| POST /v1/responses | Streaming | ✅ |
| POST /v1/chat/completions | Streaming | ✅ |
| GET /v1/models | Sync | ✅ |
| GET /v1/language-models | Sync | ✅ |
| POST /v1/images/generations | Sync | ✅ |
| POST /v1/videos/generations | Async | ✅ |
| GET /v1/videos/{id} | Poll | ✅ |
| POST /v1/tts | Binary | ✅ |
| POST /v1/stt | Multipart | ✅ |
| POST /v1/batch/completions | Async | ⬜ 미테스트 |
| POST /v1/embeddings | Sync | ⬜ 미테스트 |
