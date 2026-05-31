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

function imageToDataUri(filePath: string): string {
  const abs = resolve(filePath);
  const buf = readFileSync(abs);
  const ext = abs.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  return `data:image/${ext};base64,${buf.toString("base64")}`;
}

export function videoCommand(): Command {
  return new Command("video")
    .description(
      `Generate video with Grok Imagine Video (T2V / I2V).
  Async: submits generation, polls until done, downloads result.

  Examples:
    $ progrok video "A cat playing piano"
    $ progrok video "Animate this photo" --image photo.jpg
    $ progrok video "prompt" --model grok-imagine-video-1.5-preview --duration 10`,
    )
    .argument("<prompt>", "video generation prompt")
    .option("--model <id>", "video model", DEFAULT_VIDEO_MODEL)
    .option("--duration <s>", "duration in seconds (1-15)", "5")
    .option("--aspect <ratio>", "aspect ratio", "16:9")
    .option("--resolution <r>", "480p or 720p", "480p")
    .option("--image <path>", "source image for image-to-video")
    .option("--output <path>", "output file path")
    .option("--json", "output structured JSON")
    .option("--timeout <s>", "polling timeout in seconds", "600")
    .action(async (prompt: string, opts: VideoOptions) => {
      try {
        const bearer = await getValidBearer();
        const duration = parseInt(opts.duration ?? "5", 10);
        const timeout = parseInt(opts.timeout ?? "600", 10) * 1000;

        // Build request body
        const body: Record<string, unknown> = {
          model: opts.model ?? DEFAULT_VIDEO_MODEL,
          prompt,
          duration,
          aspect_ratio: opts.aspect ?? "16:9",
          resolution: opts.resolution ?? "480p",
        };

        // I2V: attach source image
        if (opts.image) {
          const uri = opts.image.startsWith("data:")
            ? opts.image
            : imageToDataUri(opts.image);
          body.image = { url: uri };
        } else if (
          opts.model?.includes("1.5") &&
          !opts.image
        ) {
          // Video 1.5 T2V workaround: inject white canvas
          body.image = { url: WHITE_PIXEL_PNG };
          body.prompt = `${prompt}\n\nThis is not a start frame — generate freely as a new video.`;
        }

        // Submit generation
        const res = await fetch(`${XAI_API_BASE_URL}/videos/generations`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`);
        }

        const { request_id } = (await res.json()) as { request_id: string };
        if (!opts.json) {
          log.info(`Video generation started (${request_id})`);
          log.dim(`Model: ${body.model} | ${duration}s | ${opts.aspect} | ${opts.resolution}`);
        }

        // Poll
        const deadline = Date.now() + timeout;
        let lastProgress = -1;

        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

          const poll = await fetch(`${XAI_API_BASE_URL}/videos/${request_id}`, {
            headers: { Authorization: `Bearer ${bearer}` },
          });

          if (!poll.ok) {
            throw new Error(`Poll HTTP ${poll.status}: ${(await poll.text()).slice(0, 200)}`);
          }

          const data = (await poll.json()) as {
            status: string;
            progress?: number;
            video?: { url: string; duration: number; respect_moderation: boolean };
            error?: { code: string; message: string };
            usage?: { cost_in_usd_ticks?: number };
          };

          if (data.status === "done" && data.video) {
            if (opts.json) {
              console.log(JSON.stringify(data, null, 2));
              return;
            }

            // Download video
            const videoRes = await fetch(data.video.url);
            if (!videoRes.ok) throw new Error(`Download failed: HTTP ${videoRes.status}`);
            const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

            const outPath = opts.output ?? `progrok-video-${request_id.slice(0, 8)}.mp4`;
            writeFileSync(outPath, videoBuffer);

            log.success(`\nVideo saved: ${outPath}`);
            log.info(`Duration: ${data.video.duration}s`);
            if (data.usage?.cost_in_usd_ticks) {
              log.dim(`Cost: $${(data.usage.cost_in_usd_ticks / 10_000_000_000).toFixed(4)}`);
            }
            return;
          }

          if (data.status === "failed") {
            throw new Error(
              `Generation failed: ${data.error?.code ?? "unknown"} — ${data.error?.message ?? ""}`,
            );
          }

          if (data.status === "expired") {
            throw new Error("Generation expired");
          }

          // Progress display
          if (!opts.json && data.progress !== undefined && data.progress !== lastProgress) {
            lastProgress = data.progress;
            process.stdout.write(`\r  Progress: ${Math.round(data.progress * 100)}%`);
          }
        }

        throw new Error(`Timeout after ${timeout / 1000}s — video still pending`);
      } catch (err) {
        log.error((err as Error).message);
        process.exit(1);
      }
    });
}
