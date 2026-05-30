---
name: progrok
description: "Free Grok API via OAuth proxy. Use when you need xAI Grok models (chat, search, image, video, tts, stt) without an API key. Requires SuperGrok subscription + `progrok login` once."
metadata:
  {
    "triggers": ["grok", "xai", "progrok", "grok-4", "x search", "grok search", "grok image", "grok video", "grok tts", "grok stt"],
    "requires": { "bins": ["progrok"] }
  }
---

# progrok — Free Grok API via OAuth Proxy

## When to Use

- You need to call xAI Grok models (chat, reasoning, search, images, video, audio)
- No XAI_API_KEY available — use OAuth instead
- Any task that benefits from real-time X/web search (Grok's native tools)
- Image/video generation via Grok Imagine
- Text-to-speech or speech-to-text

## Prerequisites

```bash
progrok login          # one-time OAuth (browser or --device-code for SSH)
progrok status         # verify: "Status: Logged in"
```

## Usage Patterns

### Pattern 1: Direct Proxy (recommended for agents)

```bash
progrok proxy &
curl http://127.0.0.1:18645/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer anything" \
  -d '{"model": "grok-4.3", "messages": [{"role": "user", "content": "Hello"}]}'
```

### Pattern 2: Responses API with Tools

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

### Pattern 3: Image Generation

```bash
curl http://127.0.0.1:18645/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-imagine-image", "prompt": "A futuristic cityscape", "n": 1}'
```

### Pattern 4: Video Generation (async)

```bash
# Start
curl -s http://127.0.0.1:18645/v1/videos/generations \
  -H "Content-Type: application/json" \
  -d '{"model": "grok-imagine-video", "prompt": "Ocean waves"}'
# → {"request_id": "abc-123"}

# Poll
curl http://127.0.0.1:18645/v1/videos/abc-123
# → {"status": "pending", "progress": 45}
# → {"status": "done", "video": {"url": "https://...", "duration": 8}}
```

### Pattern 5: TTS / STT

```bash
# Text-to-speech
curl http://127.0.0.1:18645/v1/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "voice_id": "eve", "language": "en"}' -o out.mp3

# Speech-to-text
curl http://127.0.0.1:18645/v1/stt -F "file=@audio.mp3" -F "language=en"
```

### Pattern 6: OpenAI SDK / LangChain

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:18645/v1", api_key="anything")
response = client.chat.completions.create(
    model="grok-4.3",
    messages=[{"role": "user", "content": "Hello"}],
)
```

## API Surface

| Endpoint | Method | Type |
|----------|--------|------|
| `/v1/responses` | POST | Streaming — tools, reasoning, citations |
| `/v1/chat/completions` | POST | Streaming — OpenAI compatible |
| `/v1/models` | GET | Model list |
| `/v1/language-models` | GET | Detailed: pricing, aliases, modalities |
| `/v1/images/generations` | POST | Sync — returns image URL |
| `/v1/videos/generations` | POST | Async — returns request_id |
| `/v1/videos/{id}` | GET | Poll — pending/done |
| `/v1/tts` | POST | Binary audio response |
| `/v1/stt` | POST | Multipart file upload |
| `/v1/embeddings` | POST | Text embeddings |
| Any `/v1/*` | * | Forwarded without filtering |

## Models

| Model | Best For |
|-------|---------|
| `grok-4.3` (default) | General reasoning, chat |
| `grok-4.20-0309-reasoning` | Deep analysis, complex coding |
| `grok-4.20-0309-non-reasoning` | Fast responses, simple tasks |
| `grok-4.20-multi-agent-0309` | Deep research (4 or 16 parallel agents) |
| `grok-build-0.1` | Code generation |
| `grok-imagine-image` | Fast image gen |
| `grok-imagine-image-quality` | HQ image gen |
| `grok-imagine-video` | Video gen (async) |

## Multi-Agent Model

`grok-4.20-multi-agent-0309` spawns parallel agents internally.

```bash
# 4 agents (default, fast)
curl .../v1/responses -d '{"model":"grok-4.20-multi-agent-0309","reasoning":{"effort":"low"},...}'

# 16 agents (thorough, ~100 web searches)
curl .../v1/responses -d '{"model":"grok-4.20-multi-agent-0309","reasoning":{"effort":"xhigh"},...}'
```

| effort | Agents | Searches | Cost | Time |
|--------|:------:|:--------:|-----:|-----:|
| low/medium | 4 | ~32 | ~$0.33 | ~38s |
| high/xhigh | 16 | ~102 | ~$1.05 | ~43s |

Supports: `web_search`, `x_search`, `json_schema` structured output, `function` calling.

Does NOT support: per-agent role/tool/schema definition. Agent orchestration is a black box — you control count only.

## Tools (Responses API)

```json
{"tools": [
  {"type": "web_search"},
  {"type": "x_search"},
  {"type": "code_interpreter"},
  {"type": "file_search", "vector_store_ids": ["..."]},
  {"type": "function", "name": "my_func", "parameters": {...}}
]}
```

## Structured Output (JSON Schema)

Force the response into a specific JSON structure:

```bash
curl http://127.0.0.1:18645/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-4.3",
    "input": [{"role":"user","content":"Latest AI releases"}],
    "tools": [{"type":"web_search"}],
    "text": {
      "format": {
        "type": "json_schema",
        "name": "results",
        "schema": {
          "type": "object",
          "properties": {
            "items": {"type": "array", "items": {"type": "object", "properties": {"name":{"type":"string"},"summary":{"type":"string"}}, "required":["name","summary"]}}
          },
          "required": ["items"]
        },
        "strict": true
      }
    }
  }'
```

Works with all models including `grok-4.20-multi-agent-0309`.

## Ports

- Proxy: `127.0.0.1:18645`
- Chat UI: `127.0.0.1:18646`
- OAuth callback: `127.0.0.1:56121`
- Config: `~/.progrok/auth.json`

## Dynamic Metadata

For programmatic access to capabilities, models, and endpoints:

```bash
progrok capabilities          # human-readable
progrok capabilities --json   # structured JSON for agents
```

## Install

```bash
npm i -g progrok
```
