# Composer Tool-Discipline Injection (proxy front-end)

Date: 2026-06-04

## Problem

`grok-composer-2.5-fast` driven through opencode (and any generic OpenAI client)
failed at file edits: tool calls were invisible and edits never applied. The
agent loop would hang or spiral.

Root cause (verified by direct `/v1/responses` probing through the proxy):
composer is a coding-agent model trained on a **proprietary harness**
(Cursor / Grok Build). It ignores the caller's tool list and emits its own
built-in tools instead — observed names: `StrReplace` (path/old_string/new_string),
`Shell` (command/block_until_ms), `run_terminal_cmd`, `Grep` (pattern/glob),
`Read`, `Write`. It even hallucinated other users' absolute file paths
(`c:\Users\...\DroneSim.py`, `/Users/liangchen/.../app.py`). The caller
(opencode) only has handlers for its own tool names (`edit`, `read`, `bash`,
`write`...), so composer's calls were never executed → edits failed.

`grok-4.3` on the identical proxy path worked perfectly — confirming the proxy,
OAuth session, and infra are fine; the issue is model-specific.

## Fix

The proxy now injects a **tool-discipline system instruction** for composer
requests (`src/proxy/composer-inject.ts`):

- Scope: only `POST /v1/responses` and `POST /v1/chat/completions`, only when
  `model` contains `composer`, only when a non-empty `tools` array is present.
- Responses API: appends the discipline to `instructions` (preserves the
  caller's existing system prompt).
- Chat Completions: prepends a dedicated `system` message.
- Fail-safe: non-JSON bodies, non-composer models, missing tools, and any parse
  error pass through untouched. Idempotent (marker guard). Opt-out via
  `PROGROK_DISABLE_COMPOSER_INJECT=1`.

The instruction tells the model to use ONLY the provided tools by their exact
names/parameter keys and to never invent StrReplace/Shell/Grep/run_terminal_cmd/
apply_patch etc.

## Verification

- Direct probe: with injection, composer emits a clean
  `edit{filePath, oldString, newString}` for the caller's file (no spiral, no
  leaked paths).
- Unit tests: `tests/composer-inject.test.ts` — 9/9 pass.
- Regression: `tests/proxy.test.ts` — 4/4 pass. `tsc --noEmit` clean.
- End-to-end opencode (progrok provider on `@ai-sdk/openai` → Responses API,
  proxy on launchd port 18645): composer EDIT tasks **3/3 succeed** — file
  modified, tools `read`+`edit` complete, 7-10s, no hang.

## Update — reasoning-effort strip

Composer also **rejects the reasoning-effort parameter** with HTTP 400
(`Model grok-composer-2.5-fast does not support parameter reasoningEffort`),
on both `reasoning_effort` (Chat Completions) and `reasoning.effort`
(Responses). Verified: `grok-4.3` accepts it (200); composer does not.

The same proxy transform (`prepareComposerRequest`) now strips that parameter
for composer requests so a stray effort/variant no longer fails the whole
request. Non-composer models keep their effort untouched. Verified live:
composer + effort → 200 (was 400); grok-4.3 + effort → 200 (preserved).

Implication: do not set an opencode `--variant`/effort for composer; its model
config carries no `variants`, so the default path is already safe.

## Update — text-only attachment/read guidance

In opencode's progrok provider config, `grok-composer-2.5-fast` is registered as
text-only input while other Grok models can accept text+image. If a user pastes
or attaches an image, composer may receive only a text hint/path plus the
client's file tools. The injected discipline now explicitly tells composer that
it cannot infer attachment or image contents from a text-only message, path, or
filename alone; when a read/file-inspection tool is provided, it must call that
exact provided tool before analyzing the attachment. If no suitable tool exists,
it should say it cannot inspect the attachment directly.

Verification: after rebuilding and restarting the launchd proxy, a direct
`POST /v1/responses` smoke with only a `read` function tool and a pasted PNG
path returned HTTP 200 and a `function_call` named `read` with the exact image
path, instead of answering from the filename.

## Update — server-side search injection (web_search / x_search)

The xAI Responses API exposes server-side Agent Tools (the old chat
`search_parameters` Live Search is deprecated → HTTP 410). Valid tool types
(from the API's own deserializer): `function, web_search, x_search,
collections_search, file_search, code_execution, code_interpreter, mcp, shell`.
Verified live: grok-4.3 AND composer both accept `web_search`/`x_search`, and
they coexist with caller `function` tools in one request. These are
Responses-API only (Chat Completions returns 422).

Generic clients like opencode don't add xAI's server-side search (they ship
their own `function` tools). So `prepareGrokRequest` can inject `web_search` /
`x_search` into the Responses tools array, opt-in via `PROGROK_INJECT_SEARCH`
(`web`, `x`, `web,x`, or `all`/`1`). Applies to ALL grok models (not just
composer), skips multi-agent models, de-dupes by type, default OFF.

Verified: with the toggle on, a request carrying only a `function` tool gets
`web_search`+`x_search` injected and grok actually runs the search
(`num_server_side_tools_used: 2`, real cited X answer). Default off → no change.

The module entry point was renamed `prepareComposerRequest` → `prepareGrokRequest`
since search injection applies beyond composer. Unit tests: 23/23.

## Notes

- opencode must use the Responses API for composer to be stable. Configure the
  progrok provider with `"npm": "@ai-sdk/openai"` (bundled in opencode; routes
  through `sdk.responses()`), not `@ai-sdk/openai-compatible` (chat-only).
- Cross-context path leakage is reduced by constraining the toolset but is a
  model-side trait; treat composer output as untrusted.
