import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMMAND_MANIFEST, COMMAND_NAMES } from "../src/commands/command-manifest.js";
import {
  COMMAND_FACTORIES,
  createRegisteredCommands,
} from "../src/commands/command-registry.js";

function readSource(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("CLI packaged skill contract", () => {
  it("ships a Markdown skill at skills/progrok/SKILL.md", () => {
    const skill = readSource("skills/progrok/SKILL.md");

    assert.match(skill, /name:\s*progrok/);
    assert.match(skill, /progrok login/);
    assert.match(skill, /progrok search/);
    assert.match(skill, /progrok proxy/);
    assert.match(skill, /progrok capabilities/);
    assert.match(skill, /\/v1\/responses/);
    assert.match(skill, /\/v1\/chat\/completions/);
    assert.match(skill, /grok-4\.3/);
    assert.match(skill, /web_search/);
    assert.match(skill, /x_search/);
  });

  it("skill command reads from file instead of hardcoding", () => {
    const src = readSource("src/commands/skill.ts");

    assert.match(
      src,
      /SKILL_PATH = join\(ROOT, "skills", "progrok", "SKILL\.md"\)/,
    );
    assert.match(src, /format:\s*"markdown-skill"/);
    assert.match(src, /formatVersion:\s*"1"/);
    assert.match(src, /packageVersion: readPackageVersion\(\)/);
    assert.match(src, /readSkill\(\)/);
  });

  it("capabilities command exposes dynamic metadata", () => {
    const src = readSource("src/commands/capabilities.ts");

    assert.match(src, /buildCapabilities/);
    assert.match(src, /endpoints/);
    assert.match(src, /models/);
    assert.match(src, /tools/);
    assert.match(src, /guidance/);
    assert.match(src, /proxy/);
  });

  it("keeps manifest, factories, and Commander registration in exact parity", () => {
    assert.deepEqual(Object.keys(COMMAND_FACTORIES), [...COMMAND_NAMES]);
    assert.deepEqual(COMMAND_MANIFEST.map((entry) => entry.name), [...COMMAND_NAMES]);
    assert.deepEqual(
      createRegisteredCommands().map((command) => command.name()),
      [...COMMAND_NAMES],
    );
  });

  it("includes the voice commands", () => {
    assert(COMMAND_NAMES.includes("tts"));
    assert(COMMAND_NAMES.includes("stt"));
    assert(COMMAND_NAMES.includes("live"));
  });
});
