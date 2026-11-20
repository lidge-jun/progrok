# 030 — wp3 docs, skill, site, capabilities, version

## Files and edits

- `src/commands/capabilities.ts`: VIDEO_NOTES status → "supported" for T2V/I2V/R2V with per-model notes;
  add `{id:"frame-pins", endpoint:"POST /v1/videos/generations", cli:"progrok video [prompt] --image <first> --last-frame <last> --keyframe <img@t>", status:"supported-grok-imagine-video-1.5-only"}`
  and `{id:"voice-references", cli:"--voice <id>", status:"supported-grok-imagine-video-1.5-only"}`;
  edit/extend status unchanged. Add `recommendations.liveReproduciblePin: "grok-voice-3.0"`,
  `imageDefaultModel`, `videoDefaultModel`, and `ttsVoices: TTS_BUILTIN_VOICES`.
  Add a webApp media feature "video-1080p". Add limitation: "Grok reset coupons are listed read-only; progrok never redeems them."
- `README.md`: model table (drop -quality row or mark retired→2.0 low; add 2.0 quality and price; video base/1.5/lite with
  current prices $0.05/$0.08/$0.02 per s, lite 1080p $0.14/s); video matrix (1.5: T2V/I2V/R2V ✅, edit/extend ❌; lite: T2V/I2V);
  new flags; 1080p row "available for T2V/I2V on 1.5/lite; R2V 720p"; voice pin grok-voice-3.0; billing section.
- `docs/api.md`: replace grok-imagine-image-quality examples with 2.0 + quality; video params (resolution 1080p rules,
  reference_images 14/7, last_frame, keyframes, reference_audios); TTS optimize_streaming_latency integer 0|1|2; STT
  vad_threshold defaults 0.5/0.08, smart_turn_timeout 1–5000, model; realtime pin grok-voice-3.0 and effort high|none.
- `skills/progrok/SKILL.md`: same corrections, new CLI flags, billing coupons read-only, voices 28.
- `site/src/pages/docs/**`: models.astro, pricing.astro, cli/models.astro, cli/video.astro, cli/image.astro,
  video/generation.astro, video/reference-to-video.astro, video/smoke-matrix.astro, advanced/smoke-matrix.astro,
  images/generation.astro, images/editing.astro, images/multi-image-editing.astro, voice/realtime.astro,
  voice/tts.astro, voice/stt.astro.
- `PROMO.md`, `PROMO.txt`: grok-voice-think-fast-2.0 → grok-voice-3.0.
- `CHANGELOG.md`: new `## [3.1.0] - 2026-11-21` absorbing Unreleased plus this unit; note that 3.0.0 never reached npm.
- `package.json` + `package-lock.json`: 3.1.0.

## Consistency gate

`rg -n "image-quality|voice-think-fast|max 7|\"0\" or \"1\"|1.5-preview" README.md docs skills site/src src`
returns only intentional retirement notes. `node dist/index.js skill | head` and
`node dist/index.js capabilities --json --offline` show the new fields.


## P amendment before wp3 (2026-11-21)

Facts that changed after this doc was written and must reach the docs:

- `progrok billing --json` keeps every 3.0.0 key and adds `plan`, `weekly`, `resetCoupons`; when only the weekly
  endpoint answers it prints `{email, plan, weekly, resetCoupons, legacy: null}`. Text output prints "unavailable" for
  missing amounts and a failed weekly read, and converts the reset time to UTC. Coupons are read-only.
- `progrok live --reasoning` accepts high|none; other values and a non grok-voice-* model are usage errors (exit 1).
- Keyframes are rejected only when two timestamps round to the same 1/3 s slot.
- The web media form enables 1080p for known models that allow it and for models this build has no rules for.
- `progrok tts` has --speed, --sample-rate, --bit-rate, --latency 0|1|2, --text-normalization, --list-voices;
  `progrok stt` has --model, --filler-words, --vad-threshold, --format, --audio-format, --sample-rate, --channels.
- Test isolation: scripts/run-tests.mjs runs the suite with a throwaway HOME/USERPROFILE. The old suite deleted the
  real ~/.progrok/auth.json; CHANGELOG must say so under Fixed so contributors know to re-login.
- `structure/20_contracts.md` and `structure/10_layers.md` gain the new modules (src/utils/video-rules.ts,
  src/commands/video-request.ts, src/surfaces/billing.ts, src/surfaces/grpc-web.ts) and the test-home contract.
- Exact CLI help text for every changed command: /tmp/progrok-research/cli-help.txt (copied into the lane brief).


## Audit dispositions for the docs phase (Terra plan audit, VERDICT FAIL, 4 blockers)

1. Add `site/src/pages/docs/video/image-to-video.astro`: `image` with `reference_images` is refused on grok-imagine-video
   only; on grok-imagine-video-1.5 `image` pins the first frame of a reference-to-video request.
2. README: rewrite the video prose and smoke-result sections (around lines 256–281). Current behaviour is stated as current;
   the 2026-06 smoke results that failed (1.5 T2V/R2V, 1080p for this team) stay only under a dated "Historical smoke
   (2026-06)" heading that says they no longer hold, with the 2026-11-21 live results beside them. Same for
   site/src/pages/docs/video/smoke-matrix.astro and advanced/smoke-matrix.astro.
3. Prices are written per resolution and per input, with provenance, never as one flat rate:

   | Model | 480p | 720p | 1080p | Inputs |
   |---|---|---|---|---|
   | grok-imagine-video | $0.05/s | $0.07/s | — | image $0.002, input video $0.01/s |
   | grok-imagine-video-1.5 | $0.08/s | $0.14/s | $0.25/s (T2V/I2V only) | image $0.01; preset voices free |
   | grok-imagine-video-1.5-lite | $0.02/s | $0.03/s | $0.14/s (upscaled) | image $0.01 |

   | Model | 1K | 1.5K | 2K | Inputs |
   |---|---|---|---|---|
   | grok-imagine-image-2.0 low | $0.04 | $0.05 | $0.06 | edit input $0.01/image |
   | grok-imagine-image-2.0 medium | $0.06 | $0.07 | $0.08 | edit input $0.01/image |
   | grok-imagine-image (1.0) | $0.02 | — | $0.02 | $0.002/image |

   Provenance line under each table: "xAI model catalog and docs.x.ai pricing, read 2026-11-21; live
   cost_in_usd_ticks matched 1.5 480p $0.08/s, lite 480p $0.02/s, lite 1080p $0.14/s and image 2.0 1K medium $0.06.
   Prices change; xAI's pricing page is authoritative." `auto` is billed at the quality actually served.
4. Consistency gate, split in two:
   - must return nothing (stale behaviour): `rg -n "grok-voice-think-fast|prompt-only T2V and reference_images are rejected|1080p is conflicting|max 7 refs|\"0\" or \"1\"|grok-imagine-image-quality.*(HQ|Higher-quality)" README.md docs skills site/src src PROMO.md PROMO.txt`
   - allowed matches, reviewed by hand: the alias table in src/utils/video-rules.ts (`grok-imagine-video-1.5-preview`,
     `-2026-05-30`), retirement notes for `grok-imagine-image-quality`/`-pro`, and the dated historical smoke sections.

Non-blocking folded: docs/api.md and skills/progrok/SKILL.md describe both billing JSON shapes (legacy success with the
3.0.0 keys plus plan/weekly/resetCoupons; weekly-only `{email, plan, weekly, resetCoupons, legacy: null}`) and the coupon
states ok/unknown/error, with "read-only; progrok never redeems a reset".

