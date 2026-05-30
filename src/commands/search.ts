import { Command } from "commander";
import { getValidBearer } from "../auth/token-store.js";
import { XAI_API_BASE_URL, DEFAULT_MODEL } from "../auth/constants.js";
import { log } from "../utils/logger.js";

export interface SearchOptions {
  web?: boolean;
  x?: boolean;
  json?: boolean;
  model?: string;
}

interface ResponsesTool {
  type: "web_search" | "x_search";
}

/**
 * Default behaviour: search both web and X. If either --web or --x is given,
 * restrict to only the requested source(s).
 */
export function buildSearchTools(opts: { web?: boolean; x?: boolean }): ResponsesTool[] {
  const explicit = Boolean(opts.web || opts.x);
  const useWeb = explicit ? Boolean(opts.web) : true;
  const useX = explicit ? Boolean(opts.x) : true;
  const tools: ResponsesTool[] = [];
  if (useWeb) tools.push({ type: "web_search" });
  if (useX) tools.push({ type: "x_search" });
  return tools;
}

interface Annotation {
  type?: string;
  url?: string;
  title?: string;
}
interface OutputTextContent {
  type?: string;
  text?: string;
  annotations?: Annotation[];
}
interface OutputItem {
  type?: string;
  content?: OutputTextContent[];
  action?: { type?: string; query?: string };
}
interface ResponsesUsage {
  num_sources_used?: number;
  cost_in_usd_ticks?: number;
  server_side_tool_usage_details?: Record<string, number>;
}
interface ResponsesData {
  output?: OutputItem[];
  usage?: ResponsesUsage;
}

export interface SearchResult {
  answer: string;
  citations: { url: string; title: string }[];
  queries: string[];
  usage?: ResponsesUsage;
}

/** Parse the /v1/responses output array into a flat search result. */
export function extractSearchResult(data: ResponsesData): SearchResult {
  const citations: { url: string; title: string }[] = [];
  const queries: string[] = [];
  const seen = new Set<string>();
  let answer = "";

  for (const item of data.output ?? []) {
    if (item.type === "message") {
      for (const c of item.content ?? []) {
        if (c.type === "output_text" && c.text) {
          answer += c.text;
          for (const a of c.annotations ?? []) {
            if (a.type === "url_citation" && a.url && !seen.has(a.url)) {
              seen.add(a.url);
              citations.push({ url: a.url, title: a.title ?? "" });
            }
          }
        }
      }
    } else if (
      (item.type === "web_search_call" || item.type === "x_search_call") &&
      item.action?.query
    ) {
      queries.push(item.action.query);
    }
  }

  return { answer: answer.trim(), citations, queries, usage: data.usage };
}

export function searchCommand(): Command {
  return new Command("search")
    .description("Search the web and X with Grok — AI summary + citations (no API key)")
    .argument("<query>", "what to search for")
    .option("--web", "web search only (default: web + X)")
    .option("--x", "X (Twitter) search only")
    .option("--json", "output structured JSON")
    .option("--model <id>", "model to use", DEFAULT_MODEL)
    .action(async (query: string, opts: SearchOptions) => {
      try {
        const tools = buildSearchTools(opts);
        const bearer = await getValidBearer();

        const res = await fetch(`${XAI_API_BASE_URL}/responses`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: opts.model ?? DEFAULT_MODEL,
            input: query,
            tools,
            stream: false,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
        }

        const result = extractSearchResult((await res.json()) as ResponsesData);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        log.bold(`\nSearch: ${query}\n`);
        console.log(result.answer || "(no answer returned)");

        if (result.citations.length > 0) {
          log.dim("\nSources:");
          result.citations.forEach((c, i) => {
            console.log(`  [${i + 1}] ${c.url}`);
          });
        }

        const d = result.usage?.server_side_tool_usage_details;
        if (d) {
          log.dim(
            `\n(${d.web_search_calls ?? 0} web · ${d.x_search_calls ?? 0} X searches)`,
          );
        }
      } catch (err) {
        log.error((err as Error).message);
        process.exit(1);
      }
    });
}
