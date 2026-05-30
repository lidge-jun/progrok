# progrok API Reference

progrok runs a local proxy that forwards all `/v1/*` requests to `https://api.x.ai/v1`, injecting your OAuth token automatically.

**Key behavior:** The proxy strips any `Authorization` header you send and replaces it with the stored OAuth bearer token. You can pass any value — the proxy handles auth.

---

## Proxy Endpoints

### GET /health

Health check.

```bash
curl http://127.0.0.1:18645/health
```

```json
{"status": "ok", "upstream": "xAI Grok", "proxy": "progrok"}
```

---

### POST /v1/responses

xAI Responses API. Supports streaming, tools (web_search, x_search, code_interpreter, file_search), and function calling.

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

---

### POST /v1/chat/completions

OpenAI-compatible chat completions.

```bash
curl http://127.0.0.1:18645/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-4.3", "messages": [{"role": "user", "content": "Hello"}]}'
```

---

### GET /v1/models

List available models (minimal info).

```bash
curl http://127.0.0.1:18645/v1/models
```

### GET /v1/language-models

List models with full details: pricing, modalities, aliases.

```bash
curl http://127.0.0.1:18645/v1/language-models
```

---

### POST /v1/images/generations

Generate images with Grok Imagine.

```bash
curl http://127.0.0.1:18645/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-imagine-image", "prompt": "A serene Japanese garden", "n": 1}'
```

Models: `grok-imagine-image` (fast), `grok-imagine-image-quality` (high quality).

---

### POST /v1/videos/generations

Generate videos (async — returns `request_id`).

```bash
# Start generation
curl http://127.0.0.1:18645/v1/videos/generations \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-imagine-video", "prompt": "A red ball bouncing"}'
# Response: {"request_id": "abc-123"}
```

### GET /v1/videos/{request_id}

Poll video generation progress. Returns HTTP 202 while pending, 200 when done.

```bash
curl http://127.0.0.1:18645/v1/videos/abc-123
# Pending: {"status": "pending", "progress": 45}
# Done:    {"status": "done", "video": {"url": "https://...", "duration": 8}, "progress": 100}
```

---

### POST /v1/tts

Text-to-speech. Returns raw audio bytes (MP3 by default).

```bash
curl http://127.0.0.1:18645/v1/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "voice_id": "eve", "language": "en"}' \
  -o output.mp3
```

---

### POST /v1/stt

Speech-to-text. Accepts multipart/form-data with audio file.

```bash
curl http://127.0.0.1:18645/v1/stt \
  -F "file=@recording.mp3" \
  -F "language=en"
```

```json
{"text": "Hello world", "language": "English", "duration": 1.5}
```

---

### POST /v1/batch/completions

Batch chat completions.

---

### All Other /v1/* Paths

The proxy forwards **every** `/v1/*` request to xAI without filtering. Any new xAI endpoint is automatically supported.

---

## Authentication

### PKCE Flow (Browser)

```
progrok login
```

1. Opens browser to `https://auth.x.ai/...` with PKCE challenge
2. User logs in with xAI account (SuperGrok required)
3. Callback on `127.0.0.1:56121/callback`
4. Token exchange and save to `~/.progrok/auth.json`

### Device Code Flow (SSH/Remote)

```
progrok login --device-code
```

1. Displays URL + code in terminal
2. User opens URL in any browser, enters code
3. CLI polls until authorized

### Token Storage

```
~/.progrok/auth.json
{
  "accessToken": "eyJ...",
  "refreshToken": "J69...",
  "expiresAt": 1780152218787,
  "tokenEndpoint": "https://auth.x.ai/oauth2/token",
  "email": "user@example.com"
}
```

Token is auto-refreshed 2 minutes before expiry using the refresh token.

---

## Available Models

| Model | Type | Input |
|-------|------|-------|
| `grok-4.3` (default) | Reasoning | text, image |
| `grok-4.20-0309-reasoning` | Deep reasoning | text, image |
| `grok-4.20-0309-non-reasoning` | Fast | text, image |
| `grok-4.20-multi-agent-0309` | Multi-agent | text, image |
| `grok-build-0.1` | Code | text, image |
| `grok-imagine-image` | Image gen | text |
| `grok-imagine-image-quality` | Image gen (HQ) | text |
| `grok-imagine-video` | Video gen (async) | text |

Use `progrok models --detail` for full pricing and alias info.
