import { Command } from "commander";
import {
  XAI_API_BASE_URL,
  DEFAULT_MODEL,
  PROXY_DEFAULT_PORT,
  PROXY_DEFAULT_HOST,
  CHAT_DEFAULT_PORT,
} from "../auth/constants.js";
import { readPackageVersion } from "../utils/version.js";


// Endpoint surface mirrors the xAI REST API (https://docs.x.ai). Every HTTP
// /v1/* path is forwarded by the proxy verbatim. WebSocket (wss) endpoints and
// the management-api.x.ai host are NOT proxied — see `limitations`.
const ENDPOINTS = [
  // Chat & Responses
  { category: "chat", method: "POST", path: "/v1/chat/completions", type: "streaming", description: "OpenAI-compatible chat + image understanding" },
  { category: "chat", method: "POST", path: "/v1/responses", type: "streaming", description: "Responses API — tools, reasoning, citations, stateful" },
  { category: "chat", method: "POST", path: "/v1/responses/compact", type: "sync", description: "Context compaction — shrink history for reuse" },
  { category: "chat", method: "GET", path: "/v1/responses/{id}", type: "sync", description: "Retrieve a stored response (kept 30 days)" },
  { category: "chat", method: "DELETE", path: "/v1/responses/{id}", type: "sync", description: "Delete a stored response" },
  { category: "chat", method: "GET", path: "/v1/chat/deferred-completion/{id}", type: "poll", description: "Fetch a deferred completion (202 pending / 200 done)" },
  // Images (Imagine API)
  { category: "images", method: "POST", path: "/v1/images/generations", type: "sync", description: "Text-to-image — aspect_ratio, resolution 1k/2k, n, url|b64_json" },
  { category: "images", method: "POST", path: "/v1/images/edits", type: "sync", description: "Edit / multi-image compose — image{} or images[] + prompt" },
  // Videos (Imagine API, async)
  { category: "videos", method: "POST", path: "/v1/videos/generations", type: "async", description: "T2V / I2V / R2V — duration 1-15s; R2V max 7 refs and 10s; output 480p/720p confirmed" },
  { category: "videos", method: "POST", path: "/v1/videos/edits", type: "async", description: "Edit a source video by prompt; no duration/aspect/resolution controls" },
  { category: "videos", method: "POST", path: "/v1/videos/extensions", type: "async", description: "Extend a video (2-10s continuation); no aspect/resolution controls" },
  { category: "videos", method: "GET", path: "/v1/videos/{id}", type: "poll", description: "Poll generation: pending(progress) → done(video.url)" },
  // Voice — HTTP
  { category: "voice", method: "POST", path: "/v1/tts", type: "binary", description: "Text-to-speech — voice_id, output_format, speed, speech tags" },
  { category: "voice", method: "GET", path: "/v1/tts/voices", type: "sync", description: "List built-in voices (ara, eve, leo, rex, sal)" },
  { category: "voice", method: "GET", path: "/v1/tts/voices/{voice_id}", type: "sync", description: "Get one built-in voice" },
  { category: "voice", method: "POST", path: "/v1/stt", type: "multipart", description: "Speech-to-text — diarize, multichannel, keyterm, word timestamps" },
  { category: "voice", method: "POST", path: "/v1/realtime/client_secrets", type: "sync", description: "Mint ephemeral token for browser Realtime/Voice Agent" },
  { category: "voice", method: "POST", path: "/v1/custom-voices", type: "multipart", description: "Clone a custom voice from reference audio (≤120s)" },
  { category: "voice", method: "GET", path: "/v1/custom-voices", type: "sync", description: "List custom voices (paginated)" },
  { category: "voice", method: "GET", path: "/v1/custom-voices/{voice_id}", type: "sync", description: "Get one custom voice" },
  { category: "voice", method: "PATCH", path: "/v1/custom-voices/{voice_id}", type: "sync", description: "Update custom voice metadata" },
  { category: "voice", method: "DELETE", path: "/v1/custom-voices/{voice_id}", type: "sync", description: "Delete a custom voice" },
  { category: "voice", method: "GET", path: "/v1/custom-voices/{voice_id}/audio", type: "binary", description: "Download a custom voice's reference audio" },
  // Models
  { category: "models", method: "GET", path: "/v1/models", type: "sync", description: "List models (id + pricing)" },
  { category: "models", method: "GET", path: "/v1/models/{model_id}", type: "sync", description: "Get one model" },
  { category: "models", method: "GET", path: "/v1/language-models", type: "sync", description: "Chat models with modalities + aliases + pricing" },
  { category: "models", method: "GET", path: "/v1/language-models/{model_id}", type: "sync", description: "Get one language model" },
  { category: "models", method: "GET", path: "/v1/image-generation-models", type: "sync", description: "Image models with per-image pricing" },
  { category: "models", method: "GET", path: "/v1/image-generation-models/{model_id}", type: "sync", description: "Get one image model" },
  { category: "models", method: "GET", path: "/v1/video-generation-models", type: "sync", description: "Video models with modalities" },
  { category: "models", method: "GET", path: "/v1/video-generation-models/{model_id}", type: "sync", description: "Get one video model" },
  // Batches
  { category: "batches", method: "POST", path: "/v1/batches", type: "sync", description: "Create a batch" },
  { category: "batches", method: "GET", path: "/v1/batches", type: "sync", description: "List batches" },
  { category: "batches", method: "GET", path: "/v1/batches/{id}", type: "sync", description: "Get batch state" },
  { category: "batches", method: "GET", path: "/v1/batches/{id}/requests", type: "sync", description: "List requests in a batch" },
  { category: "batches", method: "POST", path: "/v1/batches/{id}/requests", type: "sync", description: "Add requests to a batch" },
  { category: "batches", method: "GET", path: "/v1/batches/{id}/results", type: "sync", description: "List batch results" },
  { category: "batches", method: "POST", path: "/v1/batches/{id}:cancel", type: "sync", description: "Cancel all requests in a batch" },
  // Files
  { category: "files", method: "POST", path: "/v1/files", type: "multipart", description: "Upload a file (use ≤48MB conservative limit; official pages also mention 50MB) — referenced by file_id" },
  { category: "files", method: "GET", path: "/v1/files", type: "sync", description: "List files (AIP-160 filter, paginated)" },
  { category: "files", method: "GET", path: "/v1/files/{file_id}", type: "sync", description: "Get file metadata" },
  { category: "files", method: "DELETE", path: "/v1/files/{file_id}", type: "sync", description: "Delete a file" },
  // Collections (search only via api.x.ai; management is on management-api.x.ai)
  { category: "collections", method: "POST", path: "/v1/documents/search", type: "sync", description: "Semantic search over collections (RAG)" },
  // Other
  { category: "other", method: "GET", path: "/v1/api-key", type: "sync", description: "Inspect the active API key / ACLs" },
  { category: "other", method: "POST", path: "/v1/tokenize-text", type: "sync", description: "Tokenize text for a model" },
  { category: "other", method: "POST", path: "/v1/embeddings", type: "sync", description: "Text embeddings" },
  { category: "other", method: "*", path: "/v1/*", type: "passthrough", description: "Any other path forwarded to api.x.ai unchanged" },
] as const;

// WebSocket endpoints — documented for completeness but NOT proxied by progrok
// (the proxy handles HTTP only; connect directly with an ephemeral token).
const WEBSOCKET_ENDPOINTS = [
  { url: "wss://api.x.ai/v1/realtime", description: "Voice Agent — realtime speech conversations + MCP tools" },
  { url: "wss://api.x.ai/v1/tts", description: "Streaming text-to-speech (incremental text → audio)" },
  { url: "wss://api.x.ai/v1/stt", description: "Streaming speech-to-text (binary audio → transcript)" },
] as const;

const VIDEO_SURFACES = [
  {
    id: "text-to-video",
    endpoint: "POST /v1/videos/generations",
    cli: "progrok video <prompt>",
    restShape: { prompt: "string", duration: "1-15", aspect_ratio: "string", resolution: "480p|720p" },
    status: "supported",
    smoke: "required-live",
  },
  {
    id: "image-to-video",
    endpoint: "POST /v1/videos/generations",
    cli: "progrok video <prompt> --image <file|url|data|file_id:id>",
    restShape: { image: "{ url | file_id }" },
    status: "supported",
    smoke: "required-live",
  },
  {
    id: "reference-to-video",
    endpoint: "POST /v1/videos/generations",
    cli: "progrok video <prompt> --ref <input> [--ref <input>...]",
    restShape: { reference_images: "[{ url | file_id }]", maxImages: 7, maxDurationSeconds: 10 },
    status: "supported",
    smoke: "required-live",
  },
  {
    id: "edit-video",
    endpoint: "POST /v1/videos/edits",
    cli: "progrok video edit <prompt> --video <file|url|data|file_id:id>",
    restShape: { video: "{ url | file_id }" },
    unsupported: ["duration", "aspect_ratio", "resolution"],
    status: "supported-grok-imagine-video-only",
    smoke: "required-live",
  },
  {
    id: "extend-video",
    endpoint: "POST /v1/videos/extensions",
    cli: "progrok video extend <prompt> --video <file|url|data|file_id:id> --duration <2-10>",
    restShape: { video: "{ url | file_id }", duration: "2-10" },
    unsupported: ["aspect_ratio", "resolution"],
    status: "supported-grok-imagine-video-only",
    smoke: "required-live",
  },
  {
    id: "conflicting-1080p",
    endpoint: "POST /v1/videos/generations",
    cli: "progrok video <prompt> --resolution 1080p",
    status: "live-smoke-failed-for-current-team",
    error: "1080p video resolution is not available for your team.",
    smoke: "failed-negative-confirmed",
  },
  {
    id: "image_url-alias",
    endpoint: "POST /v1/videos/generations",
    status: "live-smoke-passed",
    note: "REST accepted image_url and completed I2V; progrok CLI still emits canonical image: {url|file_id}.",
    smoke: "passed",
  },
  {
    id: "video_url-alias",
    endpoint: "POST /v1/videos/edits",
    status: "live-smoke-failed",
    note: "REST returned 422 missing field video; use canonical video: {url|file_id}.",
    smoke: "failed-negative-confirmed",
  },
  {
    id: "output.upload_url",
    endpoint: "POST /v1/videos/generations",
    cli: "progrok video <prompt> --upload-url <signed-put-url>",
    status: "live-smoke-passed",
    note: "Result video.url echoed the provided upload URL.",
    smoke: "passed",
  },
  {
    id: "video-1.5-preview",
    endpoint: "POST /v1/videos/generations",
    cli: "progrok video <prompt> --model grok-imagine-video-1.5-preview --image <input>",
    status: "live-smoked-i2v-only",
    unsupported: ["prompt-only T2V", "reference_images", "video edit", "video extend"],
    smoke: "passed-i2v-failed-native-t2v-and-r2v",
  },
  {
    id: "sdk-mode-field",
    endpoint: "n/a",
    status: "not-rest-selector",
    note: "REST accepted a stray mode field but ignored it; Vercel AI SDK mode values are provider options that map to endpoints/fields.",
    smoke: "passed-as-ignored-field",
  },
] as const;

export function buildCapabilities() {
  return {
    ok: true,
    name: "progrok",
    version: readPackageVersion(),
    source: "local",
    upstream: XAI_API_BASE_URL,
    commands: [
      "login",
      "logout",
      "proxy",
      "chat",
      "models",
      "status",
      "skill",
      "capabilities",
      "search",
      "image",
      "video",
    ],
    proxy: {
      host: PROXY_DEFAULT_HOST,
      port: PROXY_DEFAULT_PORT,
      baseUrl: `http://${PROXY_DEFAULT_HOST}:${PROXY_DEFAULT_PORT}/v1`,
      forwarding: "all HTTP /v1/* paths — no whitelist",
    },
    chat: {
      port: CHAT_DEFAULT_PORT,
      url: `http://${PROXY_DEFAULT_HOST}:${CHAT_DEFAULT_PORT}`,
    },
    defaults: {
      model: DEFAULT_MODEL,
    },
    endpoints: ENDPOINTS,
    websocketEndpoints: WEBSOCKET_ENDPOINTS,
    videoSurfaces: VIDEO_SURFACES,
    models: [
      {
        id: "grok-4.3",
        type: "reasoning",
        use: "Flagship — chat, agentic tool calling, search, vision",
        input: ["text", "image"],
        output: ["text"],
        context: "1M tokens",
        pricing: { inputPer1M: 1.25, cachedInputPer1M: 0.2, outputPer1M: 2.5, longContext: { thresholdTokens: 200000, inputPer1M: 2.5, cachedInputPer1M: 0.4, outputPer1M: 5.0 }, searchPer1KSources: 25.0, unit: "USD" },
        reasoning: { configurable: true, nonReasoningMode: true, note: "Supports non-reasoning mode for instant replies" },
        structuredOutput: true,
        functionCalling: true,
        tools: ["web_search", "x_search", "code_interpreter", "collections_search", "mcp", "function"],
        aliases: ["grok-4.3-latest", "grok-latest", "grok-4", "grok-4-latest", "grok-4-fast-reasoning", "grok-3", "grok-3-latest", "grok-3-mini"],
      },
      {
        id: "grok-4.20-0309-reasoning",
        type: "deep-reasoning",
        use: "Deep analysis, complex coding (legacy 4.20 line)",
        input: ["text", "image"],
        output: ["text"],
        context: "200K+ (long-context pricing above 200K tokens)",
        pricing: { inputPer1M: 1.25, cachedInputPer1M: 0.2, outputPer1M: 2.5, longContext: { thresholdTokens: 200000, inputPer1M: 2.5, cachedInputPer1M: 0.4, outputPer1M: 5.0 }, searchPer1KSources: 25.0, unit: "USD" },
        reasoning: { effort: ["low", "high"], default: "low" },
        structuredOutput: true,
        functionCalling: true,
        tools: ["web_search", "x_search", "code_interpreter", "collections_search", "mcp", "function"],
        aliases: ["grok-4.20", "grok-4.20-reasoning", "grok-4.20-reasoning-latest", "grok-4.20-beta", "grok-4.20-beta-latest"],
      },
      {
        id: "grok-4.20-0309-non-reasoning",
        type: "fast",
        use: "Fast responses, no thinking overhead (legacy 4.20 line)",
        input: ["text", "image"],
        output: ["text"],
        context: "200K+ (long-context pricing above 200K tokens)",
        pricing: { inputPer1M: 1.25, cachedInputPer1M: 0.2, outputPer1M: 2.5, longContext: { thresholdTokens: 200000, inputPer1M: 2.5, cachedInputPer1M: 0.4, outputPer1M: 5.0 }, searchPer1KSources: 25.0, unit: "USD" },
        reasoning: false,
        structuredOutput: true,
        functionCalling: true,
        tools: ["web_search", "x_search", "code_interpreter", "collections_search", "mcp", "function"],
        aliases: ["grok-4.20-non-reasoning", "grok-4.20-non-reasoning-latest", "grok-4.20-beta-non-reasoning", "grok-4.20-beta-latest-non-reasoning"],
      },
      {
        id: "grok-4.20-multi-agent-0309",
        type: "multi-agent",
        use: "Deep research — 4 or 16 parallel agents (beta)",
        input: ["text", "image"],
        output: ["text"],
        context: "200K+ (long-context pricing above 200K tokens)",
        pricing: { inputPer1M: 1.25, cachedInputPer1M: 0.2, outputPer1M: 2.5, longContext: { thresholdTokens: 200000, inputPer1M: 2.5, cachedInputPer1M: 0.4, outputPer1M: 5.0 }, searchPer1KSources: 25.0, unit: "USD" },
        reasoning: { effort: ["low", "medium", "high", "xhigh"], default: "high", note: "effort selects agent count: low/medium=4, high/xhigh=16; progrok search CLI default is high" },
        structuredOutput: true,
        functionCalling: false,
        tools: ["web_search", "x_search", "code_interpreter", "collections_search", "mcp"],
        notes: "Responses API / xAI SDK only — not Chat Completions. No client-side function calling. No max_tokens.",
        aliases: ["grok-4.20-multi-agent", "grok-4.20-multi-agent-latest", "grok-4.20-multi-agent-beta-latest"],
      },
      {
        id: "grok-build-0.1",
        type: "code",
        use: "Fast agentic coding",
        input: ["text", "image"],
        output: ["text"],
        context: "256K tokens",
        pricing: { inputPer1M: 1.0, cachedInputPer1M: 0.2, outputPer1M: 2.0, longContext: { thresholdTokens: 200000, inputPer1M: 2.0, cachedInputPer1M: 0.4, outputPer1M: 4.0 }, searchPer1KSources: 25.0, unit: "USD" },
        reasoning: { effort: ["low", "high"], default: "low" },
        structuredOutput: true,
        functionCalling: true,
        tools: ["web_search", "x_search", "code_interpreter", "function"],
        aliases: ["grok-code-fast-1", "grok-code-fast", "grok-code-fast-1-0825"],
      },
      {
        id: "grok-imagine-image",
        type: "image",
        use: "Fast image generation / editing",
        input: ["text", "image"],
        output: ["image"],
        maxPromptLength: 8000,
        pricing: { inputPerImage: 0.002, outputPerImage: 0.02, unit: "USD", note: "1k or 2k resolution" },
        aliases: ["grok-imagine-image-2026-03-02"],
      },
      {
        id: "grok-imagine-image-quality",
        type: "image-hq",
        use: "High-quality image generation / editing",
        input: ["text", "image"],
        output: ["image"],
        maxPromptLength: 8000,
        pricing: { inputPerImage: 0.01, outputPerImage1k: 0.05, outputPerImage2k: 0.07, unit: "USD" },
        aliases: ["grok-imagine-image-quality-latest", "grok-imagine-image-pro"],
      },
      {
        id: "grok-imagine-video",
        type: "video",
        use: "Video generation / edit / extension (async)",
        input: ["text", "image", "video"],
        output: ["video"],
        pricing: { inputPerImage: 0.002, inputPerVideoSecond: 0.01, outputPerSecond480p: 0.05, outputPerSecond720p: 0.07, unit: "USD" },
        aliases: [],
      },
      {
        id: "grok-imagine-video-1.5-preview",
        type: "video",
        use: "Video v1.5 preview — live-smoked I2V only",
        input: ["text", "image"],
        output: ["video"],
        pricing: { inputPerImage: 0.01, outputPerSecond480p: 0.08, outputPerSecond720p: 0.14, unit: "USD" },
        aliases: ["grok-imagine-video-1.5-2026-05-30"],
        limitations: ["Prompt-only T2V and reference_images returned xAI 400 in live smoke.", "No confirmed video input/edit/extend support."],
      },
    ],
    voiceModels: [
      { id: "grok-voice-latest", use: "Voice Agent / realtime — recommended" },
      { id: "grok-voice-fast-1.0", use: "Lower-latency voice agent" },
      { id: "grok-voice-think-fast-1.0", use: "Reasoning-capable voice agent" },
    ],
    voicePricing: {
      agentPerHour: 3.0,
      ttsPer1MChars: 15.0,
      sttBatchPerHour: 0.1,
      sttStreamingPerHour: 0.2,
      unit: "USD",
    },
    tools: [
      { type: "web_search", description: "Web search + browse. Params: allowed_domains, excluded_domains, enable_image_understanding, enable_image_search" },
      { type: "x_search", description: "X (Twitter) search with citations" },
      { type: "code_execution", aliases: ["code_interpreter"], description: "Server-side Python execution. REST/SDK alias support differs by surface." },
      { type: "collections_search", aliases: ["file_search"], description: "RAG over your uploaded collections" },
      { type: "attachment_search", description: "Search files attached to the current message" },
      { type: "view_image", description: "Analyze images found during Web Search or X Search" },
      { type: "view_x_video", description: "Analyze X videos found during X Search" },
      { type: "mcp", description: "Remote MCP server. Params: server_url, server_label, allowed_tools, authorization, headers. OpenAI require_approval/connector_id are not xAI params." },
      { type: "function", description: "Custom client-side function calling (max 128)" },
    ],
    searchParameters: {
      mode: ["off", "on", "auto"],
      sources: ["web", "x", "news", "rss"],
      params: ["from_date", "to_date", "max_search_results", "return_citations"],
    },
    limitations: [
      "WebSocket endpoints (wss /v1/realtime, /v1/tts, /v1/stt) are NOT proxied — connect directly with an ephemeral token from POST /v1/realtime/client_secrets.",
      "Collection management lives on management-api.x.ai (Management API key) and is not reachable through this proxy; only POST /v1/documents/search is.",
      "The multi-agent model requires the Responses API (not Chat Completions).",
    ],
    guidance: {
      auth: "Run `progrok login` once. progrok activates the local xAI OAuth session for clients and commands.",
      proxy:
        "`progrok proxy` forwards all HTTP /v1/* paths. Set OPENAI_BASE_URL=http://127.0.0.1:18645/v1 and OPENAI_API_KEY=anything.",
      streaming:
        "Use stream:true for responses/chat. The proxy passes SSE through verbatim.",
      video:
        "Video is async. Generation supports T2V/I2V/R2V; edit and extend use separate endpoints. REST canonical media shape is {url|file_id}; SDK video_url/mode fields are convenience wrappers.",
      models:
        "Use the bare model name or `<model>-latest` to auto-track the newest version; `<model>-<date>` pins a specific release.",
    },
  };
}

type Capabilities = ReturnType<typeof buildCapabilities>;

function printText(cap: Capabilities): void {
  console.log(`progrok capabilities (${cap.source})`);
  console.log(`version: ${cap.version}`);
  console.log(`upstream: ${cap.upstream}`);
  console.log("");
  console.log(`proxy: ${cap.proxy.baseUrl}`);
  console.log(`chat:  ${cap.chat.url}`);
  console.log(`model: ${cap.defaults.model}`);
  console.log("");
  console.log("endpoints (HTTP — proxied):");
  let lastCategory = "";
  for (const ep of cap.endpoints) {
    if (ep.category !== lastCategory) {
      console.log(`  [${ep.category}]`);
      lastCategory = ep.category;
    }
    const label = `    ${ep.method.padEnd(6)} ${ep.path.padEnd(38)}`;
    console.log(`${label} ${ep.description}`);
  }
  console.log("");
  console.log("websocket (NOT proxied — connect directly):");
  for (const ws of cap.websocketEndpoints) {
    console.log(`    ${ws.url.padEnd(30)} ${ws.description}`);
  }
  console.log("");
  console.log("models:");
  for (const m of cap.models) {
    console.log(`  ${m.id.padEnd(30)} ${m.use}`);
  }
  console.log("");
  console.log("tools:");
  for (const t of cap.tools) {
    console.log(`  ${t.type.padEnd(20)} ${t.description}`);
  }
  console.log("");
  console.log("limitations:");
  for (const l of cap.limitations) {
    console.log(`  - ${l}`);
  }
  console.log("");
  console.log(`commands: ${cap.commands.join(", ")}`);
}

export function capabilitiesCommand(): Command {
  return new Command("capabilities")
    .description("Print agent-friendly capability metadata.")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const cap = buildCapabilities();
      if (opts.json) {
        console.log(JSON.stringify(cap, null, 2));
      } else {
        printText(cap);
      }
    });
}
