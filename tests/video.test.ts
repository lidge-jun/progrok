import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Command } from "commander";
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

  it("has --ref option for reference-to-video", () => {
    const cmd = videoCommand();
    const opt = cmd.options.find((o: any) => o.long === "--ref");
    assert(opt, "missing --ref option");
  });

  it("has --seconds alias and --upload-url options", () => {
    const cmd = videoCommand();
    assert(cmd.options.find((o: any) => o.long === "--seconds"), "missing --seconds");
    assert(cmd.options.find((o: any) => o.long === "--upload-url"), "missing --upload-url");
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

  it("edit and extend accept video input plus upload-url", () => {
    const cmd = videoCommand();
    const edit = cmd.commands.find((c) => c.name() === "edit");
    const extend = cmd.commands.find((c) => c.name() === "extend");

    assert(edit, "missing edit subcommand");
    assert(extend, "missing extend subcommand");
    assert(edit.options.find((o: any) => o.long === "--video"), "edit missing --video");
    assert(edit.options.find((o: any) => o.long === "--upload-url"), "edit missing --upload-url");
    assert(extend.options.find((o: any) => o.long === "--video"), "extend missing --video");
    assert(extend.options.find((o: any) => o.long === "--upload-url"), "extend missing --upload-url");
  });

  it("parses edit/extend options after the prompt", () => {
    const cmd = videoCommand();
    const extend = cmd.commands.find((c) => c.name() === "extend");
    assert(extend, "missing extend subcommand");

    let parsed: any;
    extend.action((prompt, opts) => { parsed = { prompt, opts }; });
    cmd.parse(["node", "progrok", "extend", "continue", "--video", "file_id:file-123", "--duration", "2", "--json"]);

    assert.equal(parsed.prompt, "continue");
    assert.equal(parsed.opts.video, "file_id:file-123");
    assert.equal(parsed.opts.duration, "2");
    assert.equal(parsed.opts.json, true);
  });

  it("keeps subcommand options local under the top-level program", () => {
    const program = new Command();
    program.enablePositionalOptions();
    const cmd = videoCommand();
    program.addCommand(cmd);
    const edit = cmd.commands.find((c) => c.name() === "edit");
    assert(edit, "missing edit subcommand");

    let parsed: any;
    edit.action((prompt, opts) => { parsed = { prompt, opts }; });
    program.parse(["node", "progrok", "video", "edit", "touch up", "--video", "file_id:file-123", "--json"]);

    assert.equal(parsed.prompt, "touch up");
    assert.equal(parsed.opts.video, "file_id:file-123");
    assert.equal(parsed.opts.json, true);
  });
});
