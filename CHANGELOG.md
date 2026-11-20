# Changelog

## [3.1.0] - 2026-11-21

3.0.0 was tagged in this file but never published to npm, so this is the first
3.x release on npm. It includes everything listed under 3.0.0 below.

### Added

- Video: `grok-imagine-video-1.5` now does text-to-video and reference-to-video
  (up to 14 reference images and 15 seconds), takes up to three preset voices
  with `--voice`, and pins frames with `--last-frame` and up to four
  `--keyframe <input@seconds>` anchors. `grok-imagine-video-1.5-lite` is
  supported for text- and image-to-video. 1080p is accepted for text- and
  image-to-video on 1.5 and lite; reference-to-video stays at 720p. The rules are
  checked before a request is sent; a model without rules is left to xAI.
- Image: `--quality low|medium|auto` for `grok-imagine-image-2.0`, `1.5k`
  resolution, `21:9` and `5:2` aspect ratios, and up to five edit sources.
- Voice: `tts --list-voices` and the 28 built-in voices (also in the web Voice
  tab and `capabilities`); `tts` gains `--speed`, `--sample-rate`,
  `--bit-rate`, `--latency 0|1|2` and `--text-normalization`; `stt` gains
  `--model`, `--filler-words`, `--vad-threshold`, `--format`,
  `--audio-format`, `--sample-rate` and `--channels`.
- Billing: `progrok billing` reads the SuperGrok / X Subscription weekly usage
  pool, per-product usage, prepaid balance and on-demand cap, and lists Grok reset
  coupons with their expiry. Listing is read-only; progrok never redeems a reset.
  `--json` keeps every 3.0.0 key and adds `plan`, `weekly` and
  `resetCoupons`; if only the weekly endpoint answers it prints
  `{email, plan, weekly, resetCoupons, legacy: null}` instead of failing.
- `capabilities --json` reports the default image and video models, the
  `grok-voice-3.0` pin, the TTS voices, frame-pin and voice-reference video
  notes, and the read-only coupon limitation.
- The local web app is one workspace with Chat, Voice and Media tabs. The top
  bar reports the served endpoint, the catalog model count and the active model,
  and each row stays hidden until a value is observed.
- Voice reports nine connection states through colour, shape and text, and draws
  input and output level meters from real `AnalyserNode` data. Silence does not
  move them, and `prefers-reduced-motion` skips the animation loop entirely.
- Voice adds a mute toggle, session elapsed time, input device, send rate,
  browser network state, and a log of received event types. The log records
  types and timestamps only, never payloads, transcripts or secrets.
- Chat follows new output only when the reader is already at the bottom, keeps
  their position otherwise, and offers an explicit control to jump back.
- A catalog failure is scoped to the panel that needs it, with its own retry.
  Voice keeps working through it.
- Media results carry a provenance caption: model, submitted options, measured
  elapsed time and job id, snapshotted at submit time.
- `capabilities --json` reports `webApp.surfaces` with per-tab feature lists.

### Fixed

- **The test suite deleted your real login.** `npm test` wrote a test token to
  `~/.progrok/auth.json` and then removed the file. The suite now runs against a
  throwaway home and a test fails if it ever reaches the real one. If your session
  disappeared after running the tests, run `progrok login` again.
- `tts --latency`/`optimize_streaming_latency` is sent as an integer. The
  string form progrok used was rejected by xAI with HTTP 422; 2 is now accepted.
- `live --reasoning low` and `medium` ended the session (`grok-voice-3.0` only
  accepts `high` and `none`); they are now a one-line usage error, as is a
  non `grok-voice-*` model.
- Images were always saved as `.png`; they now get the extension of the returned
  format (JPEG today). `--output` with `--n` above 1 writes one numbered file
  per image instead of overwriting one path.
- Video progress printed 100 times too large (10000%), and the web Media tab showed
  1% as 100%. xAI reports an integer percent; both now show it as is.
- `billing` showed "SuperGrok (0 val)" and a $0.00 limit for accounts on the
  weekly pool. The text output now names the plan and shows weekly usage; reset
  times are converted to UTC and missing amounts read "unavailable".
- STT `smart_turn_timeout` is checked against the documented 1–5000 ms;
  TTS and STT sample rates, bit rates and channel counts are checked, so a typo no
  longer goes out as `NaN`.
- A live voice call no longer ends when the server sends an event this build
  cannot model. The parser drops it, logs a sanitised type and keeps reading.
  Only a server `error` event fails the session.

### Changed

- **Defaults now cost more per request.** `progrok image` uses
  `grok-imagine-image-2.0` (from $0.04 per 1K image, versus $0.02 for
  `grok-imagine-image`) and `progrok video` uses `grok-imagine-video-1.5`
  (from $0.08/s at 480p, versus $0.05/s). Pass `--model` to keep the old ones;
  `video edit` and `video extend` still default to `grok-imagine-video`, the
  only model that supports them.
- Docs and examples pin `grok-voice-3.0` for reproducibility; the undocumented
  `grok-voice-think-fast-2.0` is gone. `grok-imagine-image-quality` and `-pro`
  are documented as retired (xAI serves them as 2.0 at low quality).
- `DEFAULT_MODEL` is `grok-4.6`, and the realtime default is the rolling
  `grok-voice-latest` alias. The constant is now `DEFAULT_REALTIME_MODEL`
  because it no longer pins a dated build, and `live --model` accepts any
  `grok-voice-*` identifier.
- The Imagine video model is `grok-imagine-video-1.5`; the `-preview` suffix is gone.
- Model tables match the catalog a live session returns, and `grok-composer-2.5`
  is corrected to `grok-composer-2.5-fast`.

## [3.0.0] - 2026-09-18

progrok stops being a proxy that swaps an Authorization header and becomes a
native client for the xAI API, with a web app on top.

### Breaking

- **`capabilities --json` is schema 2.** `commands` is an array of objects with
  `name`, `summary` and argument metadata instead of an array of strings, and the
  endpoint list is generated from the surface registry rather than a hand-kept
  copy. There is no legacy shim: a consumer reading `commands[i]` as a string
  must read `commands[i].name`. This is the whole reason the version is a major.
- **`progrok chat` serves the new workspace**, not the old single-page demo.
- **Node 22 is the minimum runtime**, raised from Node 18. Node 18 reached
  end-of-life in 2025-04 and Node 20 in 2026-04, so neither line receives
  security fixes any more. npm only warns about an `engines` mismatch by
  default, but an install run with `engine-strict` will now fail on Node 18
  or 20. CI covers Node 22, 24 and 26.

### Added

- **Voice REST** — `POST /v1/tts`, `POST /v1/stt`, the built-in voice listing,
  custom-voice CRUD, and ephemeral client secrets, as typed clients.
- **Voice WebSockets** — streaming speech-to-text, streaming text-to-speech and
  realtime speech-to-speech against `wss://api.x.ai`, including xAI's
  `force_message` extension, session resumption and DTMF events.
- **Responses WebSocket** — one turn in flight per connection, with
  `previous_response_id` continuation and the `generate:false` warmup.
- **Surface clients** — batches, files, collections, embeddings, skills, models,
  tokenize, images and videos behind one boundary, plus a registry that records
  where the evidence for each endpoint came from.
- **CLI** — `tts`, `stt` and `live`.
- **Web app** — chat with reasoning and tool activity, browser voice against xAI
  directly, and image/video generation with poll-to-terminal handling.

### Changed

- **Requests are parsed, not forwarded.** Chat and Responses become typed events
  and are re-rendered, so a malformed tool call or a stream that ends without a
  terminal is an error instead of corrupt bytes. Everything else remains a
  verified relay, which is the right answer for binary and multipart.
- **Token refresh is a transaction** — single-flighted per account and
  credential generation, with a stale result fenced off and a 401 replayed
  exactly once.
- **Routing is explicit.** The OAuth lane is `api.x.ai`. `cli-chat-proxy.grok.com`
  is reachable only through an opt-in client: it gates on a Grok CLI version
  header, exposes two models, serves `grok-4.6-build` and has no voice
  endpoints.

### Fixed

- Error responses no longer echo credential-shaped values from an underlying
  error message.
- A paused relay no longer strands its promise when the client disconnects
  before the socket drains.

### Notes

- The credential file keeps its path, schema and unknown fields. ima2-gen
  v3.16.1 removed its bundled progrok and reads the same
  `~/.progrok/auth.json` directly, so breaking that format would break it.
- An ephemeral client secret opens exactly one WebSocket. Mint one per
  connection and pass it only through the `xai-client-secret.<token>`
  subprotocol; as a bearer it is rejected.
