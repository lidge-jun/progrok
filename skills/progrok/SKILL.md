---
name: progrok
description: "Free Grok API via OAuth proxy. Use when you need xAI Grok models (chat, reasoning, search, images, video, voice, RAG) without an API key. Requires a SuperGrok subscription + `progrok login` once."
metadata:
  {
    "triggers": ["grok", "xai", "progrok", "grok-4", "grok-4.3", "x search", "grok search", "grok image", "grok video", "grok tts", "grok stt", "grok voice", "imagine api"],
    "requires": { "bins": ["progrok"] }
  }
---

# progrok — Free Grok API via OAuth Proxy

`progrok` authenticates with xAI via OAuth (the same flow as the Grok web app)
and runs a local proxy that injects your token into requests. Any
OpenAI-compatible client connects to the proxy — no `XAI_API_KEY` needed.

## When to Use

- Call xAI Grok models (chat, reasoning, vision, search, images, video, voice)
- No `XAI_API_KEY` available — use OAuth instead
- Real-time X/web search, image/video generation, TTS/STT, or RAG over your docs

## Prerequisites

```bash
progrok login          # one-time OAuth (browser; or --device-code for SSH)
progrok status         # verify: "Status: Logged in"
progrok proxy          # start the proxy on 127.0.0.1:18645
```

The proxy strips your `Authorization` header and injects the OAuth token, so
clients may send any placeholder bearer value.

## Usage Patterns

### Pattern 1: Direct proxy (recommended for agents)

```bash
curl http://127.0.0.1:18645/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer anything" \
  -d '{"model": "grok-4.3", "messages": [{"role": "user", "content": "Hello"}]}'
```

### Pattern 2: Responses API with tools

```bash
curl http://127.0.0.1:18645/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-4.3",
    "input": [{"role": "user", "content": "What are people saying about Tesla on X?"}],
    "tools": [{"type": "x_search"}, {"type": "web_search"}],
    "stream": true
  }'
```

### Pattern 3: Image generation / editing

```bash
# Generate (resolution 1k|2k, aspect_ratio, n, response_format url|b64_json)
curl http://127.0.0.1:18645/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-imagine-image-quality", "prompt": "A futuristic cityscape", "resolution": "2k"}'

# Edit (single image or multi-reference compose)
curl http://127.0.0.1:18645/v1/images/edits \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-imagine-image-quality", "prompt": "Make it a pencil sketch", "image": {"url": "https://.../photo.png"}}'
```

### Pattern 4: Video generation (async — poll)

```bash
# Start: text-to-video, image-to-video (image), or reference-to-video (reference_images)
curl -s http://127.0.0.1:18645/v1/videos/generations \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-imagine-video", "prompt": "Ocean waves", "duration": 8, "resolution": "720p"}'
# → {"request_id": "abc-123"}

# Poll until done
curl http://127.0.0.1:18645/v1/videos/abc-123
# → {"status": "pending", "progress": 45}
# → {"status": "done", "video": {"url": "https://...", "duration": 8}}
```

Also: `POST /v1/videos/edits` (edit a clip), `POST /v1/videos/extensions` (extend 1-10s).

### Pattern 5: Voice — TTS / STT (HTTP)

```bash
# Text-to-speech (voices: eve, ara, leo, rex, sal). Returns audio bytes.
curl http://127.0.0.1:18645/v1/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello [pause] world", "voice_id": "eve", "language": "en"}' -o out.mp3

# List voices
curl http://127.0.0.1:18645/v1/tts/voices

# Speech-to-text (diarize, multichannel, word timestamps)
curl http://127.0.0.1:18645/v1/stt -F "file=@audio.mp3" -F "language=en" -F "diarize=true"
```

> Realtime Voice Agent + streaming TTS/STT use **WebSocket** endpoints that the
> proxy does **not** forward. Mint a token with `POST /v1/realtime/client_secrets`
> and connect directly to `wss://api.x.ai/v1/realtime`.

### Pattern 6: RAG over your documents

```bash
curl http://127.0.0.1:18645/v1/documents/search \
  -H "Content-Type: application/json" \
  -d '{"query": "Q3 revenue?", "source": {"collection_ids": ["collection_..."]}}'
```

Or enable the `collections_search` tool in `/v1/responses`. (Creating
collections uses the Management API on `management-api.x.ai` — not proxied.)

### Pattern 7: OpenAI SDK / LangChain

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:18645/v1", api_key="anything")
resp = client.chat.completions.create(
    model="grok-4.3",
    messages=[{"role": "user", "content": "Hello"}],
)
```

## API Surface (HTTP — proxied)

| Group | Endpoints |
|-------|-----------|
| Chat | `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/responses/compact`, `GET\|DELETE /v1/responses/{id}`, `GET /v1/chat/deferred-completion/{id}` |
| Images | `POST /v1/images/generations`, `POST /v1/images/edits` |
| Videos | `POST /v1/videos/generations`, `/edits`, `/extensions`, `GET /v1/videos/{id}` |
| Voice | `POST /v1/tts`, `GET /v1/tts/voices[/{id}]`, `POST /v1/stt`, `POST /v1/realtime/client_secrets`, `* /v1/custom-voices[/{id}][/audio]` |
| Models | `GET /v1/models[/{id}]`, `/v1/language-models[/{id}]`, `/v1/image-generation-models`, `/v1/video-generation-models` |
| Batches | `POST /v1/batches`, `GET /v1/batches[/{id}][/requests][/results]`, `POST /v1/batches/{id}:cancel` |
| Files | `POST /v1/files`, `GET /v1/files[/{id}]`, `DELETE /v1/files/{id}` |
| Collections | `POST /v1/documents/search` |
| Other | `GET /v1/api-key`, `POST /v1/tokenize-text`, `POST /v1/embeddings`, any `/v1/*` |

Full request/response contracts: see `docs/api.md`. Live metadata:
`progrok capabilities --json`.

## Models

### Chat / vision (input: text + image)

| Model | Best for | Context | Price (in/out per 1M) |
|-------|----------|---------|-----------------------|
| `grok-4.3` (default) | Chat, agentic tools, search, vision | 1M | $1.25 / $2.50 |
| `grok-build-0.1` | Fast agentic coding | 256K | $1.00 / $2.00 |
| `grok-4.20-0309-reasoning` | Deep reasoning (legacy) | 128K+ | $2.00 / $8.00 |
| `grok-4.20-0309-non-reasoning` | Fast, no thinking (legacy) | 128K+ | — |
| `grok-4.20-multi-agent-0309` | Deep research (4/16 agents, beta) | 128K | — |

Aliases: `grok-4.3` also answers to `latest`, `grok-latest`, `grok-4`,
`grok-4-fast-reasoning`, `grok-3`, `grok-3-mini`, … Use `<model>-latest` to
auto-track the newest version, `<model>-<date>` to pin a release.

### Media & voice

| Model | Type | Price |
|-------|------|-------|
| `grok-imagine-image` / `grok-imagine-image-quality` | Image gen/edit | $0.02 / image (1k/2k) |
| `grok-imagine-video` | Video gen/edit/extend (async) | $0.05 / sec (480p/720p) |
| `grok-voice-latest` / `-fast-1.0` / `-think-fast-1.0` | Voice Agent | $3/hr agent, $15/1M TTS chars |

### Reasoning effort

`grok-4.3` has configurable reasoning incl. a non-reasoning mode. The `4.20`
reasoning line accepts `reasoning.effort` of `low`/`high`. For
`grok-4.20-multi-agent`, `effort` selects agent count: `low`/`medium` → 4
agents, `high`/`xhigh` → 16 agents (Responses API only; no function calling).

## Tools (Responses API)

```json
{"tools": [
  {"type": "web_search", "enable_image_search": true},
  {"type": "x_search"},
  {"type": "code_interpreter"},
  {"type": "collections_search"},
  {"type": "mcp", "server_url": "https://mcp.deepwiki.com/mcp", "server_label": "deepwiki"},
  {"type": "function", "name": "my_func", "parameters": {}}
]}
```

- `web_search` — `allowed_domains`/`excluded_domains` (≤5),
  `enable_image_understanding`, `enable_image_search`.
- `x_search` — X posts/users/threads with citations.
- `code_interpreter` — server-side Python sandbox.
- `collections_search` — RAG over your collections.
- `mcp` — remote MCP server (`server_url`, `server_label`, `allowed_tools`).
- `function` — client-side function calling (≤128).

## Structured Output (JSON Schema)

```bash
curl http://127.0.0.1:18645/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-4.3",
    "input": [{"role": "user", "content": "Latest AI releases"}],
    "tools": [{"type": "web_search"}],
    "text": {"format": {"type": "json_schema", "name": "results",
      "schema": {"type": "object", "properties": {"items": {"type": "array", "items": {"type": "string"}}}, "required": ["items"]},
      "strict": true}}
  }'
```

## Ports & Paths

- Proxy: `127.0.0.1:18645` · Chat UI: `127.0.0.1:18646` · OAuth callback: `127.0.0.1:56121`
- Config: `~/.progrok/auth.json`

## Limitations

- WebSocket endpoints (`wss /v1/realtime`, `/v1/tts`, `/v1/stt`) are not proxied.
- Collection *management* (`management-api.x.ai`) is not proxied; search is.
- `grok-4.20-multi-agent` needs the Responses API (not Chat Completions).

## Dynamic Metadata

```bash
progrok capabilities          # human-readable
progrok capabilities --json   # structured JSON for agents
progrok models --detail       # live pricing + aliases
```

## Install

```bash
npm i -g progrok
```
