# progrok API Reference

progrok activates your xAI OAuth session as a local API surface. It runs a
localhost proxy that forwards every **HTTP** `/v1/*` request to
`https://api.x.ai/v1`, injecting your refreshed OAuth token automatically. This
document mirrors the official xAI REST API (<https://docs.x.ai>) for the
endpoints reachable through the proxy.

The design follows the same OAuth credential lineage documented by Hermes Agent
and OpenClaw and is useful for Grok Build-style coding tools: authenticate the
xAI account once, then let OpenAI-compatible clients, coding agents, and scripts
use a stable local endpoint.

**Key behavior:** the proxy strips any `Authorization` header you send and
replaces it with the stored OAuth bearer token. Send any placeholder value —
the proxy handles auth.

**Base URL:** `http://127.0.0.1:18645` (proxy) → `https://api.x.ai` (upstream)

**Activation model:** `progrok login` stores `~/.progrok/auth.json`;
`progrok proxy` turns it into an OpenAI-compatible endpoint; direct commands
such as `progrok search`, `progrok image`, and `progrok video` use the same
credential without requiring the proxy process.

> **Not proxied:** WebSocket endpoints (`wss://api.x.ai/v1/realtime`,
> `/v1/tts`, `/v1/stt`) and Collection *management* (`management-api.x.ai`).
> See [Limitations](#limitations).

---

## Health

### GET /health

```bash
curl http://127.0.0.1:18645/health
# {"status": "ok", "upstream": "xAI Grok", "proxy": "progrok"}
```

---

## Chat & Responses

### POST /v1/chat/completions

OpenAI-compatible chat + image understanding. Supports `stream`, `tools`,
`reasoning_effort`, `response_format`, `search_parameters`, `n`, `temperature`,
`top_p`, `max_completion_tokens`.

```bash
curl http://127.0.0.1:18645/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-4.3", "messages": [{"role": "user", "content": "Hello"}]}'
```

### POST /v1/responses

Stateful Responses API. Supports tools (`web_search`, `x_search`,
`code_interpreter`, `collections_search`, `mcp`, `function`), reasoning,
citations, structured output via `text.format`, and `previous_response_id`
for multi-turn. Responses are stored 30 days (`store: true`).

```bash
curl http://127.0.0.1:18645/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-4.3",
    "input": [{"role": "user", "content": "What is happening on X today?"}],
    "tools": [{"type": "web_search"}, {"type": "x_search"}],
    "stream": true
  }'
```

| Field | Type | Notes |
|-------|------|-------|
| `input` | string \| array | **required** — text or message array |
| `model` | string | model id or alias |
| `tools` | array | max 128 tools |
| `tool_choice` | string \| object | `auto` (default) / `none` / forced |
| `text.format` | object | `{type: "json_schema", schema, strict}` for structured output |
| `reasoning` | object | `{effort: "low"\|"high"}` (configurable models) |
| `previous_response_id` | string | continue a stored conversation |
| `store` | boolean | default `true` |

### POST /v1/responses/compact

Context compaction — shrink a full message history into a compacted window that
can be reused in later `/v1/responses` calls. Same request shape as
`/v1/responses`.

### GET /v1/responses/{response_id}

Retrieve a stored response.

### DELETE /v1/responses/{response_id}

Delete a stored response → `{"id": "...", "object": "response", "deleted": true}`.

### GET /v1/chat/deferred-completion/{request_id}

Fetch a deferred completion. Returns `200` with the body when ready, `202`
while still pending. Start a deferred request by setting `"deferred": true` on a
chat request.

---

## Images (Imagine API)

### POST /v1/images/generations

```bash
curl http://127.0.0.1:18645/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-imagine-image-quality", "prompt": "A serene Japanese garden"}'
```

| Field | Type | Notes |
|-------|------|-------|
| `prompt` | string | **required** |
| `model` | string | `grok-imagine-image` (fast) / `grok-imagine-image-quality` (HQ) |
| `n` | integer | number of images |
| `aspect_ratio` | enum | `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `2:3`, `3:2`, `2:1`, `1:2`, `auto`, … |
| `resolution` | enum | `1k` \| `2k` |
| `response_format` | string | `url` (default) \| `b64_json` |

Response: `{ "data": [{ "url": "..." }], "usage": { "cost_in_usd_ticks": N } }`.

### POST /v1/images/edits

Edit a single image or compose multiple reference images.

```bash
curl http://127.0.0.1:18645/v1/images/edits \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-imagine-image-quality",
    "prompt": "Render this as a pencil sketch",
    "image": {"url": "https://example.com/photo.png"}
  }'
```

- `image` — single input `{file_id | url}`.
- `images[]` — multiple inputs for multi-reference editing (mutually exclusive
  with `image`); reference them as `<image_1>`, `<image_2>`, … in the prompt.
- Also supports `aspect_ratio`, `resolution`, `n`, `response_format`.

---

## Videos (Imagine API — async)

All video generation is asynchronous: POST returns a `request_id`, then poll
`GET /v1/videos/{request_id}` until `status: "done"`.

### POST /v1/videos/generations

Text-to-video (T2V), image-to-video (I2V, via `image`), and
reference-to-video (R2V, via `reference_images[]`).

```bash
curl http://127.0.0.1:18645/v1/videos/generations \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-imagine-video", "prompt": "A serene lake at sunrise"}'
# {"request_id": "a3d1008e-..."}
```

| Field | Type | Notes |
|-------|------|-------|
| `prompt` | string | required for T2V/R2V; optional for I2V |
| `model` | string | `grok-imagine-video` |
| `duration` | integer | seconds, range `[1, 15]`, default `8` |
| `seconds` | integer | OpenAI-compatible alias for `duration` |
| `aspect_ratio` | enum | `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `3:2`, `2:3` |
| `resolution` | enum | `480p` \| `720p`; `1080p` appears in one schema but is not model-page confirmed |
| `image` | object | `{file_id \| url}` for image-to-video |
| `reference_images[]` | array | `{file_id \| url}` references for R2V; max 7 refs, max 10s |
| `output.upload_url` | string | Optional signed PUT destination for the result |

`image` and `reference_images` are mutually exclusive. SDK `mode` values such
as `reference-to-video` are provider options, not REST body fields.

### POST /v1/videos/edits

Edit a source video by prompt. Requires `video: {file_id | url}` (`.mp4`,
H.264/H.265/AV1) and `prompt`.

### POST /v1/videos/extensions

Generate a continuation. `video`, `prompt`, optional `duration` (2-10s,
default 6).

### GET /v1/videos/{request_id}

```bash
curl http://127.0.0.1:18645/v1/videos/$REQUEST_ID
# pending: {"status": "pending", "progress": 45, "model": "grok-imagine-video"}
# done:    {"status": "done", "video": {"url": "...", "duration": 6, "respect_moderation": true}}
```

Error codes (in `error.code`): `invalid_argument`, `permission_denied`,
`failed_precondition`, `service_unavailable`, `internal_error`.

---

## Voice (HTTP)

> Realtime conversations and incremental streaming use **WebSocket** endpoints
> that are **not** proxied — see [Limitations](#limitations).

### POST /v1/tts

Text-to-speech. Returns raw audio bytes.

```bash
curl http://127.0.0.1:18645/v1/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "voice_id": "eve", "language": "en"}' -o out.mp3
```

| Field | Type | Notes |
|-------|------|-------|
| `text` | string | **required**, ≤15,000 chars. Supports speech tags (`[pause]`, `[laugh]`, …) and wrapping style tags |
| `language` | string | **required** — BCP-47 (`en`, `zh`, `pt-BR`) or `auto` |
| `voice_id` | string | built-in (`eve` default, `ara`, `leo`, `rex`, `sal`) or custom id |
| `output_format` | object | `{codec: mp3\|wav\|pcm\|mulaw\|alaw, sample_rate, bit_rate}` |
| `speed` | number | speed multiplier, default `1.0` |
| `text_normalization` | boolean | normalize numbers/abbreviations |
| `optimize_streaming_latency` | `0`\|`1` | latency vs quality |

### GET /v1/tts/voices · GET /v1/tts/voices/{voice_id}

List built-in voices / get one. Built-ins: `ara`, `eve`, `leo`, `rex`, `sal`.

### POST /v1/stt

Speech-to-text. `multipart/form-data` with `file` (≤500 MB) **or** `url`.

```bash
curl http://127.0.0.1:18645/v1/stt -F "file=@recording.mp3" -F "language=en"
```

| Field | Notes |
|-------|-------|
| `file` / `url` | audio source (one required); `file` must be the last form field |
| `audio_format` | only for raw formats (`pcm`, `mulaw`, `alaw`) |
| `sample_rate` | required for raw formats |
| `language` | enables Inverse Text Normalization with `format=true` |
| `diarize` | `true` → per-word `speaker` index |
| `multichannel` + `channels` | per-channel transcription |
| `keyterm` | bias terms (≤100, ≤50 chars each) |
| `filler_words` | include "uh"/"um" when `true` |

Response: `{ text, language, duration, words: [{text, start, end, confidence}] }`.

### POST /v1/realtime/client_secrets

Mint an ephemeral token for a browser-side Voice Agent / Realtime WebSocket
connection. `{expires_after: {seconds}}` (≤3600, default 600). Optional
`session.model`: `grok-voice-latest` / `grok-voice-think-fast-1.0` /
`grok-voice-fast-1.0`.

### Custom Voices

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/custom-voices` | Clone from reference audio (≤120s); metadata: name, gender, accent, age, language, use_case, tone |
| GET | `/v1/custom-voices` | List (paginated via `pagination_token`) |
| GET | `/v1/custom-voices/{voice_id}` | Get one |
| PATCH | `/v1/custom-voices/{voice_id}` | Update metadata |
| DELETE | `/v1/custom-voices/{voice_id}` | Delete |
| GET | `/v1/custom-voices/{voice_id}/audio` | Download reference audio |

Returns an 8-char lowercase `voice_id` usable anywhere a `voice_id` is accepted.

---

## Models

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/models` | List models (id + token/image pricing) |
| GET | `/v1/models/{model_id}` | One model |
| GET | `/v1/language-models` | Chat models: modalities, aliases, fingerprint, pricing |
| GET | `/v1/language-models/{model_id}` | One language model |
| GET | `/v1/image-generation-models[/{id}]` | Image models + per-image price |
| GET | `/v1/video-generation-models[/{id}]` | Video models + modalities |

Token prices are in **USD cents per 100M tokens** (divide by 10,000 for
USD-per-1M-tokens). Use `progrok models --detail` for a formatted view.

---

## Batches

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/batches` | Create a batch (`{name}`) |
| GET | `/v1/batches` | List batches |
| GET | `/v1/batches/{id}` | Batch state (`num_pending`, `num_success`, …) |
| GET | `/v1/batches/{id}/requests` | List request metadata |
| POST | `/v1/batches/{id}/requests` | Add `batch_requests[]` (chat completions) |
| GET | `/v1/batches/{id}/results` | List processed results |
| POST | `/v1/batches/{id}:cancel` | Cancel all requests |

---

## Files

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/files` | Upload (`multipart`, ≤50 MB). Optional `expires_after` (1h–30d), `purpose` |
| GET | `/v1/files` | List (AIP-160 `filter`, `sort_by`, `order`, `pagination_token`) |
| GET | `/v1/files/{file_id}` | Metadata |
| DELETE | `/v1/files/{file_id}` | Delete |

Uploaded files are referenced by `id` (`file_id`) in chat attachments, image /
video inputs, and collections. Chunked upload: `POST /v1/files:initialize` then
`POST /v1/files:uploadChunks`.

---

## Collections (search)

### POST /v1/documents/search

Semantic / RAG search across collections (the `collections_search` tool calls
this server-side).

```bash
curl http://127.0.0.1:18645/v1/documents/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is the revenue last quarter?",
    "source": {"collection_ids": ["collection_..."]},
    "filter": "year > 2020"
  }'
```

`query` (required), `source.collection_ids` (required), `limit` (default 10),
`filter` (AIP-160), `ranking_metric`, `group_by`. Returns `matches[]` with
`chunk_content`, `score`, `file_id`.

> Creating / populating collections uses the **Management API**
> (`management-api.x.ai`) and is **not** routed through this proxy.

---

## Other

### GET /v1/api-key

Inspect the active key: name, status, ACLs, team/user ids.

### POST /v1/tokenize-text

`{text, model}` → `{token_ids: [{token_id, string_token, token_bytes}]}`.

### POST /v1/embeddings

Text embeddings (OpenAI-compatible).

### All other /v1/* paths

Forwarded to xAI without filtering — any new HTTP endpoint works automatically.

---

## Tools (Responses API)

```json
{"tools": [
  {"type": "web_search", "filters": {"allowed_domains": ["x.ai"]}, "enable_image_search": true},
  {"type": "x_search"},
  {"type": "code_interpreter"},
  {"type": "collections_search"},
  {"type": "mcp", "server_url": "https://mcp.deepwiki.com/mcp", "server_label": "deepwiki"},
  {"type": "function", "name": "my_func", "parameters": {}}
]}
```

| Tool | Notes |
|------|-------|
| `web_search` | `allowed_domains`/`excluded_domains` (≤5), `enable_image_understanding`, `enable_image_search` |
| `x_search` | X posts/users/threads with citations |
| `code_interpreter` | server-side Python sandbox (a.k.a. Code Execution) |
| `collections_search` | RAG over your collections |
| `mcp` | remote MCP: `server_url`, `server_label`, `allowed_tools`, `authorization`, `headers` |
| `function` | client-side function calling (≤128) |

### Search parameters (chat/responses)

`search_parameters: { mode: "off"|"on"|"auto", sources: ["web","x","news","rss"],
from_date, to_date, max_search_results, return_citations }`.

---

## Authentication

### PKCE flow (browser) — `progrok login`

1. Opens `https://auth.x.ai/...` with a PKCE challenge.
2. Log in with your xAI account (SuperGrok subscription required).
3. Callback on `127.0.0.1:56121/callback`.
4. Token exchanged and saved to `~/.progrok/auth.json`.

### Device-code flow (SSH/remote) — `progrok login --device-code`

Displays a URL + code; open it in any browser and enter the code. The CLI polls
until authorized.

### Token storage — `~/.progrok/auth.json`

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "...",
  "expiresAt": 1780152218787,
  "tokenEndpoint": "https://auth.x.ai/oauth2/token",
  "email": "user@example.com"
}
```

The token is auto-refreshed ~2 minutes before expiry.

---

## Limitations

- **WebSocket endpoints are not proxied.** `wss://api.x.ai/v1/realtime` (Voice
  Agent), `wss://api.x.ai/v1/tts` (streaming TTS), and `wss://api.x.ai/v1/stt`
  (streaming STT) require a direct connection. For the Voice Agent, mint an
  ephemeral token with `POST /v1/realtime/client_secrets` (which *is* proxied)
  and connect from the browser.
- **Collection management** (`management-api.x.ai`) uses a Management API key and
  is not reachable through this proxy. Only `POST /v1/documents/search` is.
- **Multi-agent** (`grok-4.20-multi-agent`) requires the Responses API, not Chat
  Completions, and does not support client-side function calling or `max_tokens`.

---

## CLI Commands — Direct Generation

### progrok video

Generate video directly (no proxy needed — uses OAuth token directly).

```bash
# Text-to-video
progrok video "A cat playing piano" --duration 10 --resolution 720p

# Image-to-video
progrok video "Animate this photo" --image photo.jpg

# Reference-to-video (repeat --ref up to 7 times)
progrok video "Put this character in a quiet terminal workspace" \
  --ref character.png --ref workspace.png --duration 6

# Video 1.5 (preview, official text/image input)
progrok video "Epic scene" --model grok-imagine-video-1.5-preview

# Save to specific path
progrok video "prompt" --output my-video.mp4

# JSON output
progrok video "prompt" --json
```

Options:
- `--model <id>` — `grok-imagine-video` (default) or `grok-imagine-video-1.5-preview`
- `--duration <s>` — 1-15 seconds (default: 5)
- `--aspect <ratio>` — 16:9 (default), 9:16, 1:1, 4:3, 3:4, 3:2, 2:3
- `--resolution <r>` — 480p (default) or 720p
- `--image <input>` — source image for image-to-video; file, URL, data URI, or `file_id:<id>`
- `--ref <input>` — reference image for R2V; repeatable, max 7, mutually exclusive with `--image`
- `--seconds <s>` — send OpenAI-compatible `seconds` instead of `duration`
- `--upload-url <url>` — send `output.upload_url`
- `--output <path>` — output file path
- `--timeout <s>` — polling timeout (default: 600)
- `--json` — structured JSON output

Video edit/extend subcommands accept `--video <file|url|data|file_id:id>`.
They intentionally block `grok-imagine-video-1.5-preview` until live API smoke
confirms that preview model accepts video input.

### progrok image

```bash
# Text-to-image
progrok image "A sunset over mountains"

# Edit with reference image
progrok image "Make it winter" --ref photo.jpg
```

Options:
- `--model <id>` — `grok-imagine-image` (default) or `grok-imagine-image-quality`
- `--aspect <ratio>` — 1:1 (default), 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto
- `--resolution <r>` — 1k (default) or 2k
- `--ref <path>` — reference image for editing (repeatable, max 3)
- `--output <path>` — output file path
- `--json` — structured JSON output
