export type VideoResolution = "480p" | "720p" | "1080p";
export interface VideoModelRules {
  maxReferenceImages: number;
  referenceMaxDuration: number;
  maxVoices: number;
  framePins: boolean;
  resolutions: readonly VideoResolution[];
  referenceMaxResolution: VideoResolution;
}
export const VIDEO_MODEL_RULES: Record<string, VideoModelRules> = {
  "grok-imagine-video": { maxReferenceImages: 7, referenceMaxDuration: 10, maxVoices: 0, framePins: false, resolutions: ["480p", "720p"], referenceMaxResolution: "720p" },
  "grok-imagine-video-1.5": { maxReferenceImages: 14, referenceMaxDuration: 15, maxVoices: 3, framePins: true, resolutions: ["480p", "720p", "1080p"], referenceMaxResolution: "720p" },
  "grok-imagine-video-1.5-lite": { maxReferenceImages: 0, referenceMaxDuration: 0, maxVoices: 0, framePins: false, resolutions: ["480p", "720p", "1080p"], referenceMaxResolution: "720p" },
};
export const VIDEO_MODEL_ALIASES: Record<string, string> = {
  "grok-imagine-video-1.5-preview": "grok-imagine-video-1.5",
  "grok-imagine-video-1.5-2026-05-30": "grok-imagine-video-1.5",
};
export function videoRulesFor(model: string): VideoModelRules | undefined {
  return VIDEO_MODEL_RULES[VIDEO_MODEL_ALIASES[model] ?? model];
}
export function normalizeVideoProgress(p: number): number {
  return Math.max(0, Math.min(100, Math.round(p)));
}
export function keyframeSlot(seconds: number): number { return Math.round(seconds * 3); }
