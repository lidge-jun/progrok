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

