# Layers

Measured 2026-09-19: 89 TypeScript files, 11,229 lines across 11 directories.

| Directory | Files | Lines | Owns |
|---|---:|---:|---|
| `core` | 3 | 190 | Shared types and typed errors |
| `utils` | 8 | 214 | Logger, config dir, URL opening, prompts |
| `auth` | 8 | 1371 | OAuth PKCE and device-code flows, token store, refresh, constants |
| `transport` | 4 | 539 | xAI request routing, signing, retry, headers |
| `wire` | 4 | 1212 | SSE and stream parsing, tool-call assembly, chat/responses shaping |
| `surfaces` | 13 | 1208 | Typed REST clients: models, files, batches, images, videos, skills, collections, embeddings |
| `proxy` | 9 | 1008 | Local `/v1` proxy, binary relay, composer injection |
| `voice` | 8 | 1245 | Voice protocol, WebSocket client, realtime/STT/TTS |
| `web` | 13 | 2513 | Local web app: express server plus the browser bundle |
| `chat` | 1 | 9 | Thin delegation for the `chat` command |
| `commands` | 17 | 1670 | Fifteen CLI commands |

## Dependency direction

Measured from every `from "../..."` import:

```
core, utils ─────────────────── bottom
auth       ──> utils
utils      ──> auth                     ← known cycle
transport  ──> auth, utils
wire       ──> core
surfaces   ──> transport, core, wire, auth
proxy      ──> core, wire, utils, auth, transport
voice      ──> transport, utils, auth
web        ──> utils, proxy, auth, voice, core
chat       ──> auth, web
commands   ──> auth, chat, proxy, surfaces, transport, utils, voice
```

Any edge outside this list is a regression.

## The known cycle: auth ↔ utils

`auth` and `utils` import each other.

```
auth/token-store.ts:11   ──> utils/config.js      (ensureConfigDir)
auth/pkce.ts:12,13       ──> utils/open-url.js, utils/logger.js
auth/device-code.ts:12   ──> utils/logger.js

utils/config.ts:7        ──> auth/constants.js    (CONFIG_DIR, CONFIG_FILE)
utils/star-prompt.ts:1   ──> auth/constants.js    (GITHUB_URL)
```

The cause is placement, not design: `auth/constants.ts` is a pure constants module
with no auth logic in it, so anything needing a path or a URL has to reach into
`auth` to get one.

Moving those constants to `core` would break the cycle. That is a pure move with no
behaviour change, but it rewrites imports in several files, so it is not bundled
with unrelated work. It is recorded here so the next person sees it as a known
debt rather than discovering it as a surprise.

## Public boundaries

Two `index.ts` files:

- `src/index.ts` — the CLI entry point, the only thing `package.json` exposes as `bin`
- `src/surfaces/index.ts` — aggregates the typed REST clients for command code

Everything else is imported by path. Adding a barrel per layer was considered and
rejected: with one consumer and no published submodules it buys indirection, not
isolation.

## Where the size is

The browser client is the largest single area at 2,513 lines, and
`web/client/voice.ts` is the largest file. It coordinates connection lifecycle,
control state, diagnostics rendering and event dispatch. Parts of it read as
separable, but most of those parts touch private controller state, so extracting
them costs more injection boilerplate than it removes. That trade-off is recorded
in [devlog/_plan/260919_structure_modularize/000_roadmap.md](../devlog/_plan/260919_structure_modularize/000_roadmap.md).

