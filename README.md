# progrok

[![npm version](https://img.shields.io/npm/v/progrok.svg)](https://www.npmjs.com/package/progrok)
[![license: MIT](https://img.shields.io/badge/license-MIT-16a085.svg)](./LICENSE)
[![docs](https://img.shields.io/badge/docs-GitHub%20Pages-4cc9a6.svg)](https://lidge-jun.github.io/progrok/)
[![node](https://img.shields.io/badge/node-%3E%3D22-2d3748.svg)](./package.json)

Activate your xAI Grok OAuth session as a local API and tool surface.

`progrok` is an OAuth bridge for Grok. It signs in with your xAI account, stores
a refreshable local OAuth session, and activates that session through four
developer-facing surfaces:

1. a native localhost xAI bridge that parses and renders HTTP/SSE contracts for
   `/v1/*`, provides typed clients for direct xAI WebSockets, and retains
   verified binary/multipart passthroughs;
2. direct CLI commands for Grok workflows that need source selection, JSON
   output, async polling, local files, voice, or machine-readable metadata;
3. typed clients for the REST surface and direct Responses/Voice WebSockets;
4. a local web app that combines same-origin HTTP with browser-direct Voice
   connections without exposing the OAuth token to browser code.

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
| Coding models | `grok-build-0.1`, `grok-composer-2.5-fast` through the proxy | Grok Build and Composer coding work from clients that can point at a local OpenAI-compatible endpoint. |
| Agent discovery | `progrok capabilities --json` | Machine-readable ports, commands, models, endpoints, and auth requirements. |
| Voice CLI | `progrok tts`, `progrok stt`, `progrok live` | REST synthesis/transcription and a direct Realtime NDJSON bridge using the same OAuth session. |
| Responses WebSocket | `wss://api.x.ai/v1/responses` | Direct typed Responses session with server-side bearer auth. |
| Voice WebSockets | `wss://api.x.ai/v1/realtime`, `wss://api.x.ai/v1/stt`, `wss://api.x.ai/v1/tts` | Direct realtime speech, streaming transcription, and streaming synthesis with server-side bearer auth. Browser ephemeral auth is verified for realtime and STT only; mint a new one-use secret for every connection and reconnect. |
| Local web app | `http://127.0.0.1:18646` | Same-origin HTTP plus direct xAI Voice WebSockets without exposing OAuth tokens to browser code. |

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

# `login` shows a URL and a code by default, which also works over SSH.
# On a desktop you can let it open the browser instead:
progrok login --browser

# 2. Start the OpenAI-compatible local proxy.
progrok proxy

# 3. Call Grok through localhost.
curl http://127.0.0.1:18645/v1/chat/completions \
  -H "Authorization: Bearer anything" \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-4.6","messages":[{"role":"user","content":"Hello"}]}'
```

The proxy replaces the placeholder `Authorization` value with your stored xAI
OAuth bearer token before forwarding the request. The API key value in your
client can be any non-empty placeholder.

For direct tool activation, the proxy process is optional:

```bash
progrok search --x --json "Grok Build release discussion"
progrok image "a precise product diagram of an OAuth bridge CLI" --output ./out
progrok video "a local proxy turning on Grok tools" --duration 5
progrok tts "Hello from Grok" --output hello.mp3
progrok stt meeting.wav --json
progrok live --event '{"type":"session.update","session":{"voice":"eve"}}' --once
progrok chat
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
    model="grok-4.6",
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
| `progrok login` | Device-code OAuth login: prints a URL and a code. Works over SSH. |
| `progrok login --browser` | PKCE login that opens a browser and waits on `127.0.0.1:56121`. |
| `progrok login --manual-paste` | PKCE login where you paste the callback code by hand. |
| `progrok logout` | Remove stored local credentials. |
| `progrok status` | Check whether a local OAuth session exists. |
| `progrok proxy` | Start the local OpenAI-compatible proxy on `127.0.0.1:18645`. |
| `progrok chat` | Open the local workspace on `127.0.0.1:18646`: chat, live voice, and media. |
| `progrok models --detail` | List model aliases, pricing, context windows, and media models. |
| `progrok search <query>` | Search web and X sources through Grok Responses tools. |
| `progrok search <query> --web` | Restrict search to web sources. |
| `progrok search <query> --x` | Restrict search to X sources. |
| `progrok search <query> --reasoning high` | Add reasoning effort to a search request. |
| `progrok image <prompt>` | Generate an Imagine image (`grok-imagine-image-2.0`; `--quality low\|medium\|auto`). |
| `progrok image <prompt> --ref ./input.png` | Edit or compose from a reference image. |
| `progrok video <prompt>` | Text-to-video generation. |
| `progrok video <prompt> --image ./input.png` | Image-to-video (animate still image). |
| `progrok video <prompt> --ref ./a.png --voice eve` | Reference-to-video with preset voices; `--last-frame` and `--keyframe` pin frames (1.5 only). |
| `progrok video edit <prompt> --video <url>` | Edit existing video with text (real V2V). `grok-imagine-video` only. |
| `progrok video extend <prompt> --video <url>` | Continue video from last frame. `grok-imagine-video` only. |
| `progrok billing` | Show the weekly usage pool, plan, balances and reset coupons (read-only; never redeems). |
| `progrok billing --json` | The 3.0.0 billing JSON plus `plan`, `weekly` and `resetCoupons`. |
| `progrok tts <text>` | Synthesize speech to a file or raw stdout; `--speed`, `--sample-rate`, `--bit-rate`, `--latency 0\|1\|2`, `--text-normalization`. |
| `progrok tts --list-voices` | List the voices GET /v1/tts/voices returns for your session (28 built-in today). |
| `progrok stt <file>` | Transcribe a local audio file; supports language hints, diarization, multichannel audio, repeatable key terms, `--filler-words`, `--vad-threshold`, `--format` and `--model`. |
| `progrok live` | Bridge direct Realtime events over NDJSON stdin/stdout; it does not capture the microphone. `--reasoning high\|none`. |
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

Media commands call xAI directly with your OAuth session. Video jobs are polled
until they finish; progress is reported as a percent.

Images use `grok-imagine-image-2.0` by default. `--quality low|medium|auto`
picks the quality you pay for (omit it and xAI chooses: low for generation,
medium for edits); `high` does not exist and is rejected. Resolutions are `1k`,
`1.5k` and `2k`; aspect ratios include `21:9` and `5:2`. An edit takes up to
five `--ref` images. Files are saved with the extension of what xAI returns,
which today is JPEG (`progrok-image.jpg`); with `--n 2` or more and `--output`,
each image gets a numbered name (`out-1.jpg`, `out-2.jpg`).

```bash
progrok image "a crisp terminal UI product shot for a CLI called progrok"
progrok image "a wide banner of the CLI" --quality medium --resolution 2k --aspect 5:2
progrok image "make this diagram cleaner" --ref ./diagram.png --output ./out.jpg
```

Videos use `grok-imagine-video-1.5` by default:

```bash
# Text-to-video
progrok video "a terminal command expanding into a network diagram"

# Cheapest per second: 1.5-lite (no references or frame pins)
progrok video "a calm product shot" --model grok-imagine-video-1.5-lite --resolution 1080p

# Image-to-video (animate a still image; prompt optional)
progrok video "turn this interface into a smooth product demo" --image ./screen.png

# Reference-to-video: up to 14 images and 3 preset voices on 1.5
progrok video "the person from <IMAGE_0> presents the product from <IMAGE_1>, speaking with the voice from <AUDIO_0>" \
  --ref ./person.png --ref ./product.png --voice eve --duration 8

# Pin the first, last and middle frames (1.5 only)
progrok video "the camera glides between the two shots" \
  --image ./first.png --last-frame ./last.png --keyframe ./middle.png@4 --duration 8

# Video editing — modify an existing clip, keep the motion (grok-imagine-video only)
progrok video edit "Make the background a sunset sky" --video ./clip.mp4

# Video extension — continue from the last frame (grok-imagine-video only)
progrok video extend "Camera slowly pulls back revealing the full scene" \
  --video file_id:file-abc123 --duration 5
```

### Model constraints

| Model | T2V | I2V | Ref2V | Frame pins | Voices | Edit | Extend | Max resolution |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | --- |
| `grok-imagine-video-1.5` | ✅ | ✅ | ✅ 14 refs, 15 s | ✅ | ✅ 3 | ❌ | ❌ | 1080p (T2V/I2V), 720p (Ref2V) |
| `grok-imagine-video-1.5-lite` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | 1080p, upscaled from 720p |
| `grok-imagine-video` | ✅ | ✅ | ✅ 7 refs, 10 s | ❌ | ❌ | ✅ | ✅ | 720p |

- A reference image, a voice, `--last-frame` or a `--keyframe` makes the request
  reference-to-video, so the 720p cap applies to all of them.
- On 1.5, `--image` together with `--ref`, `--voice` or a pinned frame is the
  first frame of that request. On `grok-imagine-video`, `--image` and `--ref`
  cannot be combined (xAI returns 400).
- `--keyframe <input@seconds>` takes up to four anchors strictly inside the clip.
  xAI snaps them to a 1/3-second grid, so two that round to the same slot are
  rejected.
- progrok checks these rules before sending. A model it has no rules for is
  passed through and left to xAI.

### Video API surface map

| Surface | CLI | REST shape | Notes |
| --- | --- | --- | --- |
| Text-to-video | `progrok video "<prompt>"` | `prompt` on `/v1/videos/generations` | All three models |
| Image-to-video | `--image <file\|url\|data\|file_id:id>` | `image: {url \| file_id}` | Prompt optional |
| Reference-to-video | `--ref <input>` repeatable | `reference_images: [{url \| file_id}]` | 14 on 1.5, 7 on base |
| Preset voices | `--voice <voice_id>` repeatable | `reference_audios: [{voice_id}]` | 1.5 only, max 3 |
| Last frame | `--last-frame <input>` | `last_frame: {url \| file_id}` | 1.5 only |
| Keyframes | `--keyframe <input@seconds>` | `keyframes: [{image, timestamp_s}]` | 1.5 only, max 4 |
| Edit video | `progrok video edit ... --video <input>` | `video: {url \| file_id}` on `/v1/videos/edits` | Base model; source up to 8.7 s, output keeps its duration and aspect, max 720p |
| Extend video | `progrok video extend ... --video <input>` | `video: {url \| file_id}` on `/v1/videos/extensions` | Base model; adds 2–10 s (default 6) |
| Duration alias | `--seconds <s>` | `seconds` instead of `duration` | OpenAI-compatible alias |
| Signed output target | `--upload-url <url>` | `output: {upload_url}` | xAI PUTs the result there |

Every `--image`, `--ref`, `--last-frame`, `--keyframe` and `--video` input can be
a local file, an HTTPS URL, a data URI or `file_id:<id>`. Use `video: {url}` for
REST calls; the `video_url` alias fails with `422 missing field video`.

### Live smoke (2026-11-21)

| Probe | Result |
| --- | --- |
| `grok-imagine-video-1.5` text-to-video, no image | Done |
| 1.5 with first frame, a reference image, voice `eve`, `last_frame` and a keyframe | Done |
| `grok-imagine-video-1.5-lite` text-to-video at 480p and at 1080p | Done |
| 1.5 reference-to-video at 1080p, or `last_frame` alone at 1080p | Rejected: 720p cap for reference-to-video |
| lite with `reference_images` or `last_frame` | Rejected: not supported for this model |
| 1.5 with 15 reference images | Rejected: maximum 14 |
| Job progress | Integer percent, 1 → 10 → 50 → 100 |

### Historical smoke (2026-06)

These results came from an earlier API and are kept as a record. The two marked
rows no longer hold.

| Probe | Result then |
| --- | --- |
| T2V, I2V, R2V on `grok-imagine-video` | Passed |
| Edit/extend by source URL | Passed |
| `file_id` image/video input | Passed for I2V, R2V, edit and extend |
| `seconds` alias, `image_url` REST alias | Passed |
| `output.upload_url` | Passed; result `video.url` equals the upload URL |
| `video_url` REST alias | Failed with `422 missing field video` |
| `1080p` | Failed for this team (**no longer holds**: 1080p works on 1.5 and lite) |
| `grok-imagine-video-1.5` | Only I2V passed (**no longer holds**: T2V and R2V work) |

The web Media tab offers 1080p when the selected model allows it, and for a model
this build has no rules for.

## Proxy Coverage

The proxy forwards every HTTP `/v1/*` path to `api.x.ai`, so it can activate the
xAI API surface available to your account:

- Chat Completions and Responses
- reasoning, citations, structured output, and tool calls
- image generation and editing
- video generation, editing, extension, and polling
- text-to-speech, speech-to-text, and realtime client-secret minting
- files, batches, tokenizer, models, and collection search

The localhost server handles HTTP only and does not accept WebSocket upgrades.
Node and browser clients connect directly to these xAI endpoints:

- `wss://api.x.ai/v1/responses` for serial Responses requests on one connection;
- `wss://api.x.ai/v1/realtime` for native speech-to-speech;
- `wss://api.x.ai/v1/stt` for streaming transcription;
- `wss://api.x.ai/v1/tts` for streaming synthesis.

Server-side clients authenticate those sockets with the stored bearer. A browser
must use the same-origin flow for realtime or STT: call
`POST /v1/realtime/client_secrets`, create one socket with the returned secret
as the single `xai-client-secret.<token>` WebSocket subprotocol, then discard the
secret. A secret is consumed by one connection, so every reconnect must mint a
new one; never cache or reuse it. Browser ephemeral auth has not been verified
for `/v1/tts`, so TTS WebSocket documentation guarantees server-side bearer auth
only.

## Models

Your account decides what `/v1/models` returns. The table below is what a
SuperGrok session returned on 2026-09-19; treat `progrok models --json` as the
source of truth, not this page.

| Model | Best for | Context | Notes |
| --- | --- | --- | --- |
| `grok-4.6` | Default chat, tools, search, vision | 500K | `DEFAULT_MODEL`. Pricing below. |
| `grok-4.5` | Previous frontier text model | 500K | Still served. |
| `grok-4.3` | Older text model | 200K+ | Cheaper tier. |
| `grok-build-0.1` | Fast agentic coding | 256K | Good default for Grok Build-style coding tools through the OAuth proxy. |
| `grok-4.20-0309-reasoning` | Deep reasoning | 200K+ | Legacy reasoning model. |
| `grok-4.20-0309-non-reasoning` | Lower-latency text | 200K+ | Legacy non-reasoning model. |
| `grok-4.20-multi-agent-0309` | Deep research | 200K+ | Supports high and xhigh effort. |
| `grok-imagine-image` | Image generation and editing | - | $0.002/input image; $0.02/output image. |
| `grok-imagine-image-2.0` | Current Imagine image model | - | Default; quality low, medium, or auto. |
| `grok-imagine-video` | Video: T2V, I2V, Ref2V, Edit, Extend | - | $0.002/input image, $0.01/input video sec; $0.05/sec (480p), $0.07/sec (720p). |
| `grok-imagine-video-1.5` | T2V, I2V, Ref2V | - | Default video model. |
| `grok-imagine-video-1.5-lite` | T2V, I2V | - | 1080p upscaled. |

### Media pricing

| Model | 480p | 720p | 1080p | Inputs |
| --- | --- | --- | --- | --- |
| grok-imagine-video | $0.05/s | $0.07/s | — | image $0.002, input video $0.01/s |
| grok-imagine-video-1.5 | $0.08/s | $0.14/s | $0.25/s (T2V/I2V only) | image $0.01; preset voices free |
| grok-imagine-video-1.5-lite | $0.02/s | $0.03/s | $0.14/s (upscaled) | image $0.01 |

| Model | 1K | 1.5K | 2K | Inputs |
| --- | --- | --- | --- | --- |
| grok-imagine-image-2.0 low | $0.04 | $0.05 | $0.06 | edit input $0.01/image |
| grok-imagine-image-2.0 medium | $0.06 | $0.07 | $0.08 | edit input $0.01/image |
| grok-imagine-image (1.0) | $0.02 | — | $0.02 | $0.002/image |

xAI model catalog and docs.x.ai pricing, read 2026-11-21; live cost_in_usd_ticks matched 1.5 480p $0.08/s, lite 480p $0.02/s, lite 1080p $0.14/s and image 2.0 1K medium $0.06. Prices change; xAI's pricing page is authoritative. `auto` is billed at the quality actually served.

### Billing

`progrok billing` shows weekly usage, plan, balances and reset coupons read-only. Missing amounts and failed weekly reads are shown as unavailable; reset times are UTC. `progrok billing --json` preserves legacy fields and adds `plan`, `weekly`, and `resetCoupons`; when only weekly succeeds it returns `{email, plan, weekly, resetCoupons, legacy: null}`. Coupon status is `ok`, `unknown`, or `error`; progrok never redeems a reset.

### Not in `/v1/models`

These are reachable but the catalog does not list them, so `progrok models`
will not show them.

| Model | Best for | Notes |
| --- | --- | --- |
| `grok-composer-2.5-fast` | Agentic code composition | Live on `/v1/chat/completions`; supports `reasoning_content`. May need team-level access. |
| `grok-voice-latest` | Rolling Voice alias, `progrok live` default | Points to `grok-voice-3.0`. Realtime voice models are not catalog entries. |
| `grok-voice-3.0` | Reproducible Voice pin | Reasoning effort `high` (default) or `none`; `grok-voice-2.0` is deprecated. |

Text pricing for `grok-4.6` is $2.00 per 1M input tokens and $6.00 per 1M output
tokens, from [docs.x.ai/developers/models](https://docs.x.ai/developers/models)
as of 2026-09-19. progrok is not the source of truth for pricing; xAI can change it.

Run the live metadata command before relying on a model in automation:

```bash
progrok models --detail
progrok capabilities --json
```

## How It Works

```text
OpenAI client, coding agent, curl script, or local web app
  -> http://127.0.0.1:18645/v1/* (or same-origin :18646/v1/*)
  -> parse known JSON requests into canonical request IR
  -> progrok loads/refreshes ~/.progrok/auth.json and injects the bearer
  -> https://api.x.ai/v1/*
  -> reduce known SSE streams into typed events
  -> render the client protocol; relay verified binary/multipart paths unchanged
```

Credentials are stored locally at `~/.progrok/auth.json` and refreshed before
expiry. Treat that file like any other account credential.

The direct command path is similar but skips the proxy server:

```text
progrok search / image / video / tts / stt / live / models / capabilities
  -> load the same local OAuth session
  -> call the relevant xAI endpoint
  -> add CLI-specific behavior such as polling, files, or JSON output
```

WebSocket clients skip the localhost proxy:

```text
server client -> stored bearer -> wss://api.x.ai/v1/{responses,realtime,stt,tts}
browser -> same-origin POST /v1/realtime/client_secrets
        -> fresh one-use xai-client-secret.<token> subprotocol
        -> wss://api.x.ai/v1/{realtime,stt}
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

ima2-gen v3.16.1 no longer bundles or supervises progrok. It calls xAI directly;
the two tools only share the path and schema of `~/.progrok/auth.json`.

## 3.0.0 migration: capabilities schema v2

`progrok capabilities --json` now emits `schemaVersion: 2`. Its `commands`
property is a `CommandManifestEntry[]`, not a string array:

```json
{
  "schemaVersion": 2,
  "commands": [
    {"name":"tts","summary":"Synthesize speech to a file or stdout.","mutatesRemote":true,"json":true}
  ]
}
```

Consumers written for schema v1 must read names with
`capabilities.commands.map((entry) => entry.name)`. `COMMAND_MANIFEST` owns the
command entries and `SURFACE_REGISTRY` owns endpoint metadata. Existing command
names and localhost HTTP routes remain, but the JSON shape change is the 3.0.0
breaking boundary.

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
- Ephemeral client secrets are one-connection credentials. Keep them in memory,
  pass them only as the WebSocket subprotocol, and mint a new secret for every
  connection and reconnect.

## Troubleshooting

### `progrok status` says no session

Run `progrok login` again. It prints a URL and a code, so it works over SSH as-is;
add `--browser` on a desktop to open the browser instead.

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
