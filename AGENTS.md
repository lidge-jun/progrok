# progrok

Standalone CLI tool: SuperGrok OAuth → local proxy → free OpenAI-compatible Grok API.

## For AI Agents

progrok gives you a local OpenAI-compatible endpoint at `http://127.0.0.1:18645/v1` that requires no API key. Any OpenAI SDK, LangChain, LiteLLM, or raw HTTP client works.

### Quick Integration

```bash
# 1. Human runs login once
progrok login

# 2. Start proxy (background or foreground)
progrok proxy &

# 3. Agent uses it like any OpenAI endpoint
export OPENAI_BASE_URL=http://127.0.0.1:18645/v1
export OPENAI_API_KEY=anything  # proxy ignores this, injects OAuth token
```

### Supported xAI API Surface (all verified with OAuth)

| Endpoint | Method | Type | Description |
|----------|--------|------|-------------|
| `/v1/responses` | POST | Streaming | Responses API — tools, reasoning, citations |
| `/v1/chat/completions` | POST | Streaming | OpenAI-compatible chat |
| `/v1/models` | GET | Sync | List models (8 available) |
| `/v1/language-models` | GET | Sync | Detailed models: pricing, aliases, modalities |
| `/v1/images/generations` | POST | Sync | Image generation (returns URL) |
| `/v1/videos/generations` | POST | Async | Video generation (returns `request_id`) |
| `/v1/videos/{id}` | GET | Poll | Video status: `pending` → `done` with URL |
| `/v1/tts` | POST | Binary | Text-to-speech (MP3/WAV/PCM) |
| `/v1/stt` | POST | Sync | Speech-to-text (multipart upload) |
| `/v1/batch/completions` | POST | Async | Batch processing |
| `/v1/embeddings` | POST | Sync | Text embeddings |
| `/v1/completions` | POST | Sync | Legacy text completions |

**No whitelist** — any `/v1/*` path is forwarded to `api.x.ai`.

### Available Models

| Model ID | Type | Context | Use For |
|----------|------|---------|---------|
| `grok-4.3` (default) | Reasoning | 1M | General chat, analysis |
| `grok-4.20-0309-reasoning` | Deep reasoning | 200K+ | Complex coding, planning |
| `grok-4.20-0309-non-reasoning` | Fast | 200K+ | Quick lookups, simple tasks |
| `grok-4.20-multi-agent-0309` | Multi-agent | 200K+ | Agent orchestration |
| `grok-build-0.1` | Code | 256K | Code generation, debugging |
| `grok-imagine-image` | Image gen | - | Fast image generation |
| `grok-imagine-image-quality` | Image gen HQ | - | High-quality images |
| `grok-imagine-video` | Video gen | - | Async video (poll for result) |

### Tools (Responses API)

Pass in `tools` array with `/v1/responses`:

| Tool | Description |
|------|-------------|
| `{"type": "web_search"}` | Web search with citations |
| `{"type": "x_search"}` | X (Twitter) search with citations |
| `{"type": "code_interpreter"}` | Server-side code execution |
| `{"type": "file_search", "vector_store_ids": [...]}` | Vector store search |
| `{"type": "function", "name": "...", "parameters": {...}}` | Custom function calling |

### Streaming Events (Responses API)

When `stream: true`, events arrive in this order:

```
response.created
response.reasoning_summary_text.delta    # thinking process
response.web_search_call.searching       # "searching..." status
response.web_search_call.completed       # search done
response.output_item.done (web_search)   # query + sources URLs
response.output_text.delta               # text tokens
response.output_text.annotation.added    # url_citation inline
response.completed                       # final response object
```

## CLI Commands

```
progrok login [--device-code]    OAuth login (browser or device code)
progrok logout                   Remove stored credentials
progrok proxy [-p PORT]          Start proxy on 127.0.0.1:18645
progrok chat [-p PORT]           Web chat UI on 127.0.0.1:18646
progrok models [--detail]        List models (--detail for pricing)
progrok status                   Show auth status
```

## Stack

- TypeScript (strict) + ESM
- Express (proxy + chat server)
- commander (CLI)
- tsup (build)
- Node.js 18+

## Key Constants

- OAuth Client ID: `b1a00492-073a-47ea-816f-4c329264a828` (xAI shared, MIT)
- Callback: `127.0.0.1:56121/callback`
- Proxy: `127.0.0.1:18645`
- Chat: `127.0.0.1:18646`
- Config: `~/.progrok/auth.json`, `~/.progrok/config.json`

## File Structure

```
src/
├── index.ts              CLI entry (commander)
├── auth/
│   ├── constants.ts      OAuth constants, ports, paths
│   ├── discovery.ts      OIDC .well-known fetch
│   ├── pkce.ts           PKCE browser OAuth flow
│   ├── device-code.ts    Device code flow (SSH/remote)
│   ├── token-store.ts    Save/load/refresh/delete tokens
│   └── callback-server.ts  Loopback HTTP callback
├── proxy/
│   └── server.ts         Express proxy (credential injection, SSE streaming)
├── chat/
│   ├── server.ts         Chat web server (extends proxy)
│   └── public/           Vanilla HTML/CSS/JS chat UI
├── commands/             CLI command handlers
└── utils/                Config, logger, star-prompt, open-url
```
