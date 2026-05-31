# 02 — Plan: progrok publish-ready (smoke + docs site + README + push)

## Part 1 — Summary

progrok을 publish-ready 상태로 만듭니다: 라이브 스모크 테스트로 모든 커맨드 동작 확인, docs.x.ai 구조를 미러링하는 30+ 페이지 GitHub Pages 문서 사이트(Astro) 생성, README에 새 커맨드 반영, 그리고 git push.

## Phases

| Phase | Deliverable | Effort |
|-------|-------------|--------|
| 10 | Live smoke test (status → search → image → video) | Small |
| 20 | README polish (commands table, models table, video 1.5) | Small |
| 30 | GitHub Pages docs site (Astro, 30+ pages, docs.x.ai mirror) | Large |
| 40 | GitHub Actions workflow for Pages deploy + git push | Small |

## Phase 10 — Live Smoke Test

Run in sequence, capture results:
1. `progrok status` — verify OAuth logged in
2. `progrok search "xAI grok video 1.5" --json` — verify search works
3. `progrok image "A simple red circle on white background" --json` — verify image gen
4. `progrok video "A slowly rotating red cube" --duration 1 --json` — verify video gen (cheapest: 1s 480p = ~$0.05)

Success: all 4 exit 0 with valid JSON output.

## Phase 20 — README Polish

MODIFY /Users/jun/Developer/new/700_projects/progrok/README.md:
- Add `video` and `image` to Commands table
- Add `search --reasoning` to Commands table
- Add `grok-imagine-video-1.5-preview` to Models table
- Add link to GitHub Pages docs site

## Phase 30 — GitHub Pages Docs Site

NEW directory: /Users/jun/Developer/new/700_projects/progrok/site/

Structure (Astro, mirroring docs.x.ai):
```
site/
├── astro.config.mjs
├── package.json
├── src/
│   ├── layouts/
│   │   └── DocsLayout.astro
│   ├── components/
│   │   ├── Header.astro
│   │   ├── Sidebar.astro
│   │   └── Footer.astro
│   └── pages/
│       ├── index.astro (landing/hero)
│       ├── docs/
│       │   ├── index.astro (overview)
│       │   ├── quickstart.astro
│       │   ├── models.astro
│       │   ├── pricing.astro
│       │   ├── text/
│       │   │   ├── generation.astro
│       │   │   ├── reasoning.astro
│       │   │   ├── structured-outputs.astro
│       │   │   ├── streaming.astro
│       │   │   └── multi-agent.astro
│       │   ├── images/
│       │   │   ├── generation.astro
│       │   │   ├── editing.astro
│       │   │   └── multi-image-editing.astro
│       │   ├── video/
│       │   │   ├── generation.astro
│       │   │   ├── image-to-video.astro
│       │   │   ├── reference-to-video.astro
│       │   │   ├── editing.astro
│       │   │   └── extension.astro
│       │   ├── voice/
│       │   │   ├── overview.astro
│       │   │   ├── tts.astro
│       │   │   ├── stt.astro
│       │   │   └── custom-voices.astro
│       │   ├── tools/
│       │   │   ├── overview.astro
│       │   │   ├── function-calling.astro
│       │   │   ├── web-search.astro
│       │   │   ├── x-search.astro
│       │   │   ├── code-execution.astro
│       │   │   └── collections-search.astro
│       │   ├── cli/
│       │   │   ├── login.astro
│       │   │   ├── proxy.astro
│       │   │   ├── search.astro
│       │   │   ├── video.astro
│       │   │   ├── image.astro
│       │   │   ├── chat.astro
│       │   │   └── models.astro
│       │   └── advanced/
│       │       ├── batch-api.astro
│       │       ├── files.astro
│       │       └── rate-limits.astro
│       └── ...
└── public/
    └── favicon.svg
```

Total pages: 35+ (landing + overview + quickstart + models + pricing + 5 text + 3 images + 5 video + 4 voice + 6 tools + 7 cli + 3 advanced)

Each page follows docs.x.ai pattern:
- Title + description
- Quick Start code example (bash with progrok)
- Configuration/Parameters table
- Response format
- Error handling (where applicable)
- Related links

Key difference from xAI docs: every example shows how to do it through progrok (either direct command or proxy + curl/SDK).

## Phase 40 — Deploy Workflow + Push

NEW: .github/workflows/pages.yml (GitHub Pages deploy on push to main)
- Build Astro site
- Deploy to gh-pages branch

Then: `git push origin main` (all changes)

## File Count Summary

| Action | Count |
|--------|-------|
| NEW (site/) | ~45 files |
| MODIFY | 1 (README.md) |
| NEW (.github/workflows/pages.yml) | 1 |
| Total | ~47 files |
