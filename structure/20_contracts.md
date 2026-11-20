# Contracts

Things with consumers that cannot be renamed on a whim. Each row names the file
that would tell you the contract broke.

| Contract | Where it lives | What enforces it |
|---|---|---|
| Browser DOM: 28 required element ids and their native types | `src/web/public/index.html` | `src/web/client/app.ts` throws on a missing selector at boot |
| Tabs: `[role="tab"]` with `aria-controls` pointing at panel ids | `src/web/public/index.html` | `src/web/client/render.ts` `activateTabs` |
| Content Security Policy, including `connect-src 'self' wss://api.x.ai` | `src/web/server.ts` `WEB_CSP` | `tests/webapp.test.ts` |
| One-use voice client secret per connection, never reused | `src/web/client/voice.ts` `openFreshSocket()` mints, `buildVoiceSocketSpec()` carries it in the subprotocol | `tests/voice-ws.test.ts`, `tests/webapp.test.ts` |
| Tolerant voice parsing: an unmodelled event is dropped and the call continues; only a server `error` event fails the session | `src/voice/protocol.ts` `tryParseRealtimeServerEvent` / `tryParseSttServerEvent` | `tests/voice-tolerant-parse.test.ts` |
| `capabilities --json` schema 2: `commands` is an array of objects, endpoints come from the surface registry | `src/commands/capabilities.ts` | `tests/capabilities.test.ts` |
| Video model rules and request validation | `src/utils/video-rules.ts`, `src/commands/video-request.ts` | `tests/video-request.test.ts`, `tests/video-cli.test.ts`, `tests/media-screen.test.ts` |
| Billing JSON remains additive; coupons are read-only and an unrecognized reply is never shown as zero | `src/surfaces/billing.ts`, `src/surfaces/grpc-web.ts`, `src/commands/billing.ts` | `tests/billing.test.ts` |
| Test suite uses a throwaway HOME and USERPROFILE | `scripts/run-tests.mjs` | `tests/test-isolation.test.ts` |
| Layer dependency direction | [10_layers.md](10_layers.md) | `tests/module-boundaries.test.ts` (POSIX and Windows paths) |

## Why tolerant parsing is a contract

It looks like leniency but it is a promise: a live call must survive an event this
build has never seen. The strict parsers still exist and the CLI and contract tests
still use them. Only the browser client takes the tolerant path, because only it has
a call to drop.

## Meta

Every row names the test that enforces it. The layer-direction row is enforced by
`tests/module-boundaries.test.ts`, which reads each import and fails on an edge that
[10_layers.md](10_layers.md) does not allow; it splits paths on either separator so the
Windows CI cells check the same edges as POSIX.

