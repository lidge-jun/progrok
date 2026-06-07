# Phase 4 Research: opencode 어댑터 자동 등록

## 목표

`npm install -g cli-jaw` 후, progrok 로그인 상태이면 opencode 모델 셀렉터에서
`progrok/grok-composer-2.5` 등 Grok 모델을 바로 선택·사용 가능하게 만든다.

## 현재 상태 (2026-06-03)

### progrok (v0.2.1)
- OAuth PKCE + Device Code 인증 (xAI 공용 client_id)
- 프록시: `127.0.0.1:18645` → `https://api.x.ai/v1` (전체 /v1/* 포워딩)
- OpenAI-compatible: `/v1/chat/completions`, `/v1/responses` 모두 지원
- 토큰 저장: `~/.progrok/auth.json` (mode 0o600)
- CLI: login, logout, proxy, chat, models, status, skill, capabilities, search, image, video

### opencode 프로바이더 시스템
- 설정 파일: `~/.config/opencode/opencode.json`
- 커스텀 프로바이더: `provider.progrok` 으로 수동 등록 가능 (현재 grok-4.3만 등록됨)
- SDK: `@ai-sdk/openai-compatible` (이미 bundled)
- xAI 네이티브 플러그인: `src/plugin/xai.ts` — 자체 OAuth 구현, `@ai-sdk/xai` SDK 사용
- 모델 셀렉터: providerID/modelID 형식 (e.g., `progrok/grok-composer-2.5`)

### cli-jaw → opencode 관계
- cli-jaw는 opencode를 CLI로 사용할 수 있음 (perCli 설정)
- cli-jaw가 opencode.json에 progrok provider를 자동 주입하는 경로가 필요

## 조사가 필요한 항목

1. **API 형식**: opencode의 xAI loader가 `sdk.responses(modelID)` 사용
   - `@ai-sdk/openai-compatible`은 chat completions만? responses도?
   - grok-composer-2.5는 어떤 API를 사용하는가?

2. **모델 카탈로그**: progrok에서 opencode로 자동 sync할 모델 목록
   - grok-4.3, grok-build-0.1, grok-composer-2.5, grok-composer-2.5-fast
   - 각 모델의 capabilities (reasoning, tool_call, attachment 등)

3. **자동 등록 메커니즘**: 의존성 없이 어떻게?
   - Option A: cli-jaw 설치 시 opencode.json에 provider 블록 자동 주입
   - Option B: progrok plugin을 opencode의 `.opencode/plugin/` 경로에 설치
   - Option C: progrok CLI가 `progrok setup opencode` 명령으로 수동 등록
   - Option D: opencode 자체에 progrok 감지 로직 PR

4. **인증 연동**: progrok 로그인 상태 감지
   - `~/.progrok/auth.json` 존재 + 토큰 유효 → 사용 가능
   - 프록시 서버 실행 필요 여부: 항상? 아니면 on-demand?

5. **Response API vs Chat Completions**
   - opencode xAI loader: `sdk.responses(modelID)` → Responses API
   - `@ai-sdk/openai-compatible`: chat completions 경유
   - grok-composer-2.5가 Responses API only인지 확인 필요

## 관련 파일

- progrok proxy: `/Users/jun/Developer/new/700_projects/progrok/src/proxy/server.ts`
- progrok auth: `/Users/jun/Developer/new/700_projects/progrok/src/auth/token-store.ts`
- progrok models: `/Users/jun/Developer/new/700_projects/progrok/src/commands/models.ts`
- opencode config schema: `/Users/jun/Developer/codex/opencode-current/packages/opencode/src/config/provider.ts`
- opencode provider loader: `/Users/jun/Developer/codex/opencode-current/packages/opencode/src/provider/provider.ts`
- opencode xai plugin: `/Users/jun/Developer/codex/opencode-current/packages/opencode/src/plugin/xai.ts`
- current opencode config: `~/.config/opencode/opencode.json`
