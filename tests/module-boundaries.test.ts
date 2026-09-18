import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Layer edges observed on 2026-09-19. Anything outside this map is a regression:
 * either the import is genuinely new and belongs here, or it is a shortcut that
 * should go through an existing layer.
 */
const ALLOWED: Record<string, string[]> = {
  auth: ["utils"],
  utils: ["auth"], // known cycle: auth/constants.ts is a pure constants module
  transport: ["auth", "utils"],
  wire: ["core"],
  surfaces: ["transport", "core", "wire", "auth"],
  proxy: ["core", "wire", "utils", "auth", "transport"],
  voice: ["transport", "utils", "auth"],
  web: ["utils", "proxy", "auth", "voice", "core"],
  chat: ["auth", "web"],
  commands: ["auth", "chat", "proxy", "surfaces", "transport", "utils", "voice"],
  core: [],
};

const SRC = "src";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

function layerOf(path: string): string | undefined {
  const parts = path.split("/");
  return parts[0] === SRC && parts.length > 2 ? parts[1] : undefined;
}

function importedLayers(path: string, source: string): string[] {
  const depth = path.split("/").length - 2;
  const found = new Set<string>();
  for (const match of source.matchAll(/from\s+"((?:\.\.\/)+[^"]+)"/g)) {
    const spec = match[1];
    const ups = (spec.match(/\.\.\//g) ?? []).length;
    if (ups !== depth) continue;
    const rest = spec.replace(/(\.\.\/)+/, "");
    const layer = rest.split("/")[0].replace(/\.js$/, "");
    if (layer in ALLOWED) found.add(layer);
  }
  return [...found];
}

describe("module boundaries", () => {
  it("keeps the voice websocket facade exporting transport, STT and TTS", async () => {
    const mod = await import("../src/voice/ws-client.js");
    for (const name of [
      "openVoiceSocket",
      "createSttSession",
      "createTtsSession",
      "ephemeralProtocols",
      "reduceSttEvent",
    ]) {
      assert.equal(typeof (mod as Record<string, unknown>)[name], "function", `${name} must stay exported`);
    }
  });

  it("keeps the browser voice client surface importable", () => {
    const source = readFileSync("src/web/client/voice.ts", "utf8");
    assert.match(source, /export class VoiceController/);
    assert.match(source, /export \{\s*buildVoiceSocketSpec/);
  });

  it("does not let the voice sessions import the facade back", () => {
    for (const file of ["src/voice/stt-session.ts", "src/voice/tts-session.ts"]) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /from "\.\/ws-client\.js"/, `${file} would create a cycle`);
    }
  });

  it("holds the layer dependency direction", () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const from = layerOf(file);
      if (!from || !(from in ALLOWED)) continue;
      for (const to of importedLayers(file, readFileSync(file, "utf8"))) {
        if (to !== from && !ALLOWED[from].includes(to)) {
          violations.push(`${file}: ${from} -> ${to}`);
        }
      }
    }
    assert.deepEqual(violations, [], "new cross-layer edge; add it to ALLOWED or route through an existing layer");
  });
});

