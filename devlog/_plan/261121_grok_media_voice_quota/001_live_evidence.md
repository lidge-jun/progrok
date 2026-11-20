# Live and documentation evidence (2026-11-21)

## Documentation read (aside codemode, `browse.readText`, all `complete: true`)

| Page | Facts used |
|---|---|
| developers/models.md | Image 2.0 and Video 1.5 recommended; prices: image 1.0 $0.02, 2.0 $0.04; video base $0.05/s, 1.5 $0.08/s, 1.5-lite $0.02/s; voice 3.0 and deprecated 2.0. |
| developers/migration/imagine-image-quality-nov-2.md | `grok-imagine-image-quality` and `-pro` retired 2026-11-02, served by 2.0 at `quality: low`. |
| developers/model-capabilities/images/generation.md | `quality` low, medium, auto (default auto: low for generation, medium for edit); `n` 1–10. |
| developers/rest-api-reference/inference/images.md | `resolution` 1k, 1.5k, 2k; aspect ratios include 21:9 and 5:2; output mime is JPEG unless quality yields PNG. |
| developers/model-capabilities/images/multi-image-editing.md | Up to five source images per edit. |
| developers/model-capabilities/video/overview.md | Capability matrix: 1.5 T2V/I2V to 1080p native, R2V 14 images/15 s/720p, 3 voices, first/last frame, 4 keyframes; lite T2V/I2V to 1080p (upscaled), no references, voices, frames; base R2V 7 images/10 s, edit and extend only on base. |
| developers/model-capabilities/video/reference-to-video.md | `last_frame`, `keyframes` (timestamp_s strictly inside, 1/3 s grid, max 4), `reference_audios` voice_id max 3, prompt optional when a frame is pinned. |
| developers/rest-api-reference/inference/videos.md | Request fields, duration 1–15, extension 2–10. |
| developers/model-capabilities/audio/speech-to-speech.md | `grok-voice-latest` → `grok-voice-3.0`; 2.0 deprecated; `reasoning.effort` "high" or "none". |
| developers/model-capabilities/audio/text-to-speech.md | `optimize_streaming_latency` integer 0, 1, 2; speed 0.7–1.5; output_format codec, sample_rate, bit_rate; text_normalization. |
| developers/model-capabilities/audio/speech-to-text.md | Model `grok-voice-transcribe-2.0` (default); REST `filler_words`, `vad_threshold` (default 0.5), `format` needs `language`; streaming `smart_turn_timeout` 1–5000, `endpointing` 0–5000. |
| developers/release-notes.md | voice-transcribe-1.0 EOL 2026-10-02; image quality auto default; five reference images; 21:9 and 5:2. |
| x-subscription/usage-limits.md, extra-usage.md | Weekly pool per seat; Additional Usage paid from prepaid top-up credit. |

## Live probes (OAuth session, scripts under /tmp/progrok-research)

Read-only:

| Call | Result |
|---|---|
| GET /v1/models | includes grok-imagine-image, -image-2.0, -video, -video-1.5, -video-1.5-lite; no -quality |
| GET /v1/video-generation-models | 1.5 aliases: grok-imagine-video-1.5-preview, grok-imagine-video-1.5-2026-05-30 |
| GET /v1/tts/voices | 28 voices: altair ara atlas aurora carina castor celeste cosmo eve helios helix iris kepler leo liora lumen luna lux naksh orion perseus rex rigel sal sirius ursa zagan zenith |
| GET cli-chat-proxy /v1/billing | legacy `monthlyLimit.val 0`, so the current `progrok billing` prints a 0 limit and a "SuperGrok (0 val)" tier |
| GET cli-chat-proxy /v1/billing?format=credits (x-userid = JWT sub, grok-cli headers) | `currentPeriod.type USAGE_PERIOD_TYPE_WEEKLY`, `creditUsagePercent 3`, `productUsage [{GrokBuild, 3}]`, `prepaidBalance.val 0`, `onDemandCap.val 0`, `isUnifiedBillingUser true` |
| POST grok.com/prod_mc_billing.ConsumerUiSvc/GetRemainingResets | HTTP 200, one empty data frame, trailer `grpc-status:0` → zero coupons |

Paid (minimum, from the weekly pool):

| Request | Result | Cost |
|---|---|---|
| image 2.0 `quality: high` | 400 "only supports … low, medium, auto" | 0 |
| image 2.0 `quality: medium`, 1k | 200, `mime_type: image/jpeg`, bytes start ffd8ffe0 | $0.06 |
| video 1.5-lite T2V 1 s 480p | done | $0.02 |
| video 1.5-lite T2V 1 s 1080p | done | $0.14 |
| video 1.5 T2V 1 s 480p (no image) | done | $0.08 |
| video 1.5 image + reference_images + reference_audios eve + last_frame + keyframe@1.0, 2 s 480p | done | $0.20 |
| video 1.5-lite + last_frame | 400 "`last_frame` is not supported for this model." | 0 |
| video 1.5-lite + reference_images | 400 "`reference_images` is not supported for this model." | 0 |
| video 1.5 with 15 reference images | 400 "Too many reference images: 15. Maximum allowed is 14." | 0 |
| video 1.5 R2V at 1080p | 400 "1080p video resolution is not supported for reference-to-video requests." | 0 |
| poll responses | `progress` arrives as 0–100 (done = 100); the CLI multiplies by 100 and would print 10000% | — |
| realtime grok-voice-3.0 session.update reasoning.effort low | error "unknown variant `low`, expected `none` or `high`" | ~0 |
| realtime ?reasoning.effort=low | fatal `connection_failed`, socket 1006 | ~0 |
| realtime ?reasoning.effort=high / none | session.created | ~0 |
| realtime ?model=grok-voice-think-fast-2.0 | session.created reports model grok-voice-3.0 | ~0 |
| TTS REST optimize_streaming_latency 2 (integer) | 200 audio/mpeg | ~0 |
| TTS REST optimize_streaming_latency "2" (string, progrok's current type) | 422 "invalid type: string, expected i32" | 0 |
| TTS WS optimize_streaming_latency=2 | audio.delta ×4, audio.done | ~0 |
| STT WS smart_turn_timeout 10000 / 5000 / 0 | all accepted (server is lenient); docs state 1–5000 | ~0 |

Total paid generation ≈ $0.50 from the weekly pool.


## Cross-check: Aside OpenAI/Codex report (received 2026-11-21)

Source: /Users/jun/.aside/u/0/artifacts/research-20261121/openai-codex-report.md, section 6.

- Its progrok section finds no point where OpenAI limits or model changes reach progrok directly.
  That agrees with the decision in 000_plan.md to keep Codex quota out of scope.
- The report scanned the stale root checkout (main 8dc1afb, 2026-06-11), 34 commits behind
  this branch. Its file-level remarks about progrok are not used here; every progrok claim in
  this unit comes from 9014310 source and the live probes above.
- Its Codex reset-credit shape (`wham/rate-limit-reset-credits`, 30-day expiry) is the
  ChatGPT side. The xAI equivalent used here is grok.com `GetRemainingResets`, probed live
  above (zero coupons). NOT RUN: a live `wham/usage` call. progrok holds no ChatGPT
  credential, and borrowing Codex's credential for an out-of-scope check is not justified.


## Cross-check: Aside xAI/Grok report (received 2026-11-21)

Source: /Users/jun/.aside/u/0/artifacts/research-20261121/xai-grok-report.md (sections 2–4, 7–8, 11).

Agreements with this unit's own reads and probes: image 2.0 quality low|medium|auto and
1k/1.5k/2k; -pro retired 2026-05-15 into -quality, which now serves 2.0 low; video 1.5 R2V
capped at 720p, native 1080p only for T2V/I2V; edit and extend only on the base model;
lite has no references or frames and its 1080p costs $0.14/s (our probe: $0.14 for 1 s);
voice 3.0 reasoning effort high|none; 28 TTS voices; STT smart_turn_timeout 1–5000.

Corrections applied to this unit:

- `grok-voice-transcribe-1.0` is not shut off. Since 2026-10-02 it is routed to 2.0 at the
  same price. Live: `model=grok-voice-transcribe-1.0` on streaming STT is accepted.
- `optimize_streaming_latency`: the guide says integer 0/1/2 and the REST reference shows
  "0"/"1". The live REST endpoint rejects the string form with 422 and accepts integers, so
  the integer form is implemented and the REST reference is treated as stale.
- STT `vad_threshold` defaults differ by transport: REST 0.5, streaming 0.08. Docs will say so.

Live read-only probes of the grok.com billing RPCs (gRPC-web, 5-byte empty frame,
`Authorization: Bearer` + `x-xai-token-auth: xai-grok-cli`; token never printed):

| RPC | Result |
|---|---|
| grok_api_v2.GrokBuildBilling/GetRemainingResets | HTTP 200, empty data frame, grpc-status 0 → 0 coupons |
| prod_mc_billing.ConsumerUiSvc/GetRemainingResets | HTTP 200, empty data frame, grpc-status 0 → 0 coupons |
| grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig | HTTP 200, field 1 = config{8: current_period{1: type 2 (WEEKLY), 2: start, 3: end}, 7: product_usage{1: product 2, 2: float}, 4/5: billing period timestamps, 11: is_unified 1}; same period as the JSON endpoint |
| RedeemReset | NOT CALLED (forbidden) |

Decision: weekly usage reads the JSON endpoint `cli-chat-proxy.grok.com/v1/billing?format=credits`
(the shape OpenCodex parses, readable without a protobuf schema, and verified live above).
Coupons read `GrokBuildBilling/GetRemainingResets` first and fall back to
`ConsumerUiSvc/GetRemainingResets` on grpc-status 12 or HTTP 404. Residual risk: with zero
coupons on this account, the non-empty message layout of the new path is unverified live. The
decoder uses the old path's layout (field 10 repeated token {10 id, 20 start, 30 end}) and
reports a decode failure as an error rather than as zero coupons.

NOT RUN: `wham/usage` (ChatGPT; progrok holds no ChatGPT credential, Codex quota is out of scope).


## Audit round 1 follow-up probes (2026-11-21)

| Request | Result | Cost |
|---|---|---|
| video 1.5, `last_frame` only (no references), 1 s, 1080p | 400 "1080p video resolution is not supported for reference-to-video requests." A frame pin alone makes the request reference-to-video. | 0 |
| video 1.5-lite T2V 1 s 480p, polled every 1.5 s | progress sequence 1, 1, 10, 10, 10, 10, 50, then done at 100 | $0.02 |

Progress contract: `progress` is an integer percent 0-100 while pending and 100 when done.
A value of 1 means 1 %, so the web client's `progress > 1 ? progress / 100 : progress`
heuristic (src/web/client/media.ts:218) shows 1 % as 100 %. CLI and web both divide by 100 and clamp.
