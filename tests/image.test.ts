import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { imageCommand } from "../src/commands/image.js";

describe("imageCommand", () => {
  it("registers as 'image' command", () => {
    const cmd = imageCommand();
    assert.equal(cmd.name(), "image");
  });

  it("has --model option with default grok-imagine-image", () => {
    const cmd = imageCommand();
    const opt = cmd.options.find((o: any) => o.long === "--model");
    assert(opt, "missing --model option");
    assert.equal(opt.defaultValue, "grok-imagine-image");
  });

  it("has --aspect option with default 1:1", () => {
    const cmd = imageCommand();
    const opt = cmd.options.find((o: any) => o.long === "--aspect");
    assert(opt, "missing --aspect option");
    assert.equal(opt.defaultValue, "1:1");
  });

  it("has --resolution option with default 1k", () => {
    const cmd = imageCommand();
    const opt = cmd.options.find((o: any) => o.long === "--resolution");
    assert(opt, "missing --resolution option");
    assert.equal(opt.defaultValue, "1k");
  });

  it("has --ref option (repeatable)", () => {
    const cmd = imageCommand();
    const opt = cmd.options.find((o: any) => o.long === "--ref");
    assert(opt, "missing --ref option");
  });

  it("has --n option with default 1", () => {
    const cmd = imageCommand();
    const opt = cmd.options.find((o: any) => o.long === "--n");
    assert(opt, "missing --n option");
    assert.equal(opt.defaultValue, "1");
  });

  it("has --json and --output options", () => {
    const cmd = imageCommand();
    assert(cmd.options.find((o: any) => o.long === "--json"), "missing --json");
    assert(cmd.options.find((o: any) => o.long === "--output"), "missing --output");
  });
});
