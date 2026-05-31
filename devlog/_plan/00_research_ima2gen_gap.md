# 00 — Research: ima2-gen grok commits → progrok gap analysis

## Source
30 grok-related commits in ima2-gen from `9c91f4b` (initial provider) to `4bd0cf4` (video 1.5 T2V workaround).

## Gap Analysis

### Already covered by progrok
- Proxy forwards ALL /v1/* (video, image, voice, etc.)
- OAuth login with --device-code fallback
- capabilities.ts documents full API surface
- search command with --reasoning

### Needs reflecting into progrok

| # | Feature | Source commit(s) | Priority |
|---|---------|-----------------|----------|
| 1 | `progrok video` CLI command (T2V + I2V + polling + progress) | 684d298, 4168f49, a314635 | HIGH |
| 2 | `progrok image` CLI command (generate + edit with refs) | 9c91f4b, 303f74a, e4ccc4c | HIGH |
| 3 | `grok-imagine-video-1.5-preview` model in capabilities + T2V workaround docs | 6d3c760, 86fecea, 50ea2d1, 4bd0cf4 | MEDIUM |
| 4 | Video 1.5 T2V white-canvas workaround in video command | 4bd0cf4 | MEDIUM |
| 5 | capabilities.ts: add `grok-imagine-video-1.5-preview` model entry | 6d3c760 | LOW |
| 6 | Remove dead `ALLOWED_PROXY_PATHS` constant (unused, misleading) | — | LOW |

### NOT needed in progrok (ima2-gen-specific)
- Windows spawn fixes (ima2-gen's launcher code, not progrok itself)
- grokProxyLauncher (ima2-gen manages progrok process lifecycle)
- grokSizeMapper (image size→aspect_ratio mapping, consumer-side)
- grokMultimodeAdapter (multi-image batch, consumer-side)
- Planner/prompt-rewriting (consumer-side AI layer)

## xAI Video API (official docs, May 2026)

### Endpoints
- `POST /v1/videos/generations` — T2V, I2V, R2V
- `GET /v1/videos/{request_id}` — poll status
- `POST /v1/videos/edits` — edit existing video
- `POST /v1/videos/extensions` — extend video

### Models
- `grok-imagine-video` (official, stable)
- `grok-imagine-video-1.5-preview` (undocumented preview, discovered by ima2-gen)

### Video 1.5 quirks (from ima2-gen commits)
- T2V NOT supported natively (returns 400)
- Workaround: inject 1x1 white PNG as source image + append "generate freely" to prompt
- Falls back to v1.0 if workaround also fails
- I2V works normally on 1.5

### Parameters
- duration: 1-15s (T2V/I2V), 1-10s (R2V)
- resolution: 480p (default), 720p
- aspect_ratio: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3
- image: { url: "data:..." } for I2V
- reference_images: [{url}...] for R2V (max 7)

### Image API
- `POST /v1/images/generations` — T2I
- `POST /v1/images/edits` — edit with reference images
- Models: grok-imagine-image, grok-imagine-image-quality
- aspect_ratio: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, 19.5:9, 9:19.5, 20:9, 9:20, auto
- resolution: 1k, 2k
- response_format: b64_json or url
