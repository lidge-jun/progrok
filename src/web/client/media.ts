import { generateImages, readVideoJob, submitVideo } from "./api.js";
import type { ModelRecord, VideoJob } from "./contracts.js";

const VIDEO_POLL_MS = 2_000;
const VIDEO_TIMEOUT_MS = 10 * 60_000;

export interface MediaElements {
  kind: HTMLSelectElement;
  model: HTMLSelectElement;
  prompt: HTMLTextAreaElement;
  form: HTMLFormElement;
  submit: HTMLButtonElement;
  progress: HTMLProgressElement;
  status: HTMLElement;
  results: HTMLElement;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class MediaController {
  #active?: AbortController;
  #cancel?: HTMLButtonElement;

  constructor(
    private readonly el: MediaElements,
    private readonly models: ModelRecord[],
    private readonly signal?: AbortSignal,
  ) {}

  init(): void {
    const options = this.signal ? { signal: this.signal } : undefined;
    this.#cancel = this.el.form.querySelector<HTMLButtonElement>("#media-cancel") ??
      undefined;
    this.syncModels();
    this.el.kind.addEventListener("change", () => {
      this.#active?.abort();
      this.syncModels();
    }, options);
    this.el.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.run();
    }, options);
    this.#cancel?.addEventListener("click", () => this.#active?.abort(), options);
  }

  private syncModels(): void {
    const image = this.el.kind.value === "image";
    const needle = image ? "imagine-image" : "imagine-video";
    const matches = this.models.filter((model) => model.id.includes(needle));
    this.el.kind.disabled = false;
    this.el.prompt.disabled = false;
    this.el.model.replaceChildren(
      ...matches.map((model) => new Option(model.id, model.id)),
    );
    this.el.model.disabled = matches.length === 0;
    this.el.submit.disabled = matches.length === 0;
    this.el.progress.hidden = image;
    for (const field of this.el.form.querySelectorAll<HTMLElement>(
      ".media-options--image",
    )) {
      field.hidden = !image;
    }
    for (const field of this.el.form.querySelectorAll<HTMLElement>(
      ".media-options--video",
    )) {
      field.hidden = image;
    }
    this.el.status.textContent = matches.length > 0
      ? "Ready"
      : `No ${image ? "image" : "video"} model was returned by /v1/models.`;
  }

  private formNumber(selector: string, fallback: number): number {
    const field = this.el.form.querySelector<HTMLInputElement>(selector);
    const value = Number(field?.value);
    return Number.isFinite(value) ? value : fallback;
  }

  private formValue(selector: string, fallback: string): string {
    const field = this.el.form.querySelector<HTMLInputElement | HTMLSelectElement>(
      selector,
    );
    return field?.value || fallback;
  }

  private async run(): Promise<void> {
    this.#active?.abort();
    const active = new AbortController();
    this.#active = active;
    const request = Object.freeze({
      kind: this.el.kind.value,
      model: this.el.model.value,
      prompt: this.el.prompt.value,
      count: this.formNumber("#image-count", 1),
      duration: this.formNumber("#video-duration", 5),
      aspect: this.formValue("#video-aspect", "16:9"),
      resolution: this.formValue("#video-resolution", "480p"),
      startedAt: performance.now(),
    });
    this.el.submit.disabled = true;
    if (this.#cancel) this.#cancel.hidden = false;
    this.el.results.replaceChildren();
    this.el.status.textContent = "Submitting generation request";

    try {
      if (request.kind === "image") {
        const images = await generateImages({
          model: request.model,
          prompt: request.prompt,
          count: request.count,
        }, active.signal);
        const elapsed = this.elapsedSeconds(request.startedAt);
        for (const result of images) {
          const figure = document.createElement("figure");
          const image = new Image();
          image.src = result.url;
          image.alt = result.revisedPrompt ?? request.prompt;
          image.decoding = "async";
          figure.append(image);
          figure.append(this.caption(
            [request.model, `${images.length} image${images.length === 1 ? "" : "s"}`, `${elapsed}s`],
            result.revisedPrompt,
          ));
          this.el.results.append(figure);
        }
        this.el.status.textContent = `Created ${images.length} image${images.length === 1 ? "" : "s"}.`;
      } else {
        this.el.progress.removeAttribute("value");
        const requestId = await submitVideo({
          model: request.model,
          prompt: request.prompt,
          duration: request.duration,
          aspectRatio: request.aspect,
          resolution: request.resolution,
        }, active.signal);
        this.el.status.textContent = `Video job ${requestId} is pending.`;
        const job = await this.pollVideo(requestId, active.signal);
        if (!job.videoUrl) throw new Error("Completed video omitted video.url");
        const figure = document.createElement("figure");
        const video = document.createElement("video");
        video.src = job.videoUrl;
        video.controls = true;
        video.preload = "metadata";
        video.setAttribute("playsinline", "");
        video.setAttribute("aria-label", `Generated video for ${request.prompt}`);
        figure.append(video);
        figure.append(this.caption([
          request.model,
          `${request.duration}s`,
          request.aspect,
          request.resolution,
          `${this.elapsedSeconds(request.startedAt)}s`,
          `job ${requestId}`,
        ]));
        this.el.results.append(figure);
        this.el.status.textContent = `Video job ${requestId} is complete.`;
      }
    } catch (error) {
      if (active.signal.aborted) {
        this.el.status.textContent = "Generation stopped.";
      } else {
        this.el.status.textContent = error instanceof Error
          ? error.message
          : String(error);
      }
    } finally {
      if (this.#active === active) this.#active = undefined;
      this.el.submit.disabled = this.el.model.options.length === 0;
      if (this.#cancel) this.#cancel.hidden = true;
    }
  }

  private elapsedSeconds(startedAt: number): string {
    return ((performance.now() - startedAt) / 1000).toFixed(1);
  }

  private caption(parts: string[], detail?: string): HTMLElement {
    const caption = document.createElement("figcaption");
    const meta = document.createElement("span");
    meta.className = "mono";
    meta.textContent = parts.join(" · ");
    caption.append(meta);
    if (detail) {
      const line = document.createElement("span");
      line.textContent = detail;
      caption.append(line);
    }
    return caption;
  }

  private async pollVideo(
    requestId: string,
    signal: AbortSignal,
  ): Promise<VideoJob> {
    const deadline = Date.now() + VIDEO_TIMEOUT_MS;
    for (;;) {
      if (Date.now() >= deadline) {
        throw new Error(`Video job ${requestId} timed out after 10 minutes.`);
      }
      const job = await readVideoJob(requestId, signal);
      if (typeof job.progress === "number") {
        const normalized = job.progress > 1 ? job.progress / 100 : job.progress;
        this.el.progress.value = Math.max(0, Math.min(1, normalized));
        this.el.status.textContent = `Video job ${requestId}: ${Math.round(this.el.progress.value * 100)}%`;
      } else {
        this.el.progress.removeAttribute("value");
        this.el.status.textContent = `Video job ${requestId}: ${job.status}`;
      }
      if (job.status === "done") return job;
      if (job.status === "failed" || job.status === "expired") {
        throw new Error(job.error ?? `Video job ${requestId} ${job.status}.`);
      }
      await abortableDelay(VIDEO_POLL_MS, signal);
    }
  }
}
