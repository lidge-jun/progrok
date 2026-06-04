import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prepareComposerRequest } from "../src/proxy/composer-inject.js";

const MARKER = "[progrok:tool-discipline]";

function buf(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj), "utf8");
}
function parse(b: Buffer): Record<string, unknown> {
  return JSON.parse(b.toString("utf8")) as Record<string, unknown>;
}

const TOOLS = [
  {
    type: "function",
    name: "edit",
    parameters: { type: "object", properties: { filePath: { type: "string" } } },
  },
];

describe("prepareComposerRequest", () => {
  it("injects instructions for composer /responses with tools", () => {
    const out = prepareComposerRequest(
      "/responses",
      buf({ model: "grok-composer-2.5-fast", input: [], tools: TOOLS }),
    );
    const parsed = parse(out);
    assert.equal(typeof parsed["instructions"], "string");
    assert.ok(String(parsed["instructions"]).includes(MARKER));
    // tools must be preserved untouched
    assert.deepEqual(parsed["tools"], TOOLS);
  });

  it("appends to existing instructions, preserving the original prompt", () => {
    const out = prepareComposerRequest(
      "/responses",
      buf({
        model: "grok-composer-2.5-fast",
        instructions: "ORIGINAL SYSTEM PROMPT",
        input: [],
        tools: TOOLS,
      }),
    );
    const instr = String(parse(out)["instructions"]);
    assert.ok(instr.startsWith("ORIGINAL SYSTEM PROMPT"));
    assert.ok(instr.includes(MARKER));
  });

  it("is idempotent — does not double-inject", () => {
    const once = prepareComposerRequest(
      "/responses",
      buf({ model: "grok-composer-2.5-fast", input: [], tools: TOOLS }),
    );
    const twice = prepareComposerRequest("/responses", once);
    const occurrences = String(parse(twice)["instructions"]).split(MARKER).length - 1;
    assert.equal(occurrences, 1);
  });

  it("prepends a system message for composer /chat/completions", () => {
    const out = prepareComposerRequest(
      "/chat/completions",
      buf({
        model: "grok-composer-2.5-fast",
        messages: [{ role: "user", content: "hi" }],
        tools: TOOLS,
      }),
    );
    const msgs = parse(out)["messages"] as Array<Record<string, unknown>>;
    assert.equal(msgs[0]["role"], "system");
    assert.ok(String(msgs[0]["content"]).includes(MARKER));
    assert.equal(msgs[1]["role"], "user");
  });

  it("leaves non-composer models untouched", () => {
    const original = buf({ model: "grok-4.3", input: [], tools: TOOLS });
    const out = prepareComposerRequest("/responses", original);
    assert.equal(out.toString("utf8"), original.toString("utf8"));
  });

  it("leaves composer requests without tools untouched", () => {
    const original = buf({ model: "grok-composer-2.5-fast", input: [] });
    const out = prepareComposerRequest("/responses", original);
    assert.equal(out.toString("utf8"), original.toString("utf8"));
  });

  it("ignores non-inject paths", () => {
    const original = buf({ model: "grok-composer-2.5-fast", tools: TOOLS });
    const out = prepareComposerRequest("/models", original);
    assert.equal(out.toString("utf8"), original.toString("utf8"));
  });

  it("passes through non-JSON bodies safely", () => {
    const original = Buffer.from("not json at all", "utf8");
    const out = prepareComposerRequest("/responses", original);
    assert.equal(out.toString("utf8"), "not json at all");
  });

  it("respects the PROGROK_DISABLE_COMPOSER_INJECT opt-out", () => {
    process.env["PROGROK_DISABLE_COMPOSER_INJECT"] = "1";
    try {
      const original = buf({ model: "grok-composer-2.5-fast", input: [], tools: TOOLS });
      const out = prepareComposerRequest("/responses", original);
      assert.equal(out.toString("utf8"), original.toString("utf8"));
    } finally {
      delete process.env["PROGROK_DISABLE_COMPOSER_INJECT"];
    }
  });

  it("strips chat reasoning_effort for composer (unsupported -> would 400)", () => {
    const out = prepareComposerRequest(
      "/chat/completions",
      buf({
        model: "grok-composer-2.5-fast",
        reasoning_effort: "high",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    assert.equal("reasoning_effort" in parse(out), false);
  });

  it("strips responses reasoning.effort and drops an emptied reasoning object", () => {
    const out = prepareComposerRequest(
      "/responses",
      buf({
        model: "grok-composer-2.5-fast",
        reasoning: { effort: "low" },
        input: [],
      }),
    );
    assert.equal("reasoning" in parse(out), false);
  });

  it("keeps other reasoning fields while stripping effort", () => {
    const out = prepareComposerRequest(
      "/responses",
      buf({
        model: "grok-composer-2.5-fast",
        reasoning: { effort: "low", summary: "auto" },
        input: [],
      }),
    );
    const reasoning = parse(out)["reasoning"] as Record<string, unknown>;
    assert.deepEqual(reasoning, { summary: "auto" });
  });

  it("does NOT strip reasoning_effort for non-composer models", () => {
    const original = buf({
      model: "grok-4.3",
      reasoning_effort: "high",
      messages: [{ role: "user", content: "hi" }],
    });
    const out = prepareComposerRequest("/chat/completions", original);
    assert.equal(out.toString("utf8"), original.toString("utf8"));
  });

  it("strips effort for composer even without a tools array", () => {
    const out = prepareComposerRequest(
      "/responses",
      buf({ model: "grok-composer-2.5-fast", reasoning: { effort: "high" }, input: [] }),
    );
    assert.equal("reasoning" in parse(out), false);
  });
});
