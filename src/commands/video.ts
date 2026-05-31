import { Command } from "commander";
import { getValidBearer } from "../auth/token-store.js";
import { XAI_API_BASE_URL } from "../auth/constants.js";
import { log } from "../utils/logger.js";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const DEFAULT_VIDEO_MODEL = "grok-imagine-video";
const POLL_INTERVAL_MS = 5000;

// 1x1 white PNG for video 1.5 T2V workaround
const WHITE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwAHBQKhPX8EOAAAAABJRU5ErkJggg==";

export interface VideoOptions {
  model?: string;
  duration?: string;
  aspect?: string;
  resolution?: string;
  image?: string;
  output?: string;
  json?: boolean;
  timeout?: string;
}

export interface VideoEditOptions {
  model?: string;
  video: string;
  output?: string;
  json?: boolean;
  timeout?: string;
}

export interface VideoExtendOptions {
  model?: string;
  video: string;
  duration?: string;
  output?: string;
  json?: boolean;
  timeout?: string;
}

function imageToDataUri(filePath: string): string {
  const abs = resolve(filePath);
  const buf = readFileSync(abs);
  const ext = abs.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  return `data:image/${ext};base64,${buf.toString("base64")}`;
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
    .description(
      `Generate, edit, or extend video with Grok Imagine Video.

  Subcommands:
    generate (default)  Text-to-video or image-to-video
    edit                Edit existing video with text prompt (V2V)
    extend              Continue video from its last frame

  Examples:
    $ progrok video "A cat playing piano"
    $ progrok video "Animate this" --image photo.jpg
    $ progrok video edit "Make it sunset colors" --video input.mp4
    $ progrok video extend "Camera pulls back slowly" --video input.mp4 --duration 5`,
    );

  // Default action: generate
  cmd
    .argument("[prompt]", "video generation prompt")
    .option("--model <id>", "video model", DEFAULT_VIDEO_MODEL)
    .option("--duration <s>", "duration in seconds (1-15)", "5")
    .option("--aspect <ratio>", "aspect ratio", "16:9")
    .option("--resolution <r>", "480p or 720p", "480p")
    .option("--image <path>", "source image for image-to-video")
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
    .requiredOption("--video <url-or-path>", "source video URL or local .mp4 path")
    .option("--model <id>", "video model (must be grok-imagine-video)", DEFAULT_VIDEO_MODEL)
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
    .requiredOption("--video <url-or-path>", "source video URL or local .mp4 path")
    .option("--model <id>", "video model (must be grok-imagine-video)", DEFAULT_VIDEO_MODEL)
    .option("--duration <s>", "extension duration 2-10s (default 6)", "6")
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
    const duration = parseInt(opts.duration ?? "5", 10);
    const timeout = parseInt(opts.timeout ?? "600", 10) * 1000;

    const body: Record<string, unknown> = {
      model: opts.model ?? DEFAULT_VIDEO_MODEL,
      prompt,
      duration,
      aspect_ratio: opts.aspect ?? "16:9",
      resolution: opts.resolution ?? "480p",
    };

    if (opts.image) {
      const uri = opts.image.startsWith("data:") ? opts.image : imageToDataUri(opts.image);
      body.image = { url: uri };
    } else if (opts.model?.includes("1.5") && !opts.image) {
      body.image = { url: WHITE_PIXEL_PNG };
      body.prompt = `${prompt}\n\nThis is not a start frame — generate freely as a new video.`;
    }

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

    const videoUrl = opts.video.startsWith("http") ? opts.video : (() => {
      throw new Error("--video must be a URL (local file upload not yet supported for editing).");
    })();

    const res = await fetch(`${XAI_API_BASE_URL}/videos/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, video: { url: videoUrl } }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const { request_id } = (await res.json()) as { request_id: string };
    if (!opts.json) {
      log.info(`Video edit started (${request_id})`);
      log.dim(`Model: ${model} | Edit: "${prompt.slice(0, 60)}"`);
    }

    const data = await pollUntilDone(request_id, bearer, timeout, opts.json);
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }

    const video = data.video as { url: string; duration: number } | undefined;
    if (!video) throw new Error("No video in response");

    const outPath = opts.output ?? `progrok-edit-${request_id.slice(0, 8)}.mp4`;
    await downloadAndSave(video.url, outPath);
    if (!opts.json) process.stdout.write("\n");
    log.success(`Edited video saved: ${outPath}`);
    log.info(`Duration: ${video.duration}s`);
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

    const videoUrl = opts.video.startsWith("http") ? opts.video : (() => {
      throw new Error("--video must be a URL (local file upload not yet supported for extension).");
    })();

    const res = await fetch(`${XAI_API_BASE_URL}/videos/extensions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, duration, video: { url: videoUrl } }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const { request_id } = (await res.json()) as { request_id: string };
    if (!opts.json) {
      log.info(`Video extension started (${request_id})`);
      log.dim(`Model: ${model} | Extend: +${duration}s | "${prompt.slice(0, 60)}"`);
    }

    const data = await pollUntilDone(request_id, bearer, timeout, opts.json);
    if (opts.json) { console.log(JSON.stringify(data, null, 2)); return; }

    const video = data.video as { url: string; duration: number } | undefined;
    if (!video) throw new Error("No video in response");

    const outPath = opts.output ?? `progrok-extend-${request_id.slice(0, 8)}.mp4`;
    await downloadAndSave(video.url, outPath);
    if (!opts.json) process.stdout.write("\n");
    log.success(`Extended video saved: ${outPath}`);
    log.info(`Total duration: ${video.duration}s (original + ${duration}s extension)`);
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }
}
