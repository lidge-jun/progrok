# 01 — Plan: progrok video + image commands

## Part 1 — Summary

progrok에 `video`와 `image` 직접 생성 커맨드를 추가합니다. 현재 프록시는 모든 /v1/* 엔드포인트를 포워딩하지만, 사용자가 직접 `progrok video "prompt"` 또는 `progrok image "prompt"`로 생성할 수 있는 편의 CLI가 없습니다. ima2-gen이 발견한 video 1.5 workaround도 반영하고, capabilities 문서도 업데이트합니다.

## Part 2 — File Map

| Action | Path |
|--------|------|
| NEW | src/commands/video.ts |
| NEW | src/commands/image.ts |
| MODIFY | src/commands/capabilities.ts (add video 1.5 model) |
| MODIFY | src/auth/constants.ts (remove dead ALLOWED_PROXY_PATHS) |
| MODIFY | src/index.ts (register video + image commands) |
| NEW | tests/video.test.ts |
| NEW | tests/image.test.ts |
| MODIFY | docs/api.md (add video + image CLI docs) |

## Part 2.1 — `progrok video` command

```
progrok video "<prompt>" [options]
  --model <id>       grok-imagine-video (default) | grok-imagine-video-1.5-preview
  --duration <s>     1-15 (default: 5)
  --aspect <ratio>   16:9 (default) | 9:16 | 1:1 | 4:3 | 3:4 | 3:2 | 2:3
  --resolution <r>   480p (default) | 720p
  --image <path>     source image for I2V (file path or URL)
  --output <path>    save video to file (default: auto-named in cwd)
  --json             output structured JSON
  --timeout <s>      polling timeout in seconds (default: 600)
```

Flow:
1. Validate options
2. If --image provided, read file → base64 data URI
3. If model is 1.5-preview AND no --image (T2V): inject white 1x1 PNG workaround
4. POST /v1/videos/generations with OAuth bearer
5. Poll GET /v1/videos/{request_id} every 5s with progress display
6. On done: download video URL → save to --output
7. On failed/expired: error with code

## Part 2.2 — `progrok image` command

```
progrok image "<prompt>" [options]
  --model <id>       grok-imagine-image (default) | grok-imagine-image-quality
  --aspect <ratio>   1:1 (default) | 16:9 | 9:16 | 4:3 | 3:4 | 3:2 | 2:3 | auto
  --resolution <r>   1k (default) | 2k
  --ref <path>       reference image(s) for editing (repeatable, max 3)
  --output <path>    save image to file (default: auto-named in cwd)
  --json             output structured JSON (b64 + metadata)
  --n <count>        number of images (default: 1)
```

Flow:
1. Validate options
2. If --ref provided: read files → base64, use /v1/images/edits
3. Else: use /v1/images/generations
4. Response: save b64_json to file or print URL

## Part 2.3 — capabilities.ts update

Add to videoModels array:
```typescript
{
  id: "grok-imagine-video-1.5-preview",
  type: "video",
  use: "Video generation v1.5 (preview) — I2V improved, T2V via workaround",
  input: ["text", "image"],
  output: ["video"],
  pricing: { perSecond: 0.05, unit: "USD", note: "480p or 720p, T2V needs white-canvas injection" },
  aliases: [],
},
```

## Part 2.4 — constants.ts cleanup

Remove unused `ALLOWED_PROXY_PATHS` export (defined but never imported anywhere).

## Part 2.5 — index.ts registration

```typescript
import { videoCommand } from "./commands/video.js";
import { imageCommand } from "./commands/image.js";
// ...
program.addCommand(videoCommand());
program.addCommand(imageCommand());
// Add to REAL_COMMANDS set
```

## Phases

| Phase | Deliverable |
|-------|-------------|
| 10 | `progrok video` command + tests |
| 11 | `progrok image` command + tests |
| 12 | capabilities update + constants cleanup + index registration |
| 13 | docs/api.md update + SKILL.md update |
