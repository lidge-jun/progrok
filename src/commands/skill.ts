import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function skillCommand(): Command {
  return new Command("skill")
    .description(
      `Print progrok skill reference for AI agents.
  Outputs the full API surface, usage patterns, models, and tools.
  Designed to be piped into agent context or read programmatically.`,
    )
    .option("--json", "Output as JSON instead of markdown")
    .action((opts: { json?: boolean }) => {
      if (opts.json) {
        console.log(JSON.stringify(SKILL_DATA, null, 2));
      } else {
        console.log(SKILL_MARKDOWN);
      }
    });
}

const SKILL_DATA = {
  name: "progrok",
  version: "0.1.0",
  description: "Free Grok API via OAuth proxy. No API key needed.",
  proxy: {
    host: "127.0.0.1",
    port: 18645,
    base_url: "http://127.0.0.1:18645/v1",
  },
  chat: {
    port: 18646,
    url: "http://127.0.0.1:18646",
  },
  endpoints: [
    { path: "/v1/responses", method: "POST", type: "streaming", description: "Responses API — tools, reasoning, citations" },
    { path: "/v1/chat/completions", method: "POST", type: "streaming", description: "OpenAI-compatible chat" },
    { path: "/v1/models", method: "GET", type: "sync", description: "List models" },
    { path: "/v1/language-models", method: "GET", type: "sync", description: "Detailed models: pricing, aliases, modalities" },
    { path: "/v1/images/generations", method: "POST", type: "sync", description: "Image generation (returns URL)" },
    { path: "/v1/videos/generations", method: "POST", type: "async", description: "Video generation (returns request_id)" },
    { path: "/v1/videos/{id}", method: "GET", type: "poll", description: "Video status: pending → done" },
    { path: "/v1/tts", method: "POST", type: "binary", description: "Text-to-speech (MP3)" },
    { path: "/v1/stt", method: "POST", type: "multipart", description: "Speech-to-text" },
    { path: "/v1/embeddings", method: "POST", type: "sync", description: "Text embeddings" },
    { path: "/v1/*", method: "*", type: "passthrough", description: "All paths forwarded to api.x.ai" },
  ],
  models: [
    { id: "grok-4.3", type: "reasoning", use: "General chat, analysis" },
    { id: "grok-4.20-0309-reasoning", type: "deep-reasoning", use: "Complex coding, planning" },
    { id: "grok-4.20-0309-non-reasoning", type: "fast", use: "Quick tasks" },
    { id: "grok-4.20-multi-agent-0309", type: "multi-agent", use: "Agent orchestration" },
    { id: "grok-build-0.1", type: "code", use: "Code generation" },
    { id: "grok-imagine-image", type: "image", use: "Fast image gen" },
    { id: "grok-imagine-image-quality", type: "image-hq", use: "High-quality image gen" },
    { id: "grok-imagine-video", type: "video", use: "Video gen (async)" },
  ],
  tools: [
    { type: "web_search", description: "Web search with citations" },
    { type: "x_search", description: "X (Twitter) search with citations" },
    { type: "code_interpreter", description: "Server-side code execution" },
    { type: "file_search", description: "Vector store search (needs vector_store_ids)" },
    { type: "function", description: "Custom function calling" },
  ],
};

const SKILL_MARKDOWN = `# progrok skill

## Quick Start
\`\`\`bash
progrok proxy &
export OPENAI_BASE_URL=http://127.0.0.1:18645/v1
export OPENAI_API_KEY=anything
\`\`\`

## Endpoints (all forwarded to api.x.ai)
  POST /v1/responses            Streaming — tools, reasoning, citations
  POST /v1/chat/completions     OpenAI-compatible chat
  GET  /v1/models               List models
  GET  /v1/language-models      Pricing, aliases, modalities
  POST /v1/images/generations   Image gen (sync, returns URL)
  POST /v1/videos/generations   Video gen (async, returns request_id)
  GET  /v1/videos/{id}          Poll video: pending → done
  POST /v1/tts                  Text-to-speech (binary MP3)
  POST /v1/stt                  Speech-to-text (multipart)
  POST /v1/embeddings           Text embeddings
  *    /v1/*                    All paths forwarded

## Models
  grok-4.3                      General reasoning (default)
  grok-4.20-0309-reasoning      Deep analysis, complex coding
  grok-4.20-0309-non-reasoning  Fast responses
  grok-4.20-multi-agent-0309    Agent orchestration
  grok-build-0.1                Code generation
  grok-imagine-image            Image gen
  grok-imagine-image-quality    HQ image gen
  grok-imagine-video            Video gen (async)

## Tools (Responses API)
  {"type": "web_search"}        Web search + citations
  {"type": "x_search"}          X/Twitter search + citations
  {"type": "code_interpreter"}  Server-side code execution
  {"type": "file_search"}       Vector store search
  {"type": "function"}          Custom function calling

## Examples

### Chat
curl http://127.0.0.1:18645/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"grok-4.3","messages":[{"role":"user","content":"Hello"}]}'

### Search
curl http://127.0.0.1:18645/v1/responses \\
  -H "Content-Type: application/json" \\
  -d '{"model":"grok-4.3","input":[{"role":"user","content":"Tesla news"}],"tools":[{"type":"web_search"},{"type":"x_search"}]}'

### Image
curl http://127.0.0.1:18645/v1/images/generations \\
  -H "Content-Type: application/json" \\
  -d '{"model":"grok-imagine-image","prompt":"sunset","n":1}'

### Video (async)
curl http://127.0.0.1:18645/v1/videos/generations \\
  -H "Content-Type: application/json" \\
  -d '{"model":"grok-imagine-video","prompt":"ocean waves"}'
# poll: curl http://127.0.0.1:18645/v1/videos/{request_id}

### TTS
curl http://127.0.0.1:18645/v1/tts \\
  -H "Content-Type: application/json" \\
  -d '{"text":"Hello","voice_id":"eve","language":"en"}' -o out.mp3

### STT
curl http://127.0.0.1:18645/v1/stt -F file=@audio.mp3 -F language=en

## Ports
  Proxy:    127.0.0.1:18645
  Chat UI:  127.0.0.1:18646
  OAuth CB: 127.0.0.1:56121
  Config:   ~/.progrok/auth.json
`;
