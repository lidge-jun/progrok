# 261121 Grok media, voice and quota alignment — roadmap

Owner: HOTL cxc-loop thread (claude-opus-5-5). Branch `codex/261121-grok-media-voice-update` from
`origin/main` 9014310. package.json says 3.0.0; npm `latest` is 2.0.4, so 3.0.0 never reached npm.

## Objective

Make progrok match what xAI documents and what the live API does on 2026-11-21, add
SuperGrok weekly quota and reset-coupon visibility to `progrok billing`, refresh every
document and agent surface, and ship a new npm version.

Evidence for every behavioural claim lives in [001_live_evidence.md](001_live_evidence.md).

## Constraints

- Official docs were read through aside codemode (`browse.readText` on docs.x.ai `.md` pages).
  Live checks use the stored OAuth session. Paid generation is limited to the minimum
  needed and draws on the weekly pool: the account reports `prepaidBalance 0` and
  `onDemandCap 0`, so no prepaid credit can be spent. Reset coupons are read, never redeemed.
- Secrets never reach output: probes print status, shapes and costs only.
- Behaviour changes are test-first: a deterministic test is written and seen failing on the
  old code before the fix lands.
- Layer rules in structure/10_layers.md hold: new quota clients live in `surfaces`
  (`surfaces -> transport, core, wire, auth`), commands stay on top.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Default image model | `grok-imagine-image-2.0` | docs.x.ai/developers/models names Image 2.0 as the image choice; 1.0 stays selectable. |
| Default image quality | unset (server `auto`) | `auto` is the documented default; `--quality low|medium|auto` pins it. `high` is rejected live (400). |
| Default video model (generate) | `grok-imagine-video-1.5` | Docs name Video 1.5; T2V, I2V and R2V all pass live. Edit and extend keep `grok-imagine-video`, the only model that supports them. |
| Realtime reasoning | `high|none` | Live: `low` is refused on session.update and kills the backend as a query parameter. |
| Reproducible voice pin | `grok-voice-3.0` | `grok-voice-think-fast-2.0` is not a documented slug; live it silently resolves to 3.0. Default stays `grok-voice-latest`. |
| Codex quota | out of scope | progrok only holds an xAI OAuth session and has no ChatGPT credential; OpenCodex's Codex quota logic has nothing to read here. |
| Coupon redemption | not implemented | The user asked for display and lookup; redemption is irreversible and outside that grant. |
| Version | 3.1.0 (billing JSON stays additive, see 020) | Additive features plus fixes on top of the unpublished 3.0.0. The removed `live --reasoning low|medium` values never worked (live failure), so dropping them fixes a bug rather than breaking a working contract. |

## Work-phase map (dependency order)

| Phase | Doc | Outcome | Depends on |
|---|---|---|---|
| wp0 | this folder | Roadmap locked | — |
| wp1 | [010_wp1_media.md](010_wp1_media.md), [011_wp1_voice.md](011_wp1_voice.md) | Video, image and voice request surfaces match docs and live behaviour | wp0 |
| wp2 | [020_wp2_quota.md](020_wp2_quota.md) | `progrok billing` shows weekly credits and reset coupons | wp1 (shared files: command manifest, capabilities) |
| wp3 | [030_wp3_docs.md](030_wp3_docs.md) | README, docs/api.md, skill, site, CHANGELOG, capabilities and version | wp1, wp2 |
| wp4 | [040_wp4_release.md](040_wp4_release.md) | PR, fresh final review, merge, tag, npm, Release, Pages | wp3 |

## Verifiers used at every Check

```
npm run typecheck
npm test
npm run build
(cd site && npm ci && npm run build)
node dist/index.js --version
node dist/index.js capabilities --json --offline
```

## Delegation

Implementation and review lanes run as GOAT child tasks on `codex/gpt-6.1-terra`.
Every brief requires aside-jun for web research, failing-first tests, no paid calls
beyond what the brief names, and no secret output. Intermediate review rounds reuse the
same reviewer through `continueFrom`; the merge gate uses a fresh reviewer.


## Audit round 1 dispositions (Terra reviewer, VERDICT FAIL, 5 blockers)

1. Frame-only requests are R2V: folded into 010 rule 2 and tests; confirmed live (001).
2. Progress is an integer percent: folded into 010 for CLI and web; confirmed live (001).
3. Undecodable coupon payload → status "unknown", never 0: folded into 020.
4. Web 1080p is model-aware with a screen-level test: folded into 010 section 5.
5. Billing JSON stays additive over 3.0.0: folded into 020; version stays 3.1.0.

Non-blocking: action-level failing-first video tests added (010 section 6). Release notes will say that the
default image and video models change and cost more per request (image 2.0 from $0.04 vs 1.0 $0.02;
video 1.5 $0.08/s vs base $0.05/s). smart_turn_timeout without smart_turn is forwarded, not rejected (011).

## Audit round 2 dispositions (same reviewer, VERDICT FAIL, 1 open + 1 new)

- Billing JSON: case A (legacy success) keeps every 3.0.0 value and type, including the old `tier`; the corrected
  label moves to a new `plan` key. The weekly-only case is new, documented and tested (020).
- Layering: shared video rules move to `src/utils/video-rules.ts`; the web client never imports `commands/` (010 section 1).
