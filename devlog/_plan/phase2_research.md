# P2 Research: cli-jaw 검색 인프라 전체 현황

## 1. 현재 검색/정보수집 계층 구조

```
┌─────────────────────────────────────────────────────────┐
│                  CLI Native Tools                        │
│  Claude Code: WebSearch, WebFetch                        │
│  Codex: web_search, open_page                            │
│  Cursor: web → WebSearch (alias)                         │
│  Gemini: generic tool_use                                │
│  OpenCode: MCP tool integration                          │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                  MCP Servers                             │
│  context7: 라이브러리/프레임워크 docs 조회 (현재 활성)     │
│  exa-mcp: 시맨틱 웹 검색 (설정 시)                       │
│  firecrawl: 웹 스크래핑 (설정 시)                        │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                  Skills (active/ref)                      │
│                                                          │
│  [ACTIVE]                                                │
│  ├── browser      CDP 브라우저 자동화 (cli-jaw browser)    │
│  └── web-ai       ChatGPT/Gemini/Grok 웹 UI 자동화        │
│                                                          │
│  [REFERENCE]                                             │
│  ├── deep-research   Gemini Deep Research API + exa + firecrawl │
│  ├── exa-search      Exa 시맨틱 검색 MCP                  │
│  ├── market-research 구조화된 시장 조사 워크플로우           │
│  ├── research-worker 읽기전용 코드베이스 탐색 + 외부 docs    │
│  └── web-perf        Chrome DevTools 성능 분석              │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                  Browser Automation                       │
│                                                          │
│  cli-jaw/src/browser/ (18,038 lines, 97 files)           │
│  ├── connection.ts   CDP 세션 관리                        │
│  ├── actions.ts      DOM 클릭/타입/스냅샷                  │
│  ├── adaptive-fetch/ URL → 콘텐츠 추출 (WAF 우회)         │
│  └── web-ai/         벤더 추상화 레이어                    │
│      ├── chatgpt.ts     904 lines (완전 구현)             │
│      ├── gemini-live.ts 617 lines (부분 구현)             │
│      └── grok-live.ts   429 lines (기본 구현)             │
│                                                          │
│  agbrowse/ (독립 리포, 20K+ lines)                        │
│  ├── web-ai/grok-live.mjs  576 lines (완전 구현)          │
│  └── web-ai/capability.mjs 프로브 런타임                  │
└─────────────────────────────────────────────────────────┘
```

## 2. 검색 도구별 상세

### 2A. CLI Native — WebSearch/WebFetch
- Claude Code, Codex 등 CLI 자체 내장
- cli-jaw는 이벤트만 중계 (🔍 아이콘 표시)
- 검색 쿼리/결과는 CLI가 제어, jaw가 직접 호출 불가

### 2B. MCP — context7 (현재 유일한 활성 MCP)
- 라이브러리 docs 조회 전용
- 일반 웹 검색 아님

### 2C. Exa Search (skills_ref, 미설치)
- 시맨틱 신경망 검색
- `web_search_exa()`, `get_code_context_exa()`
- EXA_API_KEY 필요 (유료)

### 2D. Deep Research (skills_ref, 미설치)
- Google Gemini Deep Research API
- 30분+ 소요, 자율 멀티소스 조사
- GEMINI_API_KEY 필요

### 2E. Browser web-ai (active)
- grok.com 웹 UI 브라우저 자동화
- progrok API 호출이 아닌 브라우저 제어 방식
- 검색 자체가 아닌 "AI에게 질문" 워크플로우

### 2F. Adaptive Fetch
- URL → 콘텐츠 추출 (검색 아님)
- WAF 우회, 브라우저 에스컬레이션
- 검색 쿼리 미지원 — URL 필요

## 3. 현재 검색의 한계

| 문제 | 상세 |
|------|------|
| **Grok API 검색 없음** | web_search/x_search 도구가 있는데 API로 직접 호출하는 경로가 없음 |
| **브라우저 의존** | grok 검색 = grok.com 웹 UI 자동화 = 느리고 불안정 |
| **CLI 의존** | WebSearch/WebFetch = CLI 내장 → jaw가 직접 호출 불가 |
| **유료 의존** | exa = 유료, deep-research = GEMINI_API_KEY |
| **X 검색 부재** | X/Twitter 실시간 검색 경로 전무 |

## 4. progrok이 채울 수 있는 갭

progrok OAuth가 있으면:
- **`/v1/responses` + `web_search` 도구** → 무료 웹 검색 + AI 요약 + citations
- **`/v1/responses` + `x_search` 도구** → 무료 X 실시간 검색 + AI 요약
- **`/v1/responses` + 둘 다** → 통합 검색
- **프록시 불필요** — `getValidBearer()`로 토큰 직접 사용
- **1~3초 응답** — 브라우저 자동화 대비 10~100배 빠름

## 5. 아키텍처 연동점

### 5A. progrok CLI 커맨드로 구현
```bash
progrok search "Tesla news"              # web + x 검색, 마크다운 출력
progrok search "Tesla news" --web        # web만
progrok search "Tesla news" --x          # X만
progrok search "Tesla news" --json       # JSON 출력
```

### 5B. cli-jaw skill로 등록
```
skills/progrok/SKILL.md 에 검색 섹션 추가
→ 에이전트가 `progrok search` 호출
→ 기존 WebSearch/WebFetch 대안
```

### 5C. 기존 스킬과의 관계
| 스킬 | progrok search와의 관계 |
|------|------------------------|
| browser/web-ai | 대체 — 브라우저 없이 API로 직접 검색 |
| exa-search | 보완 — exa는 시맨틱, progrok은 Grok AI 요약 |
| deep-research | 보완 — deep는 장시간 심층, progrok은 즉시 검색 |
| CLI WebSearch | 보완/대체 — jaw가 직접 호출 가능한 검색 |

### 5D. 이벤트 통합
- cli-jaw event stream에서 `progrok search` 결과를 `agent_tool` 이벤트로 노출 가능
- 🔍 아이콘 + 쿼리 라벨 표시

## 6. 미해결 설계 질문

1. **스킬 위치**: progrok 내장 CLI vs cli-jaw 독립 스킬 vs 둘 다?
2. **출력 형태**: 마크다운/JSON/둘 다?
3. **도구 조합**: web+x 항상 vs 선택적 vs 모델 자동?
4. **모델 선택**: grok-4.3 고정 vs 설정?
5. **스트리밍**: 완료 후 반환 vs SSE 스트리밍?
6. **cli-jaw 통합 깊이**: skill 파일만 vs 이벤트 스트림 통합?
