import { Command } from "commander";
import { getValidBearer } from "../auth/token-store.js";
import {
  XAI_API_BASE_URL,
  SEARCH_DEFAULT_MODEL,
  SEARCH_DEFAULT_REASONING,
} from "../auth/constants.js";
import { log } from "../utils/logger.js";

export interface SearchOptions {
  web?: boolean;
  x?: boolean;
  json?: boolean;
  model?: string;
  reasoning?: string;
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

/** System instructions sent on every search /v1/responses call (citation contract). */
export const SEARCH_CITATION_INSTRUCTIONS = [
  "You are a research assistant answering from web_search and x_search results.",
  "Citation contract (strict):",
  "- Target at least 30 distinct url_citation annotations when the user asks to explore communities (Reddit, X/Twitter, forums) or wants broad coverage.",
  "- Run multiple searches with varied queries; open many threads/posts, not one summary page.",
  "- Every factual bullet or claim must have its own [[n]](full_url) inline marker matching annotations.",
  "- Prefer primary threads on reddit.com and posts on x.com/twitter.com when the topic is social discussion.",
  "- Do not compress many sources into uncited prose; more citations is better than a short essay.",
  "- Also cite official docs when relevant, but do not stop at 2–5 links if more sources exist.",
  "- If fewer than 30 distinct URLs exist in search results, say so and cite everything found.",
].join("\n");

export interface SearchRequestBody {
  model: string;
  input: string;
  tools: ResponsesTool[];
  stream: false;
  instructions: string;
  reasoning?: { effort: string };
}

export function buildSearchRequestBody(
  query: string,
  opts: SearchOptions & { model: string },
): SearchRequestBody {
  const body: SearchRequestBody = {
    model: opts.model,
    input: query,
    tools: buildSearchTools(opts),
    stream: false,
    instructions: SEARCH_CITATION_INSTRUCTIONS,
  };
  const effort = opts.reasoning ?? SEARCH_DEFAULT_REASONING;
  body.reasoning = { effort };
  return body;
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
    .option("--model <id>", "model to use", SEARCH_DEFAULT_MODEL)
    .option(
      "--reasoning <effort>",
      "reasoning effort: none|low|medium|high|xhigh (xhigh = multi-agent 16)",
    )
    .action(async (query: string, opts: SearchOptions) => {
      try {
        const VALID_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);
        if (opts.reasoning && !VALID_EFFORTS.has(opts.reasoning)) {
          throw new Error(
            `invalid --reasoning '${opts.reasoning}'. use: none|low|medium|high|xhigh`,
          );
        }
        const bearer = await getValidBearer();
        const requestBody = buildSearchRequestBody(query, {
          ...opts,
          model: opts.model ?? SEARCH_DEFAULT_MODEL,
        });

        const res = await fetch(`${XAI_API_BASE_URL}/responses`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
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
            const label =
              c.title && !/^\d+$/.test(c.title.trim()) ? c.title.trim() : c.url;
            console.log(`  [${i + 1}] ${label}`);
            console.log(`      ${c.url}`);
          });
          log.dim("\nMarkdown (for chat replies):");
          for (const c of result.citations) {
            let label = c.title?.trim() || "";
            if (!label || /^\d+$/.test(label)) {
              try {
                label = new URL(c.url).hostname;
              } catch {
                label = c.url;
              }
            }
            console.log(`- [${label}](${c.url})`);
          }
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
