import { Command } from "commander";
import {
  AUTH_FILE,
  CHAT_DEFAULT_PORT,
  PROXY_DEFAULT_HOST,
  PROXY_DEFAULT_PORT,
  XAI_API_BASE_URL,
} from "../auth/constants.js";
import { ModelsClient } from "../surfaces/index.js";
import type { ModelFamily, XaiModel } from "../surfaces/models.js";
import { SURFACE_REGISTRY } from "../surfaces/registry.js";
import { createXaiTransport } from "../transport/fetch.js";
import { readPackageVersion } from "../utils/version.js";
import { COMMAND_MANIFEST, DEFAULT_LIVE_MODEL } from "./command-manifest.js";

const MODEL_FAMILIES = [
  "models",
  "language-models",
  "image-generation-models",
  "video-generation-models",
  "embedding-models",
] as const satisfies readonly ModelFamily[];

const VIDEO_NOTES = [
  { id: "text-to-video", endpoint: "POST /v1/videos/generations", cli: "progrok video <prompt>", status: "supported" },
  { id: "image-to-video", endpoint: "POST /v1/videos/generations", cli: "progrok video <prompt> --image <input>", status: "supported" },
  { id: "reference-to-video", endpoint: "POST /v1/videos/generations", cli: "progrok video <prompt> --ref <input>", status: "supported" },
  { id: "edit-video", endpoint: "POST /v1/videos/edits", cli: "progrok video edit <prompt> --video <input>", status: "supported-grok-imagine-video-only" },
  { id: "extend-video", endpoint: "POST /v1/videos/extensions", cli: "progrok video extend <prompt> --video <input>", status: "supported-grok-imagine-video-only" },
] as const;

export interface CatalogSnapshot {
  status: "live" | "partial" | "offline" | "unavailable";
  fetchedAt: string | null;
  families: Partial<Record<ModelFamily, XaiModel[]>>;
  errors: Partial<Record<ModelFamily, string>>;
}

export async function loadCatalogSnapshot(options: {
  offline?: boolean;
  client?: ModelsClient;
} = {}): Promise<CatalogSnapshot> {
  if (options.offline) {
    return { status: "offline", fetchedAt: null, families: {}, errors: {} };
  }

  try {
    const client = options.client ?? new ModelsClient(createXaiTransport());
    const settled = await Promise.allSettled(
      MODEL_FAMILIES.map((family) => client.list(family)),
    );
    const families: CatalogSnapshot["families"] = {};
    const errors: CatalogSnapshot["errors"] = {};
    settled.forEach((result, index) => {
      const family = MODEL_FAMILIES[index];
      if (result.status === "fulfilled") families[family] = result.value;
      else {
        errors[family] = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      }
    });
    const successes = Object.keys(families).length;
    return {
      status: successes === MODEL_FAMILIES.length
        ? "live"
        : successes > 0
          ? "partial"
          : "unavailable",
      fetchedAt: new Date().toISOString(),
      families,
      errors,
    };
  } catch (error) {
    return {
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
      families: {},
      errors: { models: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function buildCapabilities(options: {
  offline?: boolean;
  client?: ModelsClient;
} = {}) {
  const modelCatalog = await loadCatalogSnapshot(options);
  const models = modelCatalog.families.models ?? [];
  const voiceModels = models.filter((model) =>
    /(^|-)voice(-|$)|(^|-)tts(-|$)|(^|-)stt(-|$)/.test(model.id)
  );
  const websockets = SURFACE_REGISTRY
    .filter((surface) => surface.transport === "websocket")
    .map((surface) => {
      const url = new URL(surface.path);
      return {
        path: url.pathname,
        url: surface.path,
        family: surface.family,
        evidence: surface.evidence,
        proxied: false as const,
      };
    });

  return {
    schemaVersion: 2,
    ok: true,
    name: "progrok",
    version: readPackageVersion(),
    source: "local",
    upstream: XAI_API_BASE_URL,
    commands: COMMAND_MANIFEST,
    auth: {
      kind: "oauth" as const,
      file: AUTH_FILE,
      inboundAuthorization: "ignored-and-replaced-with-stored-oauth" as const,
    },
    proxy: {
      host: PROXY_DEFAULT_HOST,
      port: PROXY_DEFAULT_PORT,
      baseUrl: `http://${PROXY_DEFAULT_HOST}:${PROXY_DEFAULT_PORT}/v1`,
      forwarding: "all HTTP /v1/* paths — no whitelist",
    },
    webApp: {
      host: PROXY_DEFAULT_HOST,
      port: CHAT_DEFAULT_PORT,
      url: `http://${PROXY_DEFAULT_HOST}:${CHAT_DEFAULT_PORT}`,
    },
    endpoints: SURFACE_REGISTRY,
    websockets,
    modelCatalog,
    models,
    voiceModels,
    recommendations: {
      liveDefaultModel: DEFAULT_LIVE_MODEL,
      note: "Pinned operational default; not synthesized into the live catalog.",
    },
    videoNotes: VIDEO_NOTES,
    tools: [
      { type: "web_search", description: "Web search and browse." },
      { type: "x_search", description: "X search with citations." },
      { type: "code_interpreter", description: "Server-side code execution." },
      { type: "file_search", description: "RAG over collections." },
      { type: "mcp", description: "Remote MCP server tools." },
      { type: "function", description: "Client-side function calling." },
    ],
    guidance: {
      auth: "Run `progrok login` once.",
      proxy: "`progrok proxy` forwards all HTTP /v1/* paths.",
      models: "Use `progrok models --json` for the live model catalog.",
    },
    limitations: [
      "The local proxy handles HTTP only; live and Responses WebSocket clients connect directly to api.x.ai.",
      "Collection management requires management-api.x.ai and a Management API key; progrok exposes only collection search.",
    ],
  };
}

type Capabilities = Awaited<ReturnType<typeof buildCapabilities>>;

function printText(cap: Capabilities): void {
  console.log(`progrok capabilities (${cap.source})`);
  console.log(`version: ${cap.version}`);
  console.log(`upstream: ${cap.upstream}`);
  console.log(`proxy: ${cap.proxy.baseUrl}`);
  console.log(`web app: ${cap.webApp.url}`);
  console.log(`model catalog: ${cap.modelCatalog.status}`);
  for (const family of MODEL_FAMILIES) {
    console.log(`  ${family}: ${cap.modelCatalog.families[family]?.length ?? 0}`);
  }
  console.log("");
  console.log("endpoints:");
  for (const endpoint of cap.endpoints) {
    console.log(`  ${endpoint.method.padEnd(6)} ${endpoint.path} [${endpoint.transport}; ${endpoint.evidence}]`);
  }
  console.log("");
  console.log("websocket (not proxied):");
  for (const websocket of cap.websockets) console.log(`  ${websocket.url}`);
  console.log("");
  console.log("models:");
  for (const model of cap.models) {
    const aliases = model.aliases.length > 0 ? ` (${model.aliases.join(", ")})` : "";
    console.log(`  ${model.id}${aliases}`);
  }
  console.log("");
  console.log(`commands: ${cap.commands.map((entry) => entry.name).join(", ")}`);
}

export function capabilitiesCommand(): Command {
  return new Command("capabilities")
    .description("Print agent-friendly capability metadata.")
    .option("--json", "Output as JSON")
    .option("--offline", "Skip live model catalog requests")
    .action(async (opts: { json?: boolean; offline?: boolean }) => {
      const cap = await buildCapabilities({ offline: opts.offline });
      if (opts.json) console.log(JSON.stringify(cap, null, 2));
      else printText(cap);
    });
}
