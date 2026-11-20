# 010 — wp1 media: video and image request surfaces

Evidence: [001_live_evidence.md](001_live_evidence.md). Every behaviour change starts with a
test that fails on 9014310.

## 1. NEW `src/utils/video-rules.ts` and `src/commands/video-request.ts` (pure, no I/O)

Layering (structure/10_layers.md, tests/module-boundaries.test.ts): `web -> utils` and `commands -> utils` are allowed,
`web -> commands` is not. So the model table, alias map, `videoRulesFor`, `normalizeVideoProgress` and the keyframe
slot helper live in `src/utils/video-rules.ts` (no node imports, safe for the browser bundle). Request assembly
(`parseKeyframe`, `buildVideoGenerationRequest`, which needs `mediaRef`) lives in `src/commands/video-request.ts`
and imports the rules from utils. The web client imports only `utils/video-rules.ts`.

```ts
export type VideoResolution = "480p" | "720p" | "1080p";
export interface VideoModelRules {
  maxReferenceImages: number;      // 0 = unsupported
  referenceMaxDuration: number;    // seconds, R2V only
  maxVoices: number;               // reference_audios
  framePins: boolean;              // last_frame + keyframes, image combined with references
  resolutions: readonly VideoResolution[];
  referenceMaxResolution: VideoResolution;
}
export const VIDEO_MODEL_RULES: Record<string, VideoModelRules> = {
  "grok-imagine-video":          { maxReferenceImages: 7,  referenceMaxDuration: 10, maxVoices: 0, framePins: false, resolutions: ["480p","720p"],          referenceMaxResolution: "720p" },
  "grok-imagine-video-1.5":      { maxReferenceImages: 14, referenceMaxDuration: 15, maxVoices: 3, framePins: true,  resolutions: ["480p","720p","1080p"], referenceMaxResolution: "720p" },
  "grok-imagine-video-1.5-lite": { maxReferenceImages: 0,  referenceMaxDuration: 0,  maxVoices: 0, framePins: false, resolutions: ["480p","720p","1080p"], referenceMaxResolution: "720p" },
};
export const VIDEO_MODEL_ALIASES: Record<string, string> = {
  "grok-imagine-video-1.5-preview": "grok-imagine-video-1.5",
  "grok-imagine-video-1.5-2026-05-30": "grok-imagine-video-1.5",
};
export function videoRulesFor(model: string): VideoModelRules | undefined; // alias-aware; unknown -> undefined (no model checks, server decides)
export interface Keyframe { input: string; timestampS: number }
export function parseKeyframe(value: string): Keyframe;  // "<input>@<seconds>", split on the LAST "@"; seconds finite > 0
export interface VideoGenerationInput {
  model: string; prompt?: string; duration: number; durationField: "duration" | "seconds";
  aspect: string; resolution: string; image?: string; refs: string[]; voices: string[];
  lastFrame?: string; keyframes: Keyframe[]; uploadUrl?: string;
}
export function buildVideoGenerationRequest(input: VideoGenerationInput, toRef: (v: string) => MediaRef): Record<string, unknown>;
```

Rules enforced by `buildVideoGenerationRequest` (each throws `Error` with a message naming the flag):

1. `resolution` must be 480p, 720p or 1080p.
2. R2V = `refs.length > 0 || voices.length > 0 || lastFrame !== undefined || keyframes.length > 0` (docs: any reference image, voice, `last_frame` or keyframe makes the request reference-to-video; live: last_frame-only at 1080p is refused as R2V). A first-frame `image` alone stays I2V.
3. With known rules: refs > maxReferenceImages → "supports at most N reference images" (lite: "does not support --ref");
   voices > maxVoices → same pattern (`--voice`); `lastFrame`/`keyframes` without framePins → "--last-frame/--keyframe need grok-imagine-video-1.5";
   resolution not in rules.resolutions → error; R2V and resolution 1080p → "reference-to-video is capped at 720p";
   R2V and duration > referenceMaxDuration → "capped at N seconds".
4. `image` together with refs on a model without framePins → keep the old base-model error (xAI 400s mixed modes there).
5. keyframes: at most 4; each 0 < t < duration; slots = round(t*3); duplicate slots → "keyframes must be at least 1/3 s apart".
6. Prompt is required unless `image`, `lastFrame` or a keyframe is present (docs: prompt optional when a frame is pinned or for I2V).
7. Body: `{model, prompt?, aspect_ratio, resolution, [durationField]: duration, image?, reference_images?, reference_audios?: [{voice_id}], last_frame?, keyframes?: [{image, timestamp_s}], output?: {upload_url}}`.

Also export `normalizeVideoProgress(p: number): number` returning 0..100: the wire value is an
integer percent (live sequence 1, 10, 50, 100), so the function only rounds and clamps to 0..100.
No fraction heuristic: 1 means 1 %.

## 2. MODIFY `src/commands/video.ts`

- `DEFAULT_VIDEO_MODEL` import stays for generate; edit/extend use new `VIDEO_EDIT_MODEL`.
- Generate options:
  - `.argument("[prompt]")` stays; action shows help only when prompt, --image, --last-frame and --keyframe are all absent.
  - `--resolution <r>` help: "480p, 720p or 1080p (1080p: T2V/I2V on 1.5 and 1.5-lite)".
  - `--ref <input>` help: "reference image for reference-to-video (repeatable; 14 on 1.5, 7 on grok-imagine-video, none on lite)".
  - NEW `--voice <voice_id>` repeatable (collectRefs): "preset voice for reference_audios (1.5 only, max 3)".
  - NEW `--last-frame <input>`: "pin the final frame (1.5 only)".
  - NEW `--keyframe <input@seconds>` repeatable: "pin an image at a timestamp (1.5 only, max 4)".
- `generateAction`: keep the duration and timeout parsing (video.ts:160-161); delete the mode checks (video.ts:164-176), including the 1.5 T2V/R2V block, and
  call `buildVideoGenerationRequest(..., (v) => mediaRef(v, "image"))`.
- `pollUntilDone`: print `normalizeVideoProgress(data.progress)` instead of `progress * 100`.
- edit/extend: error text "only supported by grok-imagine-video" (drop "1.5-preview"); guard with
  `videoRulesFor(model) && model !== VIDEO_EDIT_MODEL` semantics → keep `model.includes("1.5")` check but cover lite too.

## 3. MODIFY `src/auth/constants.ts`

```diff
-export const DEFAULT_IMAGE_MODEL = "grok-imagine-image";
-export const DEFAULT_VIDEO_MODEL = "grok-imagine-video";
+export const DEFAULT_IMAGE_MODEL = "grok-imagine-image-2.0";
+export const DEFAULT_VIDEO_MODEL = "grok-imagine-video-1.5";
+/** The only model that supports /videos/edits and /videos/extensions. */
+export const VIDEO_EDIT_MODEL = "grok-imagine-video";
```

## 4. MODIFY `src/commands/image.ts` and `src/surfaces/images.ts`

- `ImageRequest` gains `quality?: "low" | "medium" | "auto"`.
- NEW option `--quality <q>` (no default): low|medium|auto; any other value throws
  "--quality must be low, medium or auto (grok-imagine-image-2.0)". With a model that does not
  contain "image-2" the flag throws "--quality needs grok-imagine-image-2.0".
- `--resolution` help "1k, 1.5k or 2k"; validate the three values.
- `--aspect` help lists 21:9 and 5:2.
- refs > 5 → "image editing accepts at most 5 source images".
- Output extension: NEW helper `imageExtension(item: {mime_type?: string}, bytes: Buffer): "jpg"|"png"|"webp"`
  (mime first, then magic bytes ffd8 / 89504e47 / RIFF…WEBP, default "jpg"). Default name
  `progrok-image${suffix}.${ext}`. A user `--output` path is honoured as given.
- Help example: replace `--model grok-imagine-image-quality --resolution 2k` with `--quality medium --resolution 2k`.

## 5. MODIFY web client (minimal)

- `src/web/public/index.html`: `#video-resolution` gains `<option value="1080p">1080p</option>`.
- `src/web/client/media.ts`: the 1080p option is enabled only when the selected model's rules list 1080p
  (imported from `src/utils/video-rules.ts`; never from `commands/`). Switching to grok-imagine-video while 1080p is
  selected falls back to 720p. The web form has no reference inputs, so web requests are T2V only.
- `src/web/client/media.ts:217-220`: progress becomes `clamp(progress / 100)`, fixing 1 % shown as 100 %.
- Screen-level test (tests/webapp.test.ts style): with grok-imagine-video the 1080p option is disabled and a submitted
  request never carries 1080p; with grok-imagine-video-1.5 it is enabled and the request carries 1080p; a job reporting
  progress 1 renders "1%".

## 6. Tests (write first, see them fail on 9014310)

Failing-first must be shown at the CLI action level, not only on the new helper (which cannot be
imported at HEAD). tests/video-cli.test.ts (NEW) mocks `../src/surfaces/videos.ts` with node:test
`mock.module` (pattern: tests/voice-cli.test.ts) and runs `videoCommand().parseAsync([...])`:
- `video "prompt" --model grok-imagine-video-1.5` reaches `start("generations", body)` with no image (HEAD exits on the 1.5 block).
- `--model grok-imagine-video-1.5` with 8 `--ref` values is sent (HEAD refuses more than 7).
- a fake poll sequence {pending, 1} then {done, 100} prints "1%" and never "100%" before done, nor "10000%".
- `--keyframe img.png@2 --last-frame end.png` sends `keyframes` and `last_frame` (HEAD: unknown option).

`tests/video-request.test.ts` (NEW):
- 1.5 T2V without image builds a body with no image (old CLI threw).
- 1.5 accepts 14 refs, rejects 15; base rejects 8; lite rejects any ref.
- 1.5 voices: `["eve","leo"]` → `reference_audios: [{voice_id:"eve"},{voice_id:"leo"}]`; 4 voices rejected; base/lite voices rejected.
- last_frame and keyframes only on 1.5; keyframe at 0 or ≥ duration rejected; 1.0 and 1.2 (same 1/3 slot) rejected; 5 keyframes rejected; `parseKeyframe("a@b.png@2.5")` → input "a@b.png", 2.5.
- R2V at 1080p rejected, including last_frame-only and keyframe-only requests; T2V and image-only I2V at 1080p on 1.5 and lite accepted; 1080p on base rejected.
- R2V duration 15 allowed on 1.5, 11 rejected on base.
- image + refs allowed on 1.5 (first-frame pin), rejected on base.
- prompt may be empty when image or last_frame given; otherwise required.
- aliases resolve to 1.5 rules; unknown model passes through without model checks.
- `normalizeVideoProgress`: 0->0, 1->1, 50->50, 100->100, 140->100, -3->0.

`tests/video.test.ts`: default model expectation → grok-imagine-video-1.5; edit/extend defaults stay grok-imagine-video; new options exist.

`tests/image.test.ts`: default model → grok-imagine-image-2.0; `--quality` exists with no default;
`imageExtension({mime_type:"image/jpeg"})` → jpg; PNG magic → png; unknown → jpg.
Add an action-level test with a mocked ImagesClient (node:test `mock.module`, same pattern as voice-cli.test.ts)
asserting the request carries `quality: "medium"` and that the saved file name ends in `.jpg`.

