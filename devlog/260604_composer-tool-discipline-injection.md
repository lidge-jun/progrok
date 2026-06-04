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

## Notes

- opencode must use the Responses API for composer to be stable. Configure the
  progrok provider with `"npm": "@ai-sdk/openai"` (bundled in opencode; routes
  through `sdk.responses()`), not `@ai-sdk/openai-compatible` (chat-only).
- Cross-context path leakage is reduced by constraining the toolset but is a
  model-side trait; treat composer output as untrusted.
