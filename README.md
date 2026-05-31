# progrok

Use xAI **Grok** models for free via an OAuth proxy — no API key required.

`progrok` logs in with your xAI account (the same OAuth flow as the Grok web
app) and runs a local, OpenAI-compatible proxy that injects your token into
every request. Point any OpenAI SDK or client at it and call Grok directly.

> Requires an active **SuperGrok** subscription.

## Install

```bash
npm install -g progrok
```

## Quick Start

```bash
# 1. Log in with your xAI account (one time)
progrok login                  # or: progrok login --device-code  (SSH/remote)

# 2. Start the proxy (127.0.0.1:18645)
progrok proxy

# 3. Use from any OpenAI-compatible client
curl http://127.0.0.1:18645/v1/chat/completions \
  -H "Authorization: Bearer anything" \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-4.3", "messages": [{"role": "user", "content": "Hello"}]}'
```

The proxy replaces whatever `Authorization` header you send with your stored
OAuth token, so the bearer value can be any placeholder.

### With the OpenAI SDK

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:18645/v1", api_key="anything")
print(client.chat.completions.create(
    model="grok-4.3",
    messages=[{"role": "user", "content": "Hello"}],
).choices[0].message.content)
```

```bash
export OPENAI_BASE_URL=http://127.0.0.1:18645/v1
export OPENAI_API_KEY=anything
```

## Commands

| Command | Description |
|---------|-------------|
| `progrok login` | OAuth login via browser |
| `progrok login --device-code` | Login via device code (SSH/remote) |
| `progrok search <query> [--web\|--x] [--json]` | Web + X search via Grok — AI summary + citations (no proxy) |
| `progrok search <query> --reasoning <effort>` | Search with reasoning effort (none/low/medium/high/xhigh) |
| `progrok image <prompt> [--ref img] [--json]` | Generate or edit images (no proxy) |
| `progrok video <prompt> [--image src] [--json]` | Generate video — T2V or I2V with polling (no proxy) |
| `progrok proxy` | Start the OpenAI-compatible proxy (port 18645) |
| `progrok chat` | Open the web chat UI (port 18646) |
| `progrok models [--detail]` | List models (`--detail` adds pricing + aliases) |
| `progrok capabilities [--json]` | Print the full capability surface |
| `progrok status` | Show auth status |
| `progrok logout` | Remove stored credentials |

## What You Can Call

The proxy forwards **every** HTTP `/v1/*` path to `api.x.ai`, so the entire xAI
API surface is available:

- **Chat & Responses** — `/v1/chat/completions`, `/v1/responses` (tools,
  reasoning, citations, structured output, stateful conversations), context
  compaction, deferred completions
- **Images (Imagine)** — generation + editing / multi-image compose
- **Videos (Imagine)** — text/image/reference-to-video, edit, extend (async)
- **Voice** — text-to-speech, speech-to-text, custom voice cloning, ephemeral
  Realtime tokens
- **Tools** — `web_search`, `x_search`, `code_interpreter`,
  `collections_search` (RAG), remote `mcp`, custom `function` calling
- **Batches, Files, Collections search, Models, Tokenizer**

See **[docs/api.md](./docs/api.md)** for the full request/response contracts, or
run `progrok capabilities --json` for live metadata.

📖 **Full documentation:** [lidge-jun.github.io/progrok](https://lidge-jun.github.io/progrok/)

## Models

| Model | Best for | Context | Price (in / out per 1M) |
|-------|----------|---------|-------------------------|
| `grok-4.3` *(default)* | Chat, agentic tools, search, vision | 1M | $1.25 / $2.50 |
| `grok-build-0.1` | Fast agentic coding | 256K | $1.00 / $2.00 |
| `grok-4.20-0309-reasoning` | Deep reasoning (legacy) | 200K+ | $1.25 / $2.50 |
| `grok-4.20-0309-non-reasoning` | Fast, no thinking (legacy) | 200K+ | $1.25 / $2.50 |
| `grok-4.20-multi-agent-0309` | Deep research, 4/16 agents (beta) | 200K+ | $1.25 / $2.50 |
| `grok-imagine-image` | Image gen / edit | — | $0.02 / image |
| `grok-imagine-image-quality` | High-quality image gen / edit | — | $0.04 / image |
| `grok-imagine-video` | Video gen / edit / extend | — | $0.05 / sec |
| `grok-imagine-video-1.5-preview` | Video v1.5 (improved I2V, T2V via workaround) | — | $0.05 / sec |

> Cached input is $0.20/1M; above the 200K-token long-context threshold, chat
> rates double. Live search costs $25 / 1K sources.

`grok-4.3` also answers to `grok-latest`, `grok-4`, `grok-3`, and many other
aliases. Use `progrok models --detail` for the live list with pricing.

## How It Works

```
OpenAI client ──HTTP──▶ progrok proxy (127.0.0.1:18645) ──HTTPS+OAuth──▶ api.x.ai
                          └─ injects your refreshed OAuth bearer token
```

Tokens are stored in `~/.progrok/auth.json` and auto-refreshed ~2 minutes before
expiry.

## Limitations

- **WebSocket endpoints are not proxied** — the Realtime Voice Agent and
  streaming TTS/STT (`wss://api.x.ai/v1/...`) need a direct connection. Mint a
  token with `POST /v1/realtime/client_secrets` (proxied) and connect from the
  browser.
- **Collection management** (`management-api.x.ai`) requires a Management API key
  and is not routed through the proxy; collection *search* is.

## License

MIT — see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for OAuth client
attribution.
