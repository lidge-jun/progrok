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
| Layer dependency direction | [10_layers.md](10_layers.md) | not yet automated — see the roadmap |

## Why tolerant parsing is a contract

It looks like leniency but it is a promise: a live call must survive an event this
build has never seen. The strict parsers still exist and the CLI and contract tests
still use them. Only the browser client takes the tolerant path, because only it has
a call to drop.

## Meta

The layer-direction row has no enforcement yet. A boundary test is planned in
[devlog/_plan/260919_structure_modularize/020_modularize.md](../devlog/_plan/260919_structure_modularize/020_modularize.md);
until it exists, this table is describing intent, not a gate.

