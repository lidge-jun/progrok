# Interview Questions — opencode progrok 어댑터

Date: 2026-06-03

## 코드 리서치 요약

### 확인된 사실 (Known)

1. **progrok 프록시**: `127.0.0.1:18645` → `api.x.ai/v1` (전체 HTTP /v1/* 포워딩)
2. **grok-composer-2.5-fast**: `/v1/chat/completions`에서 200 응답 확인, reasoning_content 지원, 히든 모델
3. **grok-composer-2.5**: 현재 접근 불가 ("does not exist or your team does not have access")
4. **opencode 커스텀 프로바이더**: `opencode.json`의 `provider.progrok` 블록으로 등록 가능 — 현재 grok-4.3만 등록
5. **SDK**: `@ai-sdk/openai-compatible` (opencode에 bundled) — chat completions 경유
6. **opencode xAI 플러그인**: 별도로 존재 (`src/plugin/xai.ts`) — 자체 OAuth + `@ai-sdk/xai` SDK 사용
7. **progrok 인증**: `~/.progrok/auth.json` (OAuth PKCE + Device Code)
8. **progrok 모델 카탈로그**: grok-4.3, grok-build-0.1, grok-4.20 계열, grok-imagine-* (이미지/비디오)

### 미확인 / 결정 필요 (Unknown)

1. 모델 범위: opencode에 어떤 모델까지 노출할 것인가?
2. 등록 메커니즘: 어떤 방식으로 자동 등록할 것인가?
3. API 형식: chat completions vs responses API 중 어떤 것을 경유할 것인가?
4. 프록시 라이프사이클: on-demand 시작 vs 항상 실행?
5. 의존성 범위: "의존성 없이"의 정확한 의미?

## 인터뷰 질문 기록

(아래에 대화 진행 시 기록)
