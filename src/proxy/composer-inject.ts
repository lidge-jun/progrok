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
 *
 * Both are fail-safe: on any non-applicable case or parse error the original
 * body is returned untouched and the proxy is never broken. Non-composer
 * models (e.g. grok-4.3, which DOES support reasoning effort) are never
 * touched.
 */

const DISCIPLINE_MARKER = "[progrok:tool-discipline]";

const TOOL_DISCIPLINE =
  `${DISCIPLINE_MARKER} The tools provided in this request are the ONLY tools ` +
  `that exist in this environment. Call them strictly by their exact names and ` +
  `parameter schemas, and never call any tool whose exact name is not in the ` +
  `provided list. Do not fall back to built-in coding-agent harness tools from ` +
  `your own training (e.g. StrReplace, run_terminal_cmd, Shell, Grep) unless ` +
  `that exact name appears in the provided list; use the request's own tools ` +
  `instead — for example, edit files with the provided file-editing tool.`;

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

/**
 * Returns a (possibly modified) request body for composer requests on the
 * Responses / Chat Completions endpoints. Strips the unsupported reasoning
 * effort parameter and injects the tool-discipline instruction. Any other
 * request (wrong path, non-composer model, non-JSON body, parse error) passes
 * through untouched.
 */
export function prepareComposerRequest(relPath: string, body: Buffer): Buffer {
  if (process.env["PROGROK_DISABLE_COMPOSER_INJECT"] === "1") return body;
  if (!INJECT_PATHS.has(relPath)) return body;
  if (body.length === 0) return body;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  } catch {
    return body; // not JSON — pass through untouched
  }

  try {
    if (!isComposerModel(parsed["model"])) return body;
    const stripped = stripReasoningEffort(parsed);
    const injected = injectToolDiscipline(relPath, parsed);
    if (!stripped && !injected) return body;
    const notes = [
      stripped ? "stripped reasoning_effort" : "",
      injected ? "injected tool-discipline" : "",
    ]
      .filter(Boolean)
      .join(", ");
    log.dim(`[progrok] composer request adjusted (${relPath}): ${notes}`);
    return Buffer.from(JSON.stringify(parsed), "utf8");
  } catch (err) {
    // Never break the proxy because of a transform edge case.
    log.dim(`[progrok] composer transform skipped: ${(err as Error).message}`);
    return body;
  }
}
