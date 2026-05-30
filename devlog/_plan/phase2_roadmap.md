# progrok Phase 2+ Roadmap

Phase 1 완료 (2026-05-30): OAuth login, proxy, chat UI, tests, CI, npm publish config.

## Phase 1 완료 항목 ✅

- [x] OAuth PKCE + Device Code (xAI 공용 Client ID)
- [x] Proxy server — 전체 /v1/* 포워딩 (화이트리스트 없음)
- [x] Web Chat UI — sessions, markdown, code highlight, tool parsing, copy
- [x] CLI: login, logout, proxy, chat, models (--detail), status
- [x] 36 unit/integration tests, CI workflow
- [x] 전체 xAI API 표면 OAuth 실증: responses, chat, images, videos, tts, stt
- [x] npm publish workflow, GitHub repo

## Phase 2: Chat UI 고도화

### 2A. Code Interpreter 렌더링
- `response.output_item.done (type: code_interpreter_call)` 파싱
- 코드 입력 + 실행 결과를 접이식 패널로 표시
- stdout/stderr 분리 표시

### 2B. 이미지/비디오 인라인 렌더링
- Chat에서 `grok-imagine-image` 호출 시 이미지 인라인 표시
- 비디오: request_id 폴링 → progress bar → 완료 시 video player 삽입
- `/v1/images/generations`, `/v1/videos/generations` Chat UI에서 직접 지원

### 2C. TTS/STT Chat 통합
- 마이크 버튼 → WebRTC/MediaRecorder → /v1/stt → 텍스트 입력
- 응답에 "읽기" 버튼 → /v1/tts → Audio playback
- Voice conversation mode

### 2D. File Upload
- Chat에 파일 드래그&드롭 → file_search 또는 이미지 입력
- multipart/form-data 프록시 지원 확인

## Phase 3: CLI-JAW 통합

### 3A. cli-jaw opencode 프로바이더
- `settings.json` perCli.grok에 progrok 프록시 주소 등록
- `/cli opencode` + `/model grok-4.3` → 프록시 경유 Grok 추론

### 3B. Unified Search 스킬
- `grok-search` 스킬: /v1/responses + web_search/x_search 도구
- 기존 browse/web_search 대비 1초 내 AI 요약 + citations
- auto-upgrade: OAuth 활성 시 자동으로 Grok 검색으로 전환

### 3C. Employee 모델 바인딩
- `X-Researcher` 직원에 `grok-4.20-multi-agent-0309` 바인딩
- `grok-4.20-0309-non-reasoning`: 빠른 검색 쿼리용
- `grok-build-0.1`: 코딩 작업용

## Phase 4: 고급 기능

### 4A. 다중 계정 / Credential Pool
- 여러 xAI 계정 OAuth 토큰 등록
- 429/401 시 자동 로테이션 (hermes credential_pool 패턴)

### 4B. MCP Server 모드
- `progrok mcp` → Model Context Protocol 서버로 동작
- Claude Code, Cursor 등에서 MCP tool로 Grok 호출

### 4C. npm publish 자동화
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
