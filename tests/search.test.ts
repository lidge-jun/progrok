import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchRequestBody,
  buildSearchTools,
  extractSearchResult,
  SEARCH_CITATION_INSTRUCTIONS,
  searchCommand,
} from "../src/commands/search.js";

describe("buildSearchRequestBody", () => {
  it("includes citation instructions and web+x tools by default", () => {
    const body = buildSearchRequestBody("test query", { model: "grok-4.20-multi-agent-0309" });
    assert.equal(body.instructions, SEARCH_CITATION_INSTRUCTIONS);
    assert.deepEqual(body.tools, [{ type: "web_search" }, { type: "x_search" }]);
    assert.match(body.instructions, /\[\[n\]\]\(full_url\)/);
    assert.equal(body.reasoning?.effort, "high");
  });

  it("maps --web only to web_search tool", () => {
    const body = buildSearchRequestBody("q", { model: "grok-4.20-multi-agent-0309", web: true });
    assert.deepEqual(body.tools, [{ type: "web_search" }]);
  });
});

describe("buildSearchTools", () => {
  it("defaults to both web and x when no flags", () => {
    const tools = buildSearchTools({});
    assert.deepEqual(
      tools.map((t) => t.type),
      ["web_search", "x_search"],
    );
  });

  it("restricts to web when --web", () => {
    assert.deepEqual(buildSearchTools({ web: true }), [{ type: "web_search" }]);
  });

  it("restricts to x when --x", () => {
    assert.deepEqual(buildSearchTools({ x: true }), [{ type: "x_search" }]);
  });

  it("includes both when both flags set", () => {
    assert.deepEqual(
      buildSearchTools({ web: true, x: true }).map((t) => t.type),
      ["web_search", "x_search"],
    );
  });
});

describe("extractSearchResult", () => {
  // Shape captured from a live /v1/responses call (web_search tool).
  const live = {
    output: [
      { type: "reasoning" },
      {
        type: "web_search_call",
        action: { type: "search", query: "latest Node.js LTS version" },
      },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "The latest stable Node.js LTS version is 24.16.0.[[1]](https://nodejs.org/en)[[2]](https://endoflife.date/nodejs)",
            annotations: [
              { type: "url_citation", url: "https://nodejs.org/en", title: "1" },
              { type: "url_citation", url: "https://endoflife.date/nodejs", title: "2" },
            ],
          },
        ],
      },
    ],
    usage: {
      num_sources_used: 0,
      server_side_tool_usage_details: { web_search_calls: 1, x_search_calls: 0 },
    },
  };

  it("extracts the answer text", () => {
    const r = extractSearchResult(live);
    assert.match(r.answer, /Node\.js LTS version is 24\.16\.0/);
  });

  it("collects deduplicated url citations", () => {
    const r = extractSearchResult(live);
    assert.equal(r.citations.length, 2);
    assert.equal(r.citations[0].url, "https://nodejs.org/en");
  });

  it("captures the search query", () => {
    const r = extractSearchResult(live);
    assert.deepEqual(r.queries, ["latest Node.js LTS version"]);
  });

  it("passes through usage", () => {
    const r = extractSearchResult(live);
    assert.equal(r.usage?.server_side_tool_usage_details?.web_search_calls, 1);
  });

  it("handles empty/malformed output safely", () => {
    const r = extractSearchResult({});
    assert.equal(r.answer, "");
    assert.deepEqual(r.citations, []);
    assert.deepEqual(r.queries, []);
  });

  it("dedupes repeated citation urls", () => {
    const r = extractSearchResult({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "x",
              annotations: [
                { type: "url_citation", url: "https://a.com", title: "1" },
                { type: "url_citation", url: "https://a.com", title: "1" },
              ],
            },
          ],
        },
      ],
    });
    assert.equal(r.citations.length, 1);
  });
});

describe("SearchOptions.reasoning validation", () => {
  it("has --reasoning option registered", () => {
    const cmd = searchCommand();
    const opts = cmd.options.map((o: any) => o.long);
    assert(opts.includes("--reasoning"), "missing --reasoning option");
  });

  it("--reasoning option description mentions effort", () => {
    const cmd = searchCommand();
    const opt = cmd.options.find((o: any) => o.long === "--reasoning");
    assert(opt, "--reasoning option not found");
    assert.match(opt.description, /effort/);
  });
});
