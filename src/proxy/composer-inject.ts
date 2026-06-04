import { log } from "../utils/logger.js";

/**
 * grok-composer-* models are coding-agent models trained on a proprietary
 * harness (Cursor / Grok Build). When driven through a generic OpenAI client
 * they ignore the caller's tool list and emit their built-in tools instead
 * (StrReplace, Shell, Grep, run_terminal_cmd, Read, Write ...), which the
 * caller cannot execute — so edits silently fail or the model spirals.
 *
 * This module injects a tool-discipline system instruction for composer
 * requests so the model uses the caller's exact tool names/schemas.
 * It is a fail-safe transform: on any non-applicable case or parse error it
 * returns the original body untouched and never breaks the proxy.
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

/**
 * Returns a (possibly modified) request body. Only touches POST bodies for
 * the Responses / Chat Completions endpoints when the target model is a
 * composer model and the request actually carries a non-empty tools array.
 */
export function injectComposerToolDiscipline(
  relPath: string,
  body: Buffer,
): Buffer {
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
    const tools = parsed["tools"];
    if (!Array.isArray(tools) || tools.length === 0) return body;

    if (relPath === "/responses") {
      const existing = parsed["instructions"];
      if (alreadyInjected(existing)) return body;
      parsed["instructions"] =
        typeof existing === "string" && existing.length > 0
          ? `${existing}\n\n${TOOL_DISCIPLINE}`
          : TOOL_DISCIPLINE;
    } else {
      // /chat/completions — prepend a dedicated system message
      const messages = parsed["messages"];
      if (!Array.isArray(messages)) return body;
      const seen = messages.some((m) =>
        alreadyInjected((m as Record<string, unknown>)?.["content"]),
      );
      if (seen) return body;
      messages.unshift({ role: "system", content: TOOL_DISCIPLINE });
    }

    const out = Buffer.from(JSON.stringify(parsed), "utf8");
    log.dim(`[progrok] composer tool-discipline injected (${relPath})`);
    return out;
  } catch (err) {
    // Never break the proxy because of an injection edge case.
    log.dim(`[progrok] composer inject skipped: ${(err as Error).message}`);
    return body;
  }
}
