import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { videoCommand } from "../src/commands/video.js";

describe("videoCommand", () => {
  it("registers as 'video' command", () => {
    const cmd = videoCommand();
    assert.equal(cmd.name(), "video");
  });

  it("has --model option with default grok-imagine-video", () => {
    const cmd = videoCommand();
    const opt = cmd.options.find((o: any) => o.long === "--model");
    assert(opt, "missing --model option");
    assert.equal(opt.defaultValue, "grok-imagine-video");
  });

  it("has --duration option with default 5", () => {
    const cmd = videoCommand();
    const opt = cmd.options.find((o: any) => o.long === "--duration");
    assert(opt, "missing --duration option");
    assert.equal(opt.defaultValue, "5");
  });

  it("has --aspect option with default 16:9", () => {
    const cmd = videoCommand();
    const opt = cmd.options.find((o: any) => o.long === "--aspect");
    assert(opt, "missing --aspect option");
    assert.equal(opt.defaultValue, "16:9");
  });

  it("has --resolution option with default 480p", () => {
    const cmd = videoCommand();
    const opt = cmd.options.find((o: any) => o.long === "--resolution");
    assert(opt, "missing --resolution option");
    assert.equal(opt.defaultValue, "480p");
  });

  it("has --image option for I2V", () => {
    const cmd = videoCommand();
    const opt = cmd.options.find((o: any) => o.long === "--image");
    assert(opt, "missing --image option");
  });

  it("has --timeout option with default 600", () => {
    const cmd = videoCommand();
    const opt = cmd.options.find((o: any) => o.long === "--timeout");
    assert(opt, "missing --timeout option");
    assert.equal(opt.defaultValue, "600");
  });

  it("has --json and --output options", () => {
    const cmd = videoCommand();
    assert(cmd.options.find((o: any) => o.long === "--json"), "missing --json");
    assert(cmd.options.find((o: any) => o.long === "--output"), "missing --output");
  });
});
