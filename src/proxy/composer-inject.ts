import { log } from "../utils/logger.js";

/**
 * grok-composer-* models are coding-agent models trained on a proprietary
 * harness (Cursor / Grok Build). Driven through a generic OpenAI client they
 * misbehave in two ways this module corrects, at the proxy front-end:
 *
 *  1. They ignore the caller's tool list and emit their built-in harness tools
 *     instead (StrReplace, run_terminal_cmd, Shell, Grep ...), which the caller
 *     cannot execute — so edits silently fail. We inject a tool-discipline
 *     system instruction so the model uses the caller's exact tools.
 *  2. They reject the reasoning-effort parameter with HTTP 400
 *     ("does not support parameter reasoningEffort"), which fails the whole
 *     request. We strip that parameter for composer requests.
 *  3. When registered as a text-only model in generic clients, attached images
 *     and files may be represented only as paths or text hints. We instruct the
 *     model to use the caller's provided read/inspection tools instead of
 *     analyzing unseen attachment contents from filenames alone.
 *
 * Separately, for ALL grok models (not just composer), this module can inject
 * xAI server-side Agent Tools (web_search / x_search) into the Responses-API
 * tools array, opt-in via PROGROK_INJECT_SEARCH, so generic clients like
 * opencode can use native web/X search.
 *
 * Every transform is fail-safe: on any non-applicable case or parse error the
 * original body is returned untouched and the proxy is never broken. The
 * composer-specific transforms (1-3) never touch non-composer models such as
 * grok-4.3 (which DOES support reasoning effort).
 */

const DISCIPLINE_MARKER = "[progrok:tool-discipline]";

const TOOL_DISCIPLINE =
  `${DISCIPLINE_MARKER} The tools provided in this request are the ONLY tools ` +
  `that exist in this environment. Call them strictly by their exact names and ` +
  `parameter schemas, and never call any tool whose exact name is not in the ` +
  `provided list. Do not fall back to built-in coding-agent harness tools from ` +
  `your own training (e.g. StrReplace, run_terminal_cmd, Shell, Grep) unless ` +
  `that exact name appears in the provided list; use the request's own tools ` +
  `instead — for example, edit files with the provided file-editing tool. ` +
  `If the user asks about an attached file, pasted image, screenshot, or file ` +
  `path and a read/file-inspection tool is available in the provided list, ` +
  `call that provided tool by its exact name before analyzing the content. You ` +
  `cannot see attachment or image contents from a text-only message, path, or ` +
  `filename alone. If no suitable provided tool exists, say you cannot inspect ` +
  `the attachment directly.`;

const INJECT_PATHS = new Set(["/responses", "/chat/completions"]);

function isComposerModel(model: unknown): boolean {
  return typeof model === "string" && model.toLowerCase().includes("composer");
}

function alreadyInjected(text: unknown): boolean {
  return typeof text === "string" && text.includes(DISCIPLINE_MARKER);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Remove the reasoning-effort parameter, which composer models reject (400).
 * Handles both the Chat Completions form (`reasoning_effort`) and the
 * Responses form (`reasoning.effort`). Returns true if anything changed.
 */
function stripReasoningEffort(parsed: Record<string, unknown>): boolean {
  let changed = false;
  if ("reasoning_effort" in parsed) {
    delete parsed["reasoning_effort"];
    changed = true;
  }
  const reasoning = parsed["reasoning"];
  if (isObject(reasoning) && "effort" in reasoning) {
    delete reasoning["effort"];
    changed = true;
    if (Object.keys(reasoning).length === 0) delete parsed["reasoning"];
  }
  return changed;
}

/**
 * Inject the tool-discipline instruction. Only when a non-empty tools array is
 * present and it has not already been injected. Returns true if it injected.
 */
function injectToolDiscipline(
  relPath: string,
  parsed: Record<string, unknown>,
): boolean {
  const tools = parsed["tools"];
  if (!Array.isArray(tools) || tools.length === 0) return false;

  if (relPath === "/responses") {
    const existing = parsed["instructions"];
    if (alreadyInjected(existing)) return false;
    parsed["instructions"] =
      typeof existing === "string" && existing.length > 0
        ? `${existing}\n\n${TOOL_DISCIPLINE}`
        : TOOL_DISCIPLINE;
    return true;
  }

  // /chat/completions — prepend a dedicated system message
  const messages = parsed["messages"];
  if (!Array.isArray(messages)) return false;
  const seen = messages.some((m) =>
    alreadyInjected((m as Record<string, unknown>)?.["content"]),
  );
  if (seen) return false;
  messages.unshift({ role: "system", content: TOOL_DISCIPLINE });
  return true;
}

const SEARCH_ALIASES: Record<string, string> = {
  web: "web_search",
  web_search: "web_search",
  x: "x_search",
  x_search: "x_search",
};

/**
 * Parse the PROGROK_INJECT_SEARCH opt-in toggle into a list of xAI server-side
 * search tool types. Accepts e.g. "web,x", "web_search", "all"/"1"/"true".
 * Returns [] when unset (feature off by default).
 */
function parseSearchToggle(): string[] {
  const raw = (process.env["PROGROK_INJECT_SEARCH"] || "").trim().toLowerCase();
  if (!raw) return [];
  if (raw === "1" || raw === "all" || raw === "true") {
    return ["web_search", "x_search"];
  }
  const out = new Set<string>();
  for (const tok of raw.split(/[,\s]+/).filter(Boolean)) {
    const mapped = SEARCH_ALIASES[tok];
    if (mapped) out.add(mapped);
  }
  return [...out];
}

/**
 * Inject xAI server-side Agent Tools (web_search / x_search) into the tools
 * array so grok models can search through generic clients (e.g. opencode).
 * Responses-API only (Chat Completions rejects these tool types), opt-in via
 * PROGROK_INJECT_SEARCH, skips multi-agent models, and de-dupes by type.
 * Applies to ALL grok models, not just composer. Returns true if it changed.
 */
function injectServerSideSearch(
  relPath: string,
  parsed: Record<string, unknown>,
): boolean {
  if (relPath !== "/responses") return false;
  const wanted = parseSearchToggle();
  if (wanted.length === 0) return false;
  const model = parsed["model"];
  if (typeof model === "string" && model.toLowerCase().includes("multi-agent")) {
    return false;
  }
  let tools = parsed["tools"];
  if (!Array.isArray(tools)) {
    tools = [];
    parsed["tools"] = tools;
  }
  const present = new Set(
    (tools as unknown[]).map((t) => (isObject(t) ? String(t["type"] || "") : "")),
  );
  let changed = false;
  for (const type of wanted) {
    if (!present.has(type)) {
      (tools as unknown[]).push({ type });
      changed = true;
    }
  }
  return changed;
}

/**
 * Returns a (possibly modified) request body for grok requests on the
 * Responses / Chat Completions endpoints:
 *  - server-side search injection (all grok models, opt-in via env, Responses);
 *  - composer-only: strip unsupported reasoning effort + inject tool-discipline.
 * Any other request (wrong path, non-JSON body, parse error) passes through
 * untouched, and the proxy is never broken by a transform edge case.
 */
export function prepareGrokRequest(relPath: string, body: Buffer): Buffer {
  if (!INJECT_PATHS.has(relPath)) return body;
  if (body.length === 0) return body;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  } catch {
    return body; // not JSON — pass through untouched
  }

  try {
    const composerDisabled =
      process.env["PROGROK_DISABLE_COMPOSER_INJECT"] === "1";
    const searched = injectServerSideSearch(relPath, parsed);
    let stripped = false;
    let injected = false;
    if (!composerDisabled && isComposerModel(parsed["model"])) {
      stripped = stripReasoningEffort(parsed);
      injected = injectToolDiscipline(relPath, parsed);
    }
    if (!searched && !stripped && !injected) return body;
    const notes = [
      searched ? "injected server-side search" : "",
      stripped ? "stripped reasoning_effort" : "",
      injected ? "injected tool-discipline" : "",
    ]
      .filter(Boolean)
      .join(", ");
    log.dim(`[progrok] grok request adjusted (${relPath}): ${notes}`);
    return Buffer.from(JSON.stringify(parsed), "utf8");
  } catch (err) {
    // Never break the proxy because of a transform edge case.
    log.dim(`[progrok] grok transform skipped: ${(err as Error).message}`);
    return body;
  }
}
