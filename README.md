# progrok

Use Grok models for free via OAuth proxy. No API key needed.

## Install

```bash
npm install -g progrok
```

## Quick Start

```bash
# 1. Login with your xAI account (SuperGrok subscription required)
progrok login

# 2. Start the proxy server
progrok proxy

# 3. Use from any OpenAI-compatible client
curl http://127.0.0.1:18645/v1/chat/completions \
  -H "Authorization: Bearer anything" \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-4.3", "messages": [{"role": "user", "content": "Hello"}]}'
```

## Commands

| Command | Description |
|---------|-------------|
| `progrok login` | OAuth login via browser |
| `progrok login --device-code` | Login via device code (SSH/remote) |
| `progrok proxy` | Start OpenAI-compatible proxy on port 18645 |
| `progrok chat` | Open web chat UI in browser |
| `progrok models` | List available Grok models |
| `progrok status` | Show auth status |
| `progrok logout` | Remove stored credentials |

## How It Works

progrok authenticates with xAI via OAuth (the same flow as Grok web app), then runs a local proxy that injects your OAuth token into API requests. Any OpenAI-compatible client can connect to the proxy — no API key purchase required.

## Supported Models

- `grok-4.3` (default) — General-purpose reasoning
- `grok-4.20-beta-latest-reasoning` — Deep reasoning
- `grok-4.20-beta-latest-non-reasoning` — Fast responses
- `grok-build-0.1` — Code-optimized
- And more via `progrok models`

## License

MIT — See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for OAuth client attribution.
