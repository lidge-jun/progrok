import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { imageCommand, imageExtension } from "../src/commands/image.js";

/** Minimal shape of a Commander Option for test assertions. */
interface CliOption { long?: string; defaultValue?: unknown; }

describe("imageCommand", () => {
  it("registers as 'image' command", () => {
    const cmd = imageCommand();
    assert.equal(cmd.name(), "image");
  });

  it("has --model option with default grok-imagine-image", () => {
    const cmd = imageCommand();
    const opt = cmd.options.find((o: CliOption) => o.long === "--model");
    assert(opt, "missing --model option");
    assert.equal(opt.defaultValue, "grok-imagine-image-2.0");
  });

  it("has --aspect option with default 1:1", () => {
    const cmd = imageCommand();
    const opt = cmd.options.find((o: CliOption) => o.long === "--aspect");
    assert(opt, "missing --aspect option");
    assert.equal(opt.defaultValue, "1:1");
  });

  it("has --resolution option with default 1k", () => {
    const cmd = imageCommand();
    const opt = cmd.options.find((o: CliOption) => o.long === "--resolution");
    assert(opt, "missing --resolution option");
    assert.equal(opt.defaultValue, "1k");
  });

  it("has --ref option (repeatable)", () => {
    const cmd = imageCommand();
    const opt = cmd.options.find((o: CliOption) => o.long === "--ref");
    assert(opt, "missing --ref option");
  });

  it("has --n option with default 1", () => {
    const cmd = imageCommand();
    const opt = cmd.options.find((o: CliOption) => o.long === "--n");
    assert(opt, "missing --n option");
    assert.equal(opt.defaultValue, "1");
  });

  it("has --json and --output options", () => {
    const cmd = imageCommand();
    assert(cmd.options.find((o: CliOption) => o.long === "--json"), "missing --json");
    assert(cmd.options.find((o: CliOption) => o.long === "--output"), "missing --output");
  });
});

it("supports quality and detects image formats", () => {
 const quality = imageCommand().options.find(o => o.long === "--quality");
 assert.ok(quality); assert.equal(quality.defaultValue, undefined);
 assert.equal(imageExtension({mime_type:"image/jpeg"}, Buffer.alloc(0)), "jpg");
 assert.equal(imageExtension({}, Buffer.from("89504e470d0a1a0a", "hex")), "png");
 assert.equal(imageExtension({}, Buffer.from("unknown")), "jpg");
});
