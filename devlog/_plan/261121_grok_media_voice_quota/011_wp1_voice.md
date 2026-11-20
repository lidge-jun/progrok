# 011 — wp1 voice: realtime, TTS, STT

## 1. MODIFY `src/voice/protocol.ts`

```diff
-export type RealtimeReasoningEffort = "low" | "medium" | "high";
+/** Live 2026-11-21: grok-voice-3.0 accepts only these; "low" fails the session. */
+export type RealtimeReasoningEffort = "high" | "none";
+export const REALTIME_REASONING_EFFORTS = ["high", "none"] as const;
+/** Reproducible pin for docs and examples; the operational default stays the alias. */
+export const PINNED_REALTIME_MODEL = "grok-voice-3.0" as const;
```

## 2. MODIFY `src/commands/live.ts`

`parseReasoningEffort` accepts only high|none, error "--reasoning must be high or none";
option help "high|none (grok-voice-3.0)"; `--model` help mentions grok-voice-3.0 as the pin.

## 3. MODIFY TTS

- `src/voice/tts.ts`: `optimize_streaming_latency?: 0 | 1 | 2` (number). Validate integer 0..2.
  Export `TTS_BUILTIN_VOICES` = the 28 ids from GET /v1/tts/voices (001 evidence), and add
  `listVoices(): Promise<ListTtsVoicesResponse>` to the client (GET /v1/tts/voices, decode
  `voices[].voice_id/name/language`).
- `src/voice/tts-session.ts`: `optimize_streaming_latency?: 0 | 1 | 2`, validate 0..2.
- `src/commands/tts.ts`: `<text>` becomes `[text]`; NEW options
  `--speed <n>` (0.7–1.5), `--sample-rate <hz>`, `--bit-rate <bps>` (mp3 only),
  `--latency <0|1|2>` → optimize_streaming_latency, `--text-normalization`,
  `--list-voices` (prints `voice_id  name` lines, or JSON with --json; text then not required).
  Missing text without --list-voices → help.
- `src/web/public/index.html` `#voice-name`: 28 options generated from the live list, eve first.

## 4. MODIFY STT

- `src/voice/stt.ts`: `SttRequest.model?: string` (form field `model`), keep filler_words/vad_threshold.
- `src/voice/stt-session.ts`: `model?: string` query param; `smart_turn_timeout` integer 1..5000
  ("smart_turn_timeout must be 1..5000"). It is still forwarded without `smart_turn`; the docs say it only
  takes effect when smart_turn is set, so the CLI help says so instead of rejecting it.
- `src/commands/stt.ts`: NEW `--model <id>`, `--filler-words`, `--vad-threshold <0..1>`,
  `--format` (inverse text normalisation, needs --language), `--audio-format <pcm|mulaw|alaw>`,
  `--sample-rate <hz>`, `--channels <n>`.

## 5. Tests first

- tests/voice-cli.test.ts: `live --reasoning low` rejected, `none` reaches createRealtimeClient as reasoningEffort "none";
  tts flags map to the request (`optimize_streaming_latency: 2` as a number, speed, output_format.sample_rate/bit_rate,
  text_normalization); `tts --list-voices --json` with a mocked transport; stt flags map (model, filler_words, vad_threshold, format).
- tests/voice-rest.test.ts: `optimize_streaming_latency: 3` and `"1"` rejected; JSON body sends a number.
- tests/voice-ws.test.ts: smart_turn_timeout 0 and 5001 rejected, 1 and 5000 accepted; tts osl 2 accepted, 3 rejected; model query param forwarded.
- tests/voice-protocol.test.ts or capabilities test: TTS_BUILTIN_VOICES has 28 unique ids including eve.

