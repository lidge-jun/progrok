import { Command } from "commander";
import {
  DEFAULT_VIDEO_MODEL,
  VIDEO_EDIT_MODEL,
  VIDEO_POLL_INTERVAL_MS,
  VIDEO_DEFAULT_TIMEOUT_S,
  USD_TICKS_DIVISOR,
} from "../auth/constants.js";
import { VideosClient } from "../surfaces/index.js";
import type { VideoPollResponse } from "../surfaces/videos.js";
import { createXaiTransport } from "../transport/fetch.js";
import { log } from "../utils/logger.js";
import { writeFileSync } from "node:fs";
import { mediaRef } from "../utils/media.js";
import { collectRefs } from "../utils/collect-refs.js";
import { buildVideoGenerationRequest, parseKeyframe } from "./video-request.js";
import { normalizeVideoProgress, videoRulesFor } from "../utils/video-rules.js";
import { parseIntOrThrow } from "../utils/parse-int.js";

export interface VideoOptions {
  model?: string;
  duration?: string;
  seconds?: string;
  aspect?: string;
  resolution?: string;
  image?: string;
  ref?: string[];
  voice?: string[];
  lastFrame?: string;
  keyframe?: string[];
  uploadUrl?: string;
  output?: string;
  json?: boolean;
  timeout?: string;
}

export interface VideoEditOptions {
  model?: string;
  video: string;
  uploadUrl?: string;
  output?: string;
  json?: boolean;
  timeout?: string;
}

export interface VideoExtendOptions {
  model?: string;
  video: string;
  duration?: string;
  uploadUrl?: string;
  output?: string;
  json?: boolean;
  timeout?: string;
}



async function pollUntilDone(
  client: VideosClient,
  requestId: string,
  timeout: number,
  json?: boolean,
): Promise<VideoPollResponse> {
  const deadline = Date.now() + timeout;
  let lastProgress = -1;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));

    const data = await client.poll(requestId);

    if (data.status === "done") return data;
    if (data.status === "failed") {
      throw new Error(`Generation failed: ${JSON.stringify(data.error ?? "unknown")}`);
    }
    if (data.status === "expired") throw new Error("Generation expired");

    if (!json && typeof data.progress === "number" && data.progress !== lastProgress) {
      lastProgress = data.progress;
      process.stdout.write(`\r  Progress: ${normalizeVideoProgress(lastProgress)}%`);
    }
  }

  throw new Error(`Timeout after ${timeout / 1000}s — video still pending`);
}

async function downloadAndSave(videoUrl: string, outPath: string): Promise<void> {
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`Download failed: HTTP ${videoRes.status}`);
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
  writeFileSync(outPath, videoBuffer);
}

export function videoCommand(): Command {
  const cmd = new Command("video")
    .enablePositionalOptions()
    .description(
      `Generate, edit, or extend video with Grok Imagine Video.

  Subcommands:
    generate (default)  Text-to-video, image-to-video, or reference-to-video
    edit                Edit existing video with text prompt (V2V)
    extend              Continue video from its last frame

  Examples:
    $ progrok video "A cat playing piano"
    $ progrok video "Animate this" --image photo.jpg
    $ progrok video "Use this character" --ref person.png --ref outfit.png
    $ progrok video edit "Make it sunset colors" --video input.mp4
    $ progrok video extend "Camera pulls back slowly" --video input.mp4 --duration 5`,
    );

  // Default action: generate
  cmd
    .argument("[prompt]", "video generation prompt")
    .option("--model <id>", "video model", DEFAULT_VIDEO_MODEL)
    .option("--duration <s>", "duration in seconds (1-15)", "5")
    .option("--seconds <s>", "OpenAI-compatible duration alias; sends 'seconds' instead of 'duration'")
    .option("--aspect <ratio>", "aspect ratio", "16:9")
    .option("--resolution <r>", "480p, 720p or 1080p (1080p: T2V/I2V on 1.5 and 1.5-lite)", "480p")
    .option("--image <input>", "source image for image-to-video: file, URL, data URI, or file_id:<id>")
    .option("--ref <input>", "reference image for reference-to-video (repeatable; 14 on 1.5, 7 on grok-imagine-video, none on lite)", collectRefs, [])
    .option("--voice <voice_id>", "preset voice for reference_audios (1.5 only, max 3)", collectRefs, [])
    .option("--last-frame <input>", "pin the final frame (1.5 only)")
    .option("--keyframe <input@seconds>", "pin an image at a timestamp (1.5 only, max 4)", collectRefs, [])
    .option("--upload-url <url>", "signed output.upload_url for xAI to PUT the result")
    .option("--output <path>", "output file path")
    .option("--json", "output structured JSON")
    .option("--timeout <s>", "polling timeout in seconds", String(VIDEO_DEFAULT_TIMEOUT_S))
    .action(async (prompt: string | undefined, opts: VideoOptions) => {
      if (!prompt && !opts.image && !opts.lastFrame && !opts.keyframe?.length) { cmd.help(); return; }
      await generateAction(prompt, opts);
    });

  // Edit subcommand
  cmd
    .command("edit <prompt>")
    .description("Edit existing video with a text prompt (real V2V). Model: grok-imagine-video only.")
    .requiredOption("--video <input>", "source video: file, URL, data URI, or file_id:<id>")
    .option("--model <id>", "video model (must be grok-imagine-video)", VIDEO_EDIT_MODEL)
    .option("--upload-url <url>", "signed output.upload_url for xAI to PUT the result")
    .option("--output <path>", "output file path")
    .option("--json", "output structured JSON")
    .option("--timeout <s>", "polling timeout in seconds", String(VIDEO_DEFAULT_TIMEOUT_S))
    .action(async (prompt: string, opts: VideoEditOptions) => {
      await editAction(prompt, opts);
    });

  // Extend subcommand
  cmd
    .command("extend <prompt>")
    .description("Extend video from its last frame. Model: grok-imagine-video only.")
    .requiredOption("--video <input>", "source video: file, URL, data URI, or file_id:<id>")
    .option("--model <id>", "video model (must be grok-imagine-video)", VIDEO_EDIT_MODEL)
    .option("--duration <s>", "extension duration 2-10s (default 6)", "6")
    .option("--upload-url <url>", "signed output.upload_url for xAI to PUT the result")
    .option("--output <path>", "output file path")
    .option("--json", "output structured JSON")
    .option("--timeout <s>", "polling timeout in seconds", String(VIDEO_DEFAULT_TIMEOUT_S))
    .action(async (prompt: string, opts: VideoExtendOptions) => {
      await extendAction(prompt, opts);
    });

  return cmd;
}

async function generateAction(prompt: string | undefined, opts: VideoOptions): Promise<void> {
  try {
    const client = new VideosClient(createXaiTransport());
    const duration = parseIntOrThrow(opts.seconds ?? opts.duration ?? "5", "duration", 1, 15);
    const timeout = parseIntOrThrow(opts.timeout ?? String(VIDEO_DEFAULT_TIMEOUT_S), "timeout", 1) * 1000;
    const body = buildVideoGenerationRequest({
      model: opts.model ?? DEFAULT_VIDEO_MODEL, prompt, duration,
      durationField: opts.seconds ? "seconds" : "duration", aspect: opts.aspect ?? "16:9",
      resolution: opts.resolution ?? "480p", image: opts.image, refs: opts.ref ?? [],
      voices: opts.voice ?? [], lastFrame: opts.lastFrame,
      keyframes: (opts.keyframe ?? []).map(parseKeyframe), uploadUrl: opts.uploadUrl,
    }, (value) => mediaRef(value, "image"));

    const { requestId } = await client.start("generations", body);
    if (!opts.json) {
      log.info(`Video generation started (${requestId})`);
      log.dim(`Model: ${body.model} | ${duration}s | ${opts.aspect} | ${opts.resolution}`);
    }

    const data = await pollUntilDone(client, requestId, timeout, opts.json);
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }

    const video = data.video;
    if (!video) throw new Error("No video in response");

    const outPath = opts.output ?? `progrok-video-${requestId.slice(0, 8)}.mp4`;
    await downloadAndSave(video.url, outPath);
    if (!opts.json) process.stdout.write("\n");
    log.success(`Video saved: ${outPath}`);
    log.info(`Duration: ${video.duration}s`);
    const usage = data.raw.usage as { cost_in_usd_ticks?: number } | undefined;
    if (usage?.cost_in_usd_ticks) log.dim(`Cost: $${(usage.cost_in_usd_ticks / USD_TICKS_DIVISOR).toFixed(4)}`);
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
}

async function editAction(prompt: string, opts: VideoEditOptions): Promise<void> {
  try {
    const client = new VideosClient(createXaiTransport());
    const timeout = parseIntOrThrow(opts.timeout ?? String(VIDEO_DEFAULT_TIMEOUT_S), "timeout", 1) * 1000;
    const model = opts.model ?? VIDEO_EDIT_MODEL;

    if (videoRulesFor(model) && model !== VIDEO_EDIT_MODEL) {
      throw new Error("Video editing is only supported by grok-imagine-video.");
    }

    const sourceVideo = mediaRef(opts.video, "video");

    const { requestId } = await client.start("edits", {
      model,
      prompt,
      video: sourceVideo,
      ...(opts.uploadUrl ? { output: { upload_url: opts.uploadUrl } } : {}),
    });
    if (!opts.json) {
      log.info(`Video edit started (${requestId})`);
      log.dim(`Model: ${model} | Edit: "${prompt.slice(0, 60)}"`);
    }

    const data = await pollUntilDone(client, requestId, timeout, opts.json);
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }

    const outputVideo = data.video;
    if (!outputVideo) throw new Error("No video in response");

    const outPath = opts.output ?? `progrok-edit-${requestId.slice(0, 8)}.mp4`;
    await downloadAndSave(outputVideo.url, outPath);
    if (!opts.json) process.stdout.write("\n");
    log.success(`Edited video saved: ${outPath}`);
    log.info(`Duration: ${outputVideo.duration}s`);
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
}

async function extendAction(prompt: string, opts: VideoExtendOptions): Promise<void> {
  try {
    const client = new VideosClient(createXaiTransport());
    const timeout = parseIntOrThrow(opts.timeout ?? String(VIDEO_DEFAULT_TIMEOUT_S), "timeout", 1) * 1000;
    const duration = parseIntOrThrow(opts.duration ?? "6", "duration", 2, 10);
    const model = opts.model ?? VIDEO_EDIT_MODEL;

    if (videoRulesFor(model) && model !== VIDEO_EDIT_MODEL) {
      throw new Error("Video extension is only supported by grok-imagine-video.");
    }

    const sourceVideo = mediaRef(opts.video, "video");

    const { requestId } = await client.start("extensions", {
      model,
      prompt,
      duration,
      video: sourceVideo,
      ...(opts.uploadUrl ? { output: { upload_url: opts.uploadUrl } } : {}),
    });
    if (!opts.json) {
      log.info(`Video extension started (${requestId})`);
      log.dim(`Model: ${model} | Extend: +${duration}s | "${prompt.slice(0, 60)}"`);
    }

    const data = await pollUntilDone(client, requestId, timeout, opts.json);
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }

    const outputVideo = data.video;
    if (!outputVideo) throw new Error("No video in response");

    const outPath = opts.output ?? `progrok-extend-${requestId.slice(0, 8)}.mp4`;
    await downloadAndSave(outputVideo.url, outPath);
    if (!opts.json) process.stdout.write("\n");
    log.success(`Extended video saved: ${outPath}`);
    log.info(`Total duration: ${outputVideo.duration}s (original + ${duration}s extension)`);
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
}
