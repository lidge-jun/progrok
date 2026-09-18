---
name: progrok
description: "Activate an xAI OAuth session as a local Grok proxy and CLI tool surface. Use when you need Grok models (chat, reasoning, search, images, video, voice, RAG) from OpenAI-compatible clients or agent tools. Requires a SuperGrok subscription + `progrok login` once."
metadata:
  {
    "triggers": ["grok", "xai", "progrok", "grok-4", "grok-4.6", "x search", "grok search", "grok image", "grok video", "grok tts", "grok stt", "grok voice", "imagine api"],
    "requires": { "bins": ["progrok"] }
  }
---

# progrok — OAuth-Activated Grok Proxy and Tool Surface

`progrok` authenticates with xAI via OAuth (the same flow as the Grok web app)
and activates that session as a native HTTP/SSE bridge, typed direct WebSocket
clients, CLI workflows, and a local web app. Any OpenAI-compatible client
connects to the proxy with a placeholder key while progrok injects the real xAI
OAuth bearer token locally.

This is an activation tool, not a bypass. Hermes Agent and OpenClaw document the
same shared xAI OAuth client lineage, and Grok Build-style coding workflows can
use the same account-backed session through progrok's localhost API surface.

## When to Use

- Call xAI Grok models (chat, reasoning, vision, search, images, video, voice)
- No `XAI_API_KEY` available — activate the xAI OAuth session instead
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

### Pattern 0: Native search (no proxy needed)

`progrok search` calls `/v1/responses` with the `web_search`/`x_search`
server-side tools using your OAuth token directly. It is a fast (1–3s) terminal
path for current research, but upstream account access, quota, and billing still
belong to xAI.

```bash
progrok search "latest Node.js LTS version"      # web + X, AI summary + sources
progrok search "Tesla earnings reaction" --web   # web only
progrok search "what's trending in AI" --x        # X (Twitter) only
progrok search "react 19 release notes" --json   # {answer, citations, queries, usage}
progrok search "quantum news" --model grok-4.6    # pick the model
```

Output is an AI summary with inline `[[n]](url)` citations plus a deduplicated
Sources list and a **Markdown links** block (human mode). Agents must use
`--json` and paste `citations[].url` into their reply — paraphrasing `answer`
alone drops links. JSON shape: `{ answer, citations[], queries[], usage }`.

### Pattern 1: Direct proxy (recommended for agents)

```bash
curl http://127.0.0.1:18645/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer anything" \
  -d '{"model": "grok-4.6", "messages": [{"role": "user", "content": "Hello"}]}'
```

### Pattern 2: Responses API with tools

```bash
curl http://127.0.0.1:18645/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-4.6",
    "input": [{"role": "user", "content": "What are people saying about Tesla on X?"}],
    "tools": [{"type": "x_search"}, {"type": "web_search"}],
    "stream": true
  }'
```

### Pattern 2b: Direct Responses WebSocket

The typed client connects to `wss://api.x.ai/v1/responses` with the stored
server-side bearer. Requests are serialized on one connection; `stream` and
`background` are invalid in the WebSocket request object.

```ts
// connectResponsesWebSocket is exported by src/surfaces/index.ts.
const session = await connectResponsesWebSocket();
await session.send({
  type: "response.create",
  model: "grok-4.6",
  input: "Explain this repository",
});
for await (const event of session.events()) {
  if (event.type === "text_delta") process.stdout.write(event.text);
  if (event.type === "done" || event.type === "incomplete") break;
}
await session.close();
```

The connection is direct to xAI, processes one request at a time, and has an
upstream 25-minute maximum lifetime. The first terminal event wins; EOF alone is
not success, and mid-stream failure is never replayed.

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
# Text-to-video
progrok video "Ocean waves crashing on rocks" --duration 8 --resolution 720p

# Image-to-video
progrok video "Animate this scene" --image photo.jpg --duration 10

# Reference-to-video (repeat --ref up to 7 times; max 10s)
progrok video "Use this character and outfit" --ref character.png --ref outfit.png --duration 6

# Video editing (real V2V — modify existing video, keep motion)
progrok video edit "Make the water glow neon blue" --video ./clip.mp4

# Video extension (continue from last frame)
progrok video extend "Camera slowly pulls back" --video file_id:file-abc123 --duration 5
```

**API endpoints** (via proxy at 127.0.0.1:18645):
```bash
# Generate: POST /v1/videos/generations
curl -s http://127.0.0.1:18645/v1/videos/generations \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-imagine-video", "prompt": "Ocean waves", "duration": 8, "resolution": "720p"}'
# → {"request_id": "abc-123"}

# R2V: REST selects mode from reference_images; do not send a mode field
curl -s http://127.0.0.1:18645/v1/videos/generations \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-imagine-video", "prompt": "Runway shot", "reference_images": [{"file_id": "file-abc123"}], "duration": 6}'

# Edit (V2V): POST /v1/videos/edits — grok-imagine-video only
curl -s http://127.0.0.1:18645/v1/videos/edits \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-imagine-video", "prompt": "Add sunset colors", "video": {"url": "https://..."}}'

# Extend: POST /v1/videos/extensions — grok-imagine-video only, 2-10s
curl -s http://127.0.0.1:18645/v1/videos/extensions \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-imagine-video", "prompt": "Continue scene", "duration": 5, "video": {"url": "https://..."}}'

# Poll: GET /v1/videos/{request_id}
curl http://127.0.0.1:18645/v1/videos/abc-123
# → {"status": "done", "video": {"url": "https://...", "duration": 8}}
```

**Model constraints:**
- `grok-imagine-video`: T2V, I2V, Ref2V, Edit, Extend — all modes
- `grok-imagine-video-1.5-preview`: live-smoked I2V only; prompt-only T2V and Ref2V return xAI 400 errors
- Media refs: `url`, `file_id`, data URI, or local file through the CLI
- REST has no `mode` field; SDK mode strings are provider options only
- `image` + `reference_images` is invalid
- Edit/Extend input: mp4, H.264/H.265/AV1, max 8.7s (edit) / 2-15s (extend)
- Edit output inherits input duration/aspect/resolution (max 720p)
- Extend duration: 2-10s added to original

### Pattern 5: Voice — TTS / STT (HTTP)

```bash
# Text-to-speech (voices: eve, ara, leo, rex, sal). Returns audio bytes.
curl http://127.0.0.1:18645/v1/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello [pause] world", "voice_id": "eve", "language": "en", "output_format": {"codec": "mp3"}}' -o out.mp3

# List voices
curl http://127.0.0.1:18645/v1/tts/voices

# Speech-to-text (diarize, multichannel, word timestamps)
curl http://127.0.0.1:18645/v1/stt \
  -F "language=en" -F "diarize=true" -F "file=@audio.mp3"
```

The `file` part must be the last STT multipart field. TTS `output_format` is an
object, never a codec string.

CLI equivalents use the same native clients:

```bash
progrok tts "Hello" --voice eve --language en --format mp3 -o hello.mp3
progrok stt audio.mp3 --language en --diarize --keyterm Grok --json
progrok live --event '{"type":"session.update","session":{"voice":"eve"}}' --once
```

`live` is an NDJSON stdin/stdout bridge and does not capture microphone audio.

progrok's WebSocket clients connect directly to
`wss://api.x.ai/v1/responses`, `wss://api.x.ai/v1/realtime`,
`wss://api.x.ai/v1/stt`, and `wss://api.x.ai/v1/tts`; the localhost HTTP proxy
does not relay WebSocket upgrades. Server-side clients use bearer auth. Browser
realtime and STT clients mint a new one-use secret through same-origin
`POST /v1/realtime/client_secrets` for every connection and reconnect, then use
the `xai-client-secret.<token>` subprotocol once on the direct xAI socket. Do not
cache or reuse it. Browser ephemeral auth for TTS is not verified; use
server-side bearer auth there.

```ts
async function openRealtime() {
  const response = await fetch("/v1/realtime/client_secrets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expires_after: { seconds: 300 } }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`secret mint failed: ${response.status}`);
  const secret = await response.json();
  const ws = new WebSocket(
    "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-2.0",
    [`xai-client-secret.${secret.value}`],
  );
  ws.addEventListener("open", () => ws.send(JSON.stringify({
    type: "session.update",
    session: { voice: "eve", resumption: { enabled: true } },
  })));
  return ws;
}
```

Keep the mint inside the socket creation function. A secret is consumed by one
connection, including failed/reconnected sessions. Never send OAuth, API keys,
or client secrets in a WebSocket query parameter.

### Pattern 5b: Local web app

```bash
progrok chat
# opens http://127.0.0.1:18646
```

The web app serves its HTTP `/v1/*` proxy on the same origin. Text uses
Responses SSE; realtime Voice and streaming STT connect directly to xAI with a
fresh one-use browser secret for each socket. OAuth access and refresh tokens
never enter browser HTML, JavaScript, storage, or logs.

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
    model="grok-4.6",
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

Direct typed WebSocket surface: `wss://api.x.ai/v1/responses`,
`wss://api.x.ai/v1/realtime`, `wss://api.x.ai/v1/stt`, and
`wss://api.x.ai/v1/tts`. The `src/surfaces/index.ts` boundary exports
`BatchesClient`, `CollectionsSearchClient`, `EmbeddingsClient`, `FilesClient`,
`ImagesClient`, `MiscClient`, `ModelsClient`, `SkillsClient`, `VideosClient`,
and `connectResponsesWebSocket`. These are repository source boundaries used by
the CLI and tests; the current npm artifact is a CLI bundle, not a separate SDK
entry point.

## Models

### Chat / vision (input: text + image)

| Model | Best for | Context | Price (in/out per 1M) |
|-------|----------|---------|-----------------------|
| `grok-4.6` (default) | Chat, agentic tools, search, vision | 500K | $2.00 / $6.00 |
| `grok-build-0.1` | Fast agentic coding | 256K | $1.00 / $2.00 |
| `grok-composer-2.5-fast` | Agentic code composition | TBD | Live on chat/completions; supports reasoning_content. May need team access |
| `grok-4.20-0309-reasoning` | Deep reasoning (legacy) | 200K+ | $1.25 / $2.50 |
| `grok-4.20-0309-non-reasoning` | Fast, no thinking (legacy) | 200K+ | $1.25 / $2.50 |
| `grok-4.20-multi-agent-0309` | Deep research (4/16 agents, beta) | 200K+ | $1.25 / $2.50 |

Cached input $0.20/1M. Above the 200K long-context threshold, chat rates double
($2.50 / $5.00 in/out; cached $0.40). Live search $25 / 1K sources.

Do not assume historical aliases. `GET /v1/models` and
`progrok models --detail` are authoritative for the current account. Use a
rolling alias only when automatic movement is acceptable, and a concrete model
identifier when reproducibility matters.

### Media & voice

| Model | Type | Price |
|-------|------|-------|
| `grok-imagine-image` | Image gen/edit | $0.02 / image (1k/2k) |
| `grok-imagine-image-quality` | High-quality image gen/edit | $0.04 / image (1k/2k) |
| `grok-imagine-video` | Video gen/edit/extend (async) | $0.05 / sec (480p/720p) |
| `grok-voice-latest` | Rolling Voice alias | Resolve availability from the runtime catalog. |
| `grok-voice-think-fast-2.0` | Reproducible Voice pin and `progrok live` default | Runtime catalog and xAI account terms are authoritative. |

### Reasoning effort

`grok-4.6` has configurable reasoning incl. a non-reasoning mode. The `4.20`
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
    "model": "grok-4.6",
    "input": [{"role": "user", "content": "Latest AI releases"}],
    "tools": [{"type": "web_search"}],
    "text": {"format": {"type": "json_schema", "name": "results",
      "schema": {"type": "object", "properties": {"items": {"type": "array", "items": {"type": "string"}}}, "required": ["items"]},
      "strict": true}}
  }'
```

## Ports & Paths

- HTTP proxy: `http://127.0.0.1:18645/v1` · Web app and same-origin proxy: `http://127.0.0.1:18646` · OAuth callback: `127.0.0.1:56121`
- Direct WS: `wss://api.x.ai/v1/responses`, `/realtime`, `/stt`, `/tts` (never a localhost WS URL)
- Config: `~/.progrok/auth.json`

## Limitations

- The localhost servers are HTTP-only; typed WebSocket clients connect directly to xAI.
- Browser ephemeral auth is verified for realtime and STT, one secret per connection. TTS browser ephemeral auth is not verified.
- Collection *management* (`management-api.x.ai`) is not proxied; search is.
- `grok-4.20-multi-agent` needs the Responses API (not Chat Completions).

## Dynamic Metadata

```bash
progrok capabilities          # human-readable
progrok capabilities --json   # structured JSON for agents
progrok models --detail       # live pricing + aliases
progrok billing               # plan tier, usage, remaining quota
progrok billing --json        # structured billing data for agents
```

progrok 3.0.0 emits capabilities schema v2. `commands` is an array of
`{ name, summary, mutatesRemote, json }` entries sourced from
`COMMAND_MANIFEST`; endpoint entries come from `SURFACE_REGISTRY`.

```js
const capabilities = JSON.parse(output);
if (capabilities.schemaVersion !== 2) throw new Error("unsupported schema");
const commandNames = capabilities.commands.map((entry) => entry.name);
```

Do not treat `commands` as `string[]`; no legacy string-array shape is promised.

## Install

```bash
npm i -g progrok
```
