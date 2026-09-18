import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMMAND_MANIFEST, COMMAND_NAMES } from "../src/commands/command-manifest.js";
import {
  COMMAND_FACTORIES,
  createRegisteredCommands,
} from "../src/commands/command-registry.js";

describe("CLI packaged skill contract", () => {
  it("ships parseable structured frontmatter", () => {
    const skill = readFileSync("skills/progrok/SKILL.md", "utf8");
    const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1];
    assert(frontmatter);
    assert.equal(frontmatter.match(/^name:\s*(.+)$/mu)?.[1]?.trim(), "progrok");
    const description = frontmatter.match(/^description:\s*(.+)$/mu)?.[1]?.trim();
    assert(description && description.length > 0);
    const metadataText = frontmatter.match(/^metadata:\s*\r?\n([\s\S]+)$/mu)?.[1];
    assert(metadataText);
    const metadata = JSON.parse(metadataText) as {
      triggers: string[];
      requires: { bins: string[] };
    };
    assert(metadata.triggers.includes("progrok"));
    assert.deepEqual(metadata.requires.bins, ["progrok"]);
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
