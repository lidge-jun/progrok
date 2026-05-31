# progrok

[![npm version](https://img.shields.io/npm/v/progrok.svg)](https://www.npmjs.com/package/progrok)
[![license: MIT](https://img.shields.io/badge/license-MIT-16a085.svg)](./LICENSE)
[![docs](https://img.shields.io/badge/docs-GitHub%20Pages-4cc9a6.svg)](https://lidge-jun.github.io/progrok/)
[![node](https://img.shields.io/badge/node-%3E%3D18-2d3748.svg)](./package.json)

Activate your xAI Grok OAuth session as a local API and tool surface.

`progrok` is an OAuth bridge for Grok. It signs in with your xAI account, stores
a refreshable local OAuth session, and activates that session through two
developer-facing surfaces:

1. an OpenAI-compatible localhost proxy that forwards `/v1/*` requests to
   `api.x.ai`, and
2. direct CLI commands for Grok workflows that need source selection, JSON
   output, async polling, local files, or machine-readable metadata.

The point is not only "no API key." The point is that Hermes Agent, OpenClaw,
and Grok Build-style coding workflows all rely on the same xAI OAuth credential
lineage: the xAI account session is the authority, and local tools need a way to
turn that session into a programmable endpoint. progrok is that activation tool.
Point the OpenAI SDK, curl scripts, or agent tools at `127.0.0.1:18645` and let
progrok inject the real xAI bearer token locally.

> Requires an active SuperGrok subscription. progrok does not bypass xAI account
> access, quotas, pricing, or product limits.

## Links

- Live docs: [lidge-jun.github.io/progrok](https://lidge-jun.github.io/progrok/)
- OAuth bridge: [lidge-jun.github.io/progrok/docs/concepts/oauth-bridge](https://lidge-jun.github.io/progrok/docs/concepts/oauth-bridge)
- Quick start: [lidge-jun.github.io/progrok/docs/quickstart](https://lidge-jun.github.io/progrok/docs/quickstart)
- npm: [npmjs.com/package/progrok](https://www.npmjs.com/package/progrok)
- Repository: [github.com/lidge-jun/progrok](https://github.com/lidge-jun/progrok)

## Why OAuth

xAI account access is session-based in the tools that made this workflow
useful. Hermes Agent and OpenClaw document the shared xAI OAuth client
identifier used by progrok, and Grok Build-style coding workflows benefit from
the same model: authenticate once with the xAI account, then expose Grok to
developer tooling through a local API surface.

That changes the shape of the problem:

- the user account and subscription decide what models and tools are available;
- the local machine holds the refreshable credential;
- existing SDKs and agents expect a base URL plus an API key;
- Grok media, search, and model discovery need more workflow glue than a raw
  HTTP proxy provides.

progrok handles that glue. It activates the OAuth credential as a proxy for
OpenAI-compatible clients and as direct commands for search, images, video,
models, and capability discovery.

## What "activation tool" means

After `progrok login`, the stored OAuth session powers every surface below:

| Surface | Command or URL | What gets activated |
| --- | --- | --- |
| OpenAI-compatible API | `http://127.0.0.1:18645/v1/*` | Chat, Responses, reasoning, structured output, server-side tools, files, batches, and other HTTP xAI API paths your account can access. |
| Current search | `progrok search` | Grok Responses with web search, X search, citations, JSON output, and optional reasoning effort. |
| Image workflows | `progrok image` | Imagine generation and editing with local reference files and output handling. |
| Video workflows | `progrok video` | Async video submission, polling, progress display, and download handling. |
| Coding models | `grok-build-0.1` through the proxy | Grok Build-style coding work from clients that can point at a local OpenAI-compatible endpoint. |
| Agent discovery | `progrok capabilities --json` | Machine-readable ports, commands, models, endpoints, and auth requirements. |

The placeholder `OPENAI_API_KEY` or `Authorization` value is only there to
satisfy client libraries. progrok replaces it before forwarding the request.

## Install

```bash
npm install -g progrok
```

## Quick Start

```bash
# 1. Activate your xAI OAuth session.
progrok login

# SSH or remote machine:
progrok login --device-code

# 2. Start the OpenAI-compatible local proxy.
progrok proxy

# 3. Call Grok through localhost.
curl http://127.0.0.1:18645/v1/chat/completions \
  -H "Authorization: Bearer anything" \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-4.3","messages":[{"role":"user","content":"Hello"}]}'
```

The proxy replaces the placeholder `Authorization` value with your stored xAI
OAuth bearer token before forwarding the request. The API key value in your
client can be any non-empty placeholder.

For direct tool activation, the proxy process is optional:

```bash
progrok search --x --json "Grok Build release discussion"
progrok image "a precise product diagram of an OAuth bridge CLI" --output ./out
progrok video "a local proxy turning on Grok tools" --duration 5
progrok models --detail
progrok capabilities --json
```

## OpenAI SDK Example

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:18645/v1",
    api_key="anything",
)

result = client.chat.completions.create(
    model="grok-4.3",
    messages=[{"role": "user", "content": "Explain MCP in 5 bullets"}],
)

print(result.choices[0].message.content)
```

Shell configuration for tools that respect OpenAI-compatible environment
variables:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:18645/v1
export OPENAI_API_KEY=anything
```

## Commands

| Command | Use it for |
| --- | --- |
| `progrok login` | Browser OAuth login with your xAI account. |
| `progrok login --device-code` | OAuth login for SSH, CI shells, or remote machines. |
| `progrok logout` | Remove stored local credentials. |
| `progrok status` | Check whether a local OAuth session exists. |
| `progrok proxy` | Start the local OpenAI-compatible proxy on `127.0.0.1:18645`. |
| `progrok chat` | Open the local browser chat UI on `127.0.0.1:18646`. |
| `progrok models --detail` | List model aliases, pricing, context windows, and media models. |
| `progrok search <query>` | Search web and X sources through Grok Responses tools. |
| `progrok search <query> --web` | Restrict search to web sources. |
| `progrok search <query> --x` | Restrict search to X sources. |
| `progrok search <query> --reasoning high` | Add reasoning effort to a search request. |
| `progrok image <prompt>` | Generate an Imagine image. |
| `progrok image <prompt> --ref ./input.png` | Edit or compose from a reference image. |
| `progrok video <prompt>` | Text-to-video generation. |
| `progrok video <prompt> --image ./input.png` | Image-to-video (animate still image). |
| `progrok video edit <prompt> --video <url>` | Edit existing video with text (real V2V). `grok-imagine-video` only. |
| `progrok video extend <prompt> --video <url>` | Continue video from last frame. `grok-imagine-video` only. |
| `progrok capabilities --json` | Print machine-readable command, model, and endpoint metadata. |
| `progrok skill` | Print an agent-oriented usage guide. |

## Native Search

`progrok search` calls xAI's Responses API directly with `web_search` and
`x_search` tools. It does not require the proxy process to be running because it
loads the same OAuth session directly.

```bash
progrok search "latest Astro release"
progrok search --web "Node.js 22 features"
progrok search --x "grok API launch"
progrok search --json "rust async traits"
progrok search --model grok-4.20-multi-agent-0309 --reasoning xhigh \
  "compare current open-source browser automation tools"
```

Reasoning effort values: `none`, `low`, `medium`, `high`, `xhigh`.

## Image and Video

Image generation:

```bash
progrok image "a crisp terminal UI product shot for a CLI called progrok"
progrok image "make this diagram cleaner" --ref ./diagram.png --output ./out
```

Video generation:

```bash
# Text-to-video
progrok video "a terminal command expanding into a network diagram"

# Image-to-video (animate a still image)
progrok video "turn this interface into a smooth product demo" --image ./screen.png

# Video editing — modify existing video, keep motion (grok-imagine-video only)
progrok video edit "Make the background a sunset sky" --video https://vidgen.x.ai/.../clip.mp4

# Video extension — continue from last frame (grok-imagine-video only)
progrok video extend "Camera slowly pulls back revealing the full scene" \
  --video https://vidgen.x.ai/.../clip.mp4 --duration 5
```

### Model constraints

| Model | T2V | I2V | Ref2V | Edit | Extend |
|-------|:---:|:---:|:-----:|:----:|:------:|
| `grok-imagine-video` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `grok-imagine-video-1.5-preview` | ⚠️¹ | ✅ | ✅ | ❌ | ❌ |

¹ T2V not natively supported; progrok injects a white canvas as workaround.

### Video editing/extension constraints

- **Input**: `.mp4` (H.264/H.265/AV1), max 8.7s (edit) or 2–15s (extend)
- **`--video`**: Must be an HTTPS URL (local file paths not supported yet)
- **Edit output**: Same duration/aspect/resolution as input (max 720p)
- **Extend duration**: 2–10s (default 6s), added to original
- **Model**: `grok-imagine-video` only — 1.5-preview returns "not supported"

Media commands call xAI endpoints directly with your OAuth session and poll async
jobs until completion.

## Proxy Coverage

The proxy forwards every HTTP `/v1/*` path to `api.x.ai`, so it can activate the
xAI API surface available to your account:

- Chat Completions and Responses
- reasoning, citations, structured output, and tool calls
- image generation and editing
- video generation, editing, extension, and polling
- text-to-speech, speech-to-text, and realtime client-secret minting
- files, batches, tokenizer, models, and collection search

WebSocket endpoints are not proxied. For realtime voice streams, mint a client
secret through the HTTP proxy and connect directly to xAI's WebSocket endpoint.

## Models

| Model | Best for | Context | Notes |
| --- | --- | --- | --- |
| `grok-4.3` | Default chat, tools, search, vision | 1M | Also available through common Grok aliases. |
| `grok-build-0.1` | Fast agentic coding | 256K | Good default for Grok Build-style coding tools through the OAuth proxy. |
| `grok-4.20-0309-reasoning` | Deep reasoning | 200K+ | Legacy reasoning model. |
| `grok-4.20-0309-non-reasoning` | Lower-latency text | 200K+ | Legacy non-reasoning model. |
| `grok-4.20-multi-agent-0309` | Deep research | 200K+ | Supports high and xhigh effort. |
| `grok-imagine-image` | Image generation and editing | - | Billed per image. |
| `grok-imagine-image-quality` | Higher-quality image output | - | Billed per image. |
| `grok-imagine-video` | Video: T2V, I2V, Ref2V, Edit, Extend | - | $0.05/sec (480p), $0.07/sec (720p). |
| `grok-imagine-video-1.5-preview` | Video: I2V, Ref2V only (no Edit/Extend) | - | $0.08/sec (480p), $0.14/sec (720p). |

Run the live metadata command before relying on a model in automation:

```bash
progrok models --detail
progrok capabilities --json
```

## How It Works

```text
OpenAI client, coding agent, curl script, or local tool
  -> http://127.0.0.1:18645/v1/*
  -> progrok loads ~/.progrok/auth.json
  -> progrok refreshes the token if needed
  -> progrok injects the xAI OAuth bearer token
  -> https://api.x.ai/v1/*
```

Credentials are stored locally at `~/.progrok/auth.json` and refreshed before
expiry. Treat that file like any other account credential.

The direct command path is similar but skips the proxy server:

```text
progrok search / image / video / models / capabilities
  -> load the same local OAuth session
  -> call the relevant xAI endpoint
  -> add CLI-specific behavior such as polling, files, or JSON output
```

## Relationship to Hermes Agent, OpenClaw, and Grok Build

progrok's OAuth client attribution comes from Hermes Agent and OpenClaw under
their MIT licenses. Those projects demonstrated the important part: Grok can be
made useful to local developer tools through xAI OAuth rather than through a
manually provisioned API key.

progrok takes that pattern and packages it as a focused bridge:

- Hermes Agent and OpenClaw establish the shared OAuth client lineage.
- Grok Build-style workflows need a coding model reachable from agent tools.
- progrok provides the localhost OpenAI-compatible endpoint and direct commands
  that let those tools use the same authenticated account session.

This is why the documentation describes progrok as an activation tool. Login is
the authorization step; the proxy and CLI commands are the activated surfaces.

## Security Notes

- The proxy binds to localhost by default.
- Do not expose the proxy port to a public network without adding your own access
  controls.
- The placeholder API key sent by OpenAI-compatible clients is ignored by the
  proxy and replaced with your xAI OAuth token.
- `progrok logout` removes the local credential file.
- Requests are forwarded to xAI. Sensitive prompt data should be handled under
  the same policy you use for direct xAI API usage.
- The OAuth file enables account-backed access. Do not commit it, sync it to
  untrusted machines, or share it between users.

## Troubleshooting

### `progrok status` says no session

Run `progrok login` again. On remote machines, use `progrok login --device-code`.

### The proxy starts but clients fail

Check that the client points to:

```bash
http://127.0.0.1:18645/v1
```

Also check that the client sends a non-empty API key placeholder.

### Port 18645 is already in use

Stop the existing process or start the proxy on another port if your version
supports a port flag. Then update `OPENAI_BASE_URL` accordingly.

### A model returns 404 or 400

Run:

```bash
progrok models --detail
```

Model aliases and preview names can change. Use the live list before scripting a
long-running workflow.

### Search, image, or video commands fail

These commands call xAI directly with OAuth and may be subject to product access,
rate limits, quota, and account capability. Start with:

```bash
progrok status
progrok capabilities --json
```

## License

MIT. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for OAuth client
attribution.
