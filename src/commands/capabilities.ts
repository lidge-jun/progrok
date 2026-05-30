import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  XAI_API_BASE_URL,
  DEFAULT_MODEL,
  PROXY_DEFAULT_PORT,
  PROXY_DEFAULT_HOST,
  CHAT_DEFAULT_PORT,
} from "../auth/constants.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version || "?";
  } catch {
    return "?";
  }
}

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
    ],
    proxy: {
      host: PROXY_DEFAULT_HOST,
      port: PROXY_DEFAULT_PORT,
      baseUrl: `http://${PROXY_DEFAULT_HOST}:${PROXY_DEFAULT_PORT}/v1`,
      forwarding: "all /v1/* paths — no whitelist",
    },
    chat: {
      port: CHAT_DEFAULT_PORT,
      url: `http://${PROXY_DEFAULT_HOST}:${CHAT_DEFAULT_PORT}`,
    },
    defaults: {
      model: DEFAULT_MODEL,
    },
    endpoints: [
      {
        path: "/v1/responses",
        method: "POST",
        type: "streaming",
        description: "Responses API — tools, reasoning, citations",
      },
      {
        path: "/v1/chat/completions",
        method: "POST",
        type: "streaming",
        description: "OpenAI-compatible chat",
      },
      {
        path: "/v1/models",
        method: "GET",
        type: "sync",
        description: "List models",
      },
      {
        path: "/v1/language-models",
        method: "GET",
        type: "sync",
        description: "Detailed models: pricing, aliases, modalities",
      },
      {
        path: "/v1/images/generations",
        method: "POST",
        type: "sync",
        description: "Image generation (returns URL)",
      },
      {
        path: "/v1/videos/generations",
        method: "POST",
        type: "async",
        description: "Video generation (returns request_id)",
      },
      {
        path: "/v1/videos/{id}",
        method: "GET",
        type: "poll",
        description: "Video status: pending → done",
      },
      {
        path: "/v1/tts",
        method: "POST",
        type: "binary",
        description: "Text-to-speech (MP3)",
      },
      {
        path: "/v1/stt",
        method: "POST",
        type: "multipart",
        description: "Speech-to-text",
      },
      {
        path: "/v1/embeddings",
        method: "POST",
        type: "sync",
        description: "Text embeddings",
      },
      {
        path: "/v1/*",
        method: "*",
        type: "passthrough",
        description: "All paths forwarded to api.x.ai",
      },
    ],
    models: [
      { id: "grok-4.3", type: "reasoning", use: "General chat, analysis" },
      {
        id: "grok-4.20-0309-reasoning",
        type: "deep-reasoning",
        use: "Complex coding, planning",
      },
      {
        id: "grok-4.20-0309-non-reasoning",
        type: "fast",
        use: "Quick tasks",
      },
      {
        id: "grok-4.20-multi-agent-0309",
        type: "multi-agent",
        use: "Agent orchestration",
      },
      { id: "grok-build-0.1", type: "code", use: "Code generation" },
      {
        id: "grok-imagine-image",
        type: "image",
        use: "Fast image gen",
      },
      {
        id: "grok-imagine-image-quality",
        type: "image-hq",
        use: "High-quality image gen",
      },
      {
        id: "grok-imagine-video",
        type: "video",
        use: "Video gen (async)",
      },
    ],
    tools: [
      { type: "web_search", description: "Web search with citations" },
      { type: "x_search", description: "X (Twitter) search with citations" },
      {
        type: "code_interpreter",
        description: "Server-side code execution",
      },
      {
        type: "file_search",
        description: "Vector store search (needs vector_store_ids)",
      },
      { type: "function", description: "Custom function calling" },
    ],
    guidance: {
      auth: "Run progrok login once. No API key needed — OAuth only.",
      proxy:
        "progrok proxy forwards all /v1/* paths. Set OPENAI_BASE_URL=http://127.0.0.1:18645/v1 and OPENAI_API_KEY=anything.",
      streaming:
        "Use stream:true for responses/chat. Proxy passes through SSE events verbatim.",
      video:
        "Video gen is async: POST /v1/videos/generations → poll GET /v1/videos/{id} until done.",
    },
  };
}

function printText(cap: ReturnType<typeof buildCapabilities>): void {
  console.log(`progrok capabilities (${cap.source})`);
  console.log(`version: ${cap.version}`);
  console.log(`upstream: ${cap.upstream}`);
  console.log("");
  console.log(`proxy: ${cap.proxy.baseUrl}`);
  console.log(`chat:  ${cap.chat.url}`);
  console.log(`model: ${cap.defaults.model}`);
  console.log("");
  console.log("endpoints:");
  for (const ep of cap.endpoints) {
    const label = `  ${ep.method.padEnd(5)} ${ep.path.padEnd(28)}`;
    console.log(`${label} ${ep.description}`);
  }
  console.log("");
  console.log("models:");
  for (const m of cap.models) {
    console.log(`  ${m.id.padEnd(38)} ${m.use}`);
  }
  console.log("");
  console.log("tools:");
  for (const t of cap.tools) {
    console.log(`  ${t.type.padEnd(20)} ${t.description}`);
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
