import { Command } from "commander";
import { getValidBearer } from "../auth/token-store.js";
import { XAI_API_BASE_URL } from "../auth/constants.js";
import { log } from "../utils/logger.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const DEFAULT_VIDEO_MODEL = "grok-imagine-video";
const POLL_INTERVAL_MS = 5000;

export interface VideoOptions {
  model?: string;
  duration?: string;
  seconds?: string;
  aspect?: string;
  resolution?: string;
  image?: string;
  ref?: string[];
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

interface MediaRef {
  url?: string;
  file_id?: string;
}

function fileToDataUri(filePath: string, mediaKind: "image" | "video"): string {
  const abs = resolve(filePath);
  const buf = readFileSync(abs);
  const ext = extname(abs).toLowerCase();
  const mime =
    mediaKind === "image"
      ? ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "image/jpeg"
      : ext === ".webm"
        ? "video/webm"
        : ext === ".mov"
          ? "video/quicktime"
          : "video/mp4";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function mediaRef(input: string, mediaKind: "image" | "video"): MediaRef {
  if (input.startsWith("file_id:")) return { file_id: input.slice("file_id:".length) };
  if (input.startsWith("http://") || input.startsWith("https://") || input.startsWith("data:")) {
    return { url: input };
  }
  if (existsSync(resolve(input))) return { url: fileToDataUri(input, mediaKind) };
  if (/^file[-_]/.test(input)) return { file_id: input };
  throw new Error(
    `${mediaKind} input must be a local file, URL, data URI, or file_id:<id>. Got: ${input}`,
  );
}

async function pollUntilDone(requestId: string, bearer: string, timeout: number, json?: boolean): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeout;
  let lastProgress = -1;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const poll = await fetch(`${XAI_API_BASE_URL}/videos/${requestId}`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });

    if (!poll.ok) {
      throw new Error(`Poll HTTP ${poll.status}: ${(await poll.text()).slice(0, 200)}`);
    }

    const data = (await poll.json()) as Record<string, unknown>;
    const status = data.status as string;

    if (status === "done") return data;
    if (status === "failed") {
      const err = data.error as { code?: string; message?: string } | undefined;
      throw new Error(`Generation failed: ${err?.code ?? "unknown"} — ${err?.message ?? ""}`);
    }
    if (status === "expired") throw new Error("Generation expired");

    if (!json && typeof data.progress === "number" && data.progress !== lastProgress) {
      lastProgress = data.progress as number;
      process.stdout.write(`\r  Progress: ${Math.round(lastProgress * 100)}%`);
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
    .option("--resolution <r>", "480p or 720p (1080p is conflicting/experimental)", "480p")
    .option("--image <input>", "source image for image-to-video: file, URL, data URI, or file_id:<id>")
    .option("--ref <input>", "reference image for reference-to-video (repeatable, max 7)", collectRefs, [])
    .option("--upload-url <url>", "signed output.upload_url for xAI to PUT the result")
    .option("--output <path>", "output file path")
    .option("--json", "output structured JSON")
    .option("--timeout <s>", "polling timeout in seconds", "600")
    .action(async (prompt: string | undefined, opts: VideoOptions) => {
      if (!prompt) { cmd.help(); return; }
      await generateAction(prompt, opts);
    });

  // Edit subcommand
  cmd
    .command("edit <prompt>")
    .description("Edit existing video with a text prompt (real V2V). Model: grok-imagine-video only.")
    .requiredOption("--video <input>", "source video: file, URL, data URI, or file_id:<id>")
    .option("--model <id>", "video model (must be grok-imagine-video)", DEFAULT_VIDEO_MODEL)
    .option("--upload-url <url>", "signed output.upload_url for xAI to PUT the result")
    .option("--output <path>", "output file path")
    .option("--json", "output structured JSON")
    .option("--timeout <s>", "polling timeout in seconds", "600")
    .action(async (prompt: string, opts: VideoEditOptions) => {
      await editAction(prompt, opts);
    });

  // Extend subcommand
  cmd
    .command("extend <prompt>")
    .description("Extend video from its last frame. Model: grok-imagine-video only.")
    .requiredOption("--video <input>", "source video: file, URL, data URI, or file_id:<id>")
    .option("--model <id>", "video model (must be grok-imagine-video)", DEFAULT_VIDEO_MODEL)
    .option("--duration <s>", "extension duration 2-10s (default 6)", "6")
    .option("--upload-url <url>", "signed output.upload_url for xAI to PUT the result")
    .option("--output <path>", "output file path")
    .option("--json", "output structured JSON")
    .option("--timeout <s>", "polling timeout in seconds", "600")
    .action(async (prompt: string, opts: VideoExtendOptions) => {
      await extendAction(prompt, opts);
    });

  return cmd;
}

async function generateAction(prompt: string, opts: VideoOptions): Promise<void> {
  try {
    const bearer = await getValidBearer();
    const duration = parseInt(opts.seconds ?? opts.duration ?? "5", 10);
    const timeout = parseInt(opts.timeout ?? "600", 10) * 1000;
    const refs = opts.ref ?? [];

    if (opts.image && refs.length > 0) {
      throw new Error("--image and --ref/reference_images cannot be combined; xAI returns 400 for mixed modes.");
    }
    if (refs.length > 7) {
      throw new Error("Reference-to-video supports at most 7 reference images.");
    }
    if (refs.length > 0 && duration > 10) {
      throw new Error("Reference-to-video duration is capped at 10 seconds.");
    }
    if (duration < 1 || duration > 15) {
      throw new Error("Video generation duration must be 1-15 seconds.");
    }

    const body: Record<string, unknown> = {
      model: opts.model ?? DEFAULT_VIDEO_MODEL,
      prompt,
      aspect_ratio: opts.aspect ?? "16:9",
      resolution: opts.resolution ?? "480p",
    };
    body[opts.seconds ? "seconds" : "duration"] = duration;

    if (opts.image) {
      body.image = mediaRef(opts.image, "image");
    } else if (refs.length > 0) {
      body.reference_images = refs.map((ref) => mediaRef(ref, "image"));
    }
    if (opts.uploadUrl) body.output = { upload_url: opts.uploadUrl };

    const res = await fetch(`${XAI_API_BASE_URL}/videos/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const { request_id } = (await res.json()) as { request_id: string };
    if (!opts.json) {
      log.info(`Video generation started (${request_id})`);
      log.dim(`Model: ${body.model} | ${duration}s | ${opts.aspect} | ${opts.resolution}`);
    }

    const data = await pollUntilDone(request_id, bearer, timeout, opts.json);
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }

    const video = data.video as { url: string; duration: number } | undefined;
    if (!video) throw new Error("No video in response");

    const outPath = opts.output ?? `progrok-video-${request_id.slice(0, 8)}.mp4`;
    await downloadAndSave(video.url, outPath);
    if (!opts.json) process.stdout.write("\n");
    log.success(`Video saved: ${outPath}`);
    log.info(`Duration: ${video.duration}s`);
    const usage = data.usage as { cost_in_usd_ticks?: number } | undefined;
    if (usage?.cost_in_usd_ticks) log.dim(`Cost: $${(usage.cost_in_usd_ticks / 10_000_000_000).toFixed(4)}`);
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
}

async function editAction(prompt: string, opts: VideoEditOptions): Promise<void> {
  try {
    const bearer = await getValidBearer();
    const timeout = parseInt(opts.timeout ?? "600", 10) * 1000;
    const model = opts.model ?? DEFAULT_VIDEO_MODEL;

    if (model.includes("1.5")) {
      throw new Error("Video editing is only supported by grok-imagine-video (not 1.5-preview).");
    }

    const sourceVideo = mediaRef(opts.video, "video");

    const res = await fetch(`${XAI_API_BASE_URL}/videos/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, video: sourceVideo, ...(opts.uploadUrl ? { output: { upload_url: opts.uploadUrl } } : {}) }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const { request_id } = (await res.json()) as { request_id: string };
    if (!opts.json) {
      log.info(`Video edit started (${request_id})`);
      log.dim(`Model: ${model} | Edit: "${prompt.slice(0, 60)}"`);
    }

    const data = await pollUntilDone(request_id, bearer, timeout, opts.json);
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }

    const outputVideo = data.video as { url: string; duration: number } | undefined;
    if (!outputVideo) throw new Error("No video in response");

    const outPath = opts.output ?? `progrok-edit-${request_id.slice(0, 8)}.mp4`;
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
    const bearer = await getValidBearer();
    const timeout = parseInt(opts.timeout ?? "600", 10) * 1000;
    const duration = parseInt(opts.duration ?? "6", 10);
    const model = opts.model ?? DEFAULT_VIDEO_MODEL;

    if (model.includes("1.5")) {
      throw new Error("Video extension is only supported by grok-imagine-video (not 1.5-preview).");
    }
    if (duration < 2 || duration > 10) {
      throw new Error("Extension duration must be 2-10 seconds.");
    }

    const sourceVideo = mediaRef(opts.video, "video");

    const res = await fetch(`${XAI_API_BASE_URL}/videos/extensions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, duration, video: sourceVideo, ...(opts.uploadUrl ? { output: { upload_url: opts.uploadUrl } } : {}) }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const { request_id } = (await res.json()) as { request_id: string };
    if (!opts.json) {
      log.info(`Video extension started (${request_id})`);
      log.dim(`Model: ${model} | Extend: +${duration}s | "${prompt.slice(0, 60)}"`);
    }

    const data = await pollUntilDone(request_id, bearer, timeout, opts.json);
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }

    const outputVideo = data.video as { url: string; duration: number } | undefined;
    if (!outputVideo) throw new Error("No video in response");

    const outPath = opts.output ?? `progrok-extend-${request_id.slice(0, 8)}.mp4`;
    await downloadAndSave(outputVideo.url, outPath);
    if (!opts.json) process.stdout.write("\n");
    log.success(`Extended video saved: ${outPath}`);
    log.info(`Total duration: ${outputVideo.duration}s (original + ${duration}s extension)`);
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
}

function collectRefs(value: string, prev: string[]): string[] {
  return [...prev, value];
}
