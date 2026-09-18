import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTH_FILE } from "../src/auth/constants.js";
import {
  buildCapabilities,
  capabilitiesCommand,
  loadCatalogSnapshot,
} from "../src/commands/capabilities.js";
import { COMMAND_MANIFEST } from "../src/commands/command-manifest.js";
import { ModelsClient } from "../src/surfaces/index.js";
import type { ModelFamily } from "../src/surfaces/models.js";
import { SURFACE_REGISTRY } from "../src/surfaces/registry.js";
import type { XaiTransport } from "../src/transport/fetch.js";

const FAMILIES: readonly ModelFamily[] = [
  "models",
  "language-models",
  "image-generation-models",
  "video-generation-models",
  "embedding-models",
];

function catalogClient(failures: ReadonlySet<ModelFamily> = new Set()): ModelsClient {
  const transport: XaiTransport = {
    async fetch(input) {
      const family = input.pathWithQuery.slice(1) as ModelFamily;
      if (failures.has(family)) {
        return new Response(JSON.stringify({ error: { message: `${family} unavailable` } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      const model = { id: family === "models" ? "grok-voice-latest" : `${family}-sample`, aliases: [] };
      return Response.json(family === "models" ? { data: [model] } : { models: [model] });
    },
  };
  return new ModelsClient(transport);
}

describe("capabilities schema v2", () => {
  it("stays offline without touching the model client", async () => {
    let calls = 0;
    const client = new ModelsClient({
      async fetch() {
        calls += 1;
        throw new Error("must not fetch");
      },
    });
    const snapshot = await loadCatalogSnapshot({ offline: true, client });
    assert.deepEqual(snapshot, {
      status: "offline",
      fetchedAt: null,
      families: {},
      errors: {},
    });
    assert.equal(calls, 0);
  });

  it("classifies live, partial, and unavailable family loads", async () => {
    const live = await loadCatalogSnapshot({ client: catalogClient() });
    assert.equal(live.status, "live");
    assert.equal(Object.keys(live.families).length, FAMILIES.length);

    const partial = await loadCatalogSnapshot({
      client: catalogClient(new Set<ModelFamily>(["embedding-models"])),
    });
    assert.equal(partial.status, "partial");
    assert.match(partial.errors["embedding-models"] ?? "", /unavailable/);

    const unavailable = await loadCatalogSnapshot({
      client: catalogClient(new Set(FAMILIES)),
    });
    assert.equal(unavailable.status, "unavailable");
    assert.equal(Object.keys(unavailable.errors).length, FAMILIES.length);
  });

  it("projects command and endpoint SSOTs into schema v2", async () => {
    const capabilities = await buildCapabilities({ offline: true });
    assert.equal(capabilities.schemaVersion, 2);
    assert.deepEqual(capabilities.commands, COMMAND_MANIFEST);
    assert.deepEqual(capabilities.endpoints, SURFACE_REGISTRY);
    assert.equal(capabilities.auth.file, AUTH_FILE);
    assert.equal(capabilities.webApp.url, "http://127.0.0.1:18646");
    assert.deepEqual(
      capabilities.webApp.surfaces.map((surface) => surface.name),
      ["chat", "voice", "media"],
    );
    for (const surface of capabilities.webApp.surfaces) {
      assert.ok(surface.summary.length > 0, `${surface.name} needs a summary`);
      assert.ok(
        surface.features.length > 0 &&
          surface.features.every((feature) => typeof feature === "string" && feature.length > 0),
        `${surface.name} needs non-empty feature strings`,
      );
    }
    assert.deepEqual(
      capabilities.websockets.map((entry) => entry.path).sort(),
      ["/v1/realtime", "/v1/responses", "/v1/stt", "/v1/tts"],
    );
    assert.equal(capabilities.modelCatalog.status, "offline");
    assert.deepEqual(capabilities.models, []);
    assert.deepEqual(capabilities.voiceModels, []);
    assert.equal(capabilities.recommendations.liveDefaultModel, "grok-voice-latest");
  });

  it("does not retain Voice 1.0 model literals", () => {
    const source = readFileSync("src/commands/capabilities.ts", "utf8");
    assert.doesNotMatch(source, /grok-voice-fast-1\.0/);
    assert.doesNotMatch(source, /grok-voice-think-fast-1\.0/);
  });

  it("prints exactly one JSON document in offline mode", async () => {
    const lines: string[] = [];
    const output = mock.method(console, "log", (value?: unknown) => {
      lines.push(String(value));
    });
    try {
      await capabilitiesCommand().parseAsync([
        "node",
        "progrok",
        "--offline",
        "--json",
      ]);
    } finally {
      output.mock.restore();
    }
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]) as { schemaVersion: number };
    assert.equal(parsed.schemaVersion, 2);
  });

  it("keeps top-level JSON stdout free of the onboarding prompt", () => {
    const testHome = mkdtempSync(join(tmpdir(), "progrok-capabilities-cli-"));
    try {
      const stdout = execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/index.ts",
          "capabilities",
          "--offline",
          "--json",
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, HOME: testHome },
          encoding: "utf8",
        },
      );
      const parsed = JSON.parse(stdout) as { schemaVersion: number };
      assert.equal(parsed.schemaVersion, 2);
      assert.doesNotMatch(stdout, /star the repo/i);
    } finally {
      rmSync(testHome, { recursive: true, force: true });
    }
  });
});
