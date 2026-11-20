import type { MediaRef } from "../utils/media.js";
import { keyframeSlot, videoRulesFor, type VideoResolution } from "../utils/video-rules.js";
export interface Keyframe { input: string; timestampS: number }
export function parseKeyframe(value: string): Keyframe {
  const index = value.lastIndexOf("@");
  const input = value.slice(0, index);
  const timestampS = Number(value.slice(index + 1));
  if (index < 1 || !value.slice(index + 1).trim() || !Number.isFinite(timestampS) || timestampS <= 0) throw new Error("--keyframe must be input@seconds with a positive timestamp");
  return { input, timestampS };
}
export interface VideoGenerationInput {
  model: string; prompt?: string; duration: number; durationField: "duration" | "seconds";
  aspect: string; resolution: string; image?: string; refs: string[]; voices: string[];
  lastFrame?: string; keyframes: Keyframe[]; uploadUrl?: string;
}
export function buildVideoGenerationRequest(input: VideoGenerationInput, toRef: (v: string) => MediaRef): Record<string, unknown> {
  const { model, prompt, duration, aspect, resolution, image, refs, voices, lastFrame, keyframes, uploadUrl } = input;
  if (!["480p", "720p", "1080p"].includes(resolution)) throw new Error("--resolution must be 480p, 720p or 1080p");
  const r2v = refs.length > 0 || voices.length > 0 || lastFrame !== undefined || keyframes.length > 0;
  const rules = videoRulesFor(model);
  if (rules) {
    if (refs.length > rules.maxReferenceImages) throw new Error(rules.maxReferenceImages ? `--ref supports at most ${rules.maxReferenceImages} reference images` : `${model} does not support --ref`);
    if (voices.length > rules.maxVoices) throw new Error(rules.maxVoices ? `--voice supports at most ${rules.maxVoices} voices` : `${model} does not support --voice`);
    if ((lastFrame !== undefined || keyframes.length) && !rules.framePins) throw new Error("--last-frame/--keyframe need grok-imagine-video-1.5");
    if (!rules.resolutions.includes(resolution as VideoResolution)) throw new Error(`--resolution ${resolution} is not supported by ${model}`);
    if (r2v && resolution === "1080p") throw new Error("--resolution for reference-to-video is capped at 720p");
    if (r2v && duration > rules.referenceMaxDuration) throw new Error(`--duration for reference-to-video is capped at ${rules.referenceMaxDuration} seconds`);
    if (image && refs.length && !rules.framePins) throw new Error("--image and --ref/reference_images cannot be combined; xAI returns 400 for mixed modes.");
  }
  if (keyframes.length > 4) throw new Error("--keyframe supports at most 4 keyframes");
  const slots = new Set<number>();
  for (const frame of keyframes) {
    if (!Number.isFinite(frame.timestampS) || frame.timestampS <= 0 || frame.timestampS >= duration) throw new Error("--keyframe timestamp must be greater than 0 and less than --duration");
    const slot = keyframeSlot(frame.timestampS);
    // xAI snaps anchors to a 1/3 s grid and rejects two that share a slot.
    if (slots.has(slot)) throw new Error("--keyframe timestamps must not round to the same 1/3 s slot (xAI snaps keyframes to a 1/3 s grid)");
    slots.add(slot);
  }
  if (!prompt && !image && lastFrame === undefined && keyframes.length === 0) throw new Error("prompt is required unless a frame is pinned");
  return { model, ...(prompt ? { prompt } : {}), aspect_ratio: aspect, resolution, [input.durationField]: duration,
    ...(image ? { image: toRef(image) } : {}), ...(refs.length ? { reference_images: refs.map(toRef) } : {}),
    ...(voices.length ? { reference_audios: voices.map(voice_id => ({ voice_id })) } : {}),
    ...(lastFrame !== undefined ? { last_frame: toRef(lastFrame) } : {}),
    ...(keyframes.length ? { keyframes: keyframes.map(frame => ({ image: toRef(frame.input), timestamp_s: frame.timestampS })) } : {}),
    ...(uploadUrl ? { output: { upload_url: uploadUrl } } : {}) };
}
