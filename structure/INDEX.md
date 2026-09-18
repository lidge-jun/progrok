# progrok — internal architecture

progrok turns an xAI OAuth session into a programmable local endpoint. It signs in
with your xAI account, keeps a refreshable credential on disk, and exposes that
session through four surfaces: an OpenAI-compatible HTTP proxy, direct CLI
commands, typed REST/WebSocket clients, and a local web workspace.

This folder documents **how the code is arranged**, not how to call the API. It is
for someone about to change the source.

| Read this | For |
|---|---|
| [10_layers.md](10_layers.md) | What each source directory owns, which direction imports flow, where the public boundaries are |
| [20_contracts.md](20_contracts.md) | What must not break, with the file that enforces it |
| [30_evidence.md](30_evidence.md) | Where a decision came from |

Elsewhere in the repo:

- [docs/api.md](../docs/api.md) — API reference: endpoints, parameters, examples
- [README.md](../README.md) — what the tool does and how to run it
- [DESIGN.md](../DESIGN.md) — design read and dials for the web workspace
- [devlog/_plan/](../devlog/_plan/) — per-unit work records with their evidence

## Design principles

**One package, no framework.** A single `package.json` builds the CLI and the browser
bundle. Dependencies are four: commander, express, open, ws. Adding a fifth needs a
reason stronger than convenience.

**Layers flow one direction.** `core` and `utils` sit at the bottom; `commands` sits at
the top and is allowed to reach almost anywhere. Everything between imports downward.
One exception exists and is documented rather than hidden — see 10_layers.md.

**Direct imports, not barrels.** Only two `index.ts` files exist: the CLI entry and the
REST surface aggregate. Other directories are imported by path. With a single
consumer and no published submodules, eight more barrel files would add indirection
without buying isolation.

**Contracts before cleanliness.** The browser client, the voice protocol, the CSP and
the capabilities schema all have consumers that cannot be renamed on a whim. When
tidiness and a contract disagree, the contract wins and the mess gets a comment.

## What this repo deliberately does not do

- No per-layer barrel files. See above.
- No transport abstraction over `fetch` and `ws`. The two call sites that need
  retry own it explicitly.
- No dependency injection container. Constructors take what they need.
- No refactor that changes behaviour in the same unit as a move. Moves are moves.

