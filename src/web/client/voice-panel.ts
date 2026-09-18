import type { VoiceMode, VoiceStatus } from "./contracts.js";
import { createVoiceMeter, type VoiceMeter } from "./voice-meter.js";

const STATUS_COPY: Record<VoiceStatus, string> = {
  idle: "Microphone is idle",
  "requesting-permission": "Waiting for microphone permission",
  "minting-secret": "Creating a one-use connection secret",
  connecting: "Connecting to xAI Voice",
  listening: "Listening",
  responding: "Preparing a reply",
  speaking: "Grok is speaking",
  stopped: "Voice stopped",
  failed: "Voice connection failed",
};

const EVENT_LOG_LIMIT = 30;
const FOLLOW_THRESHOLD_PX = 48;

export interface VoiceElements {
  mode: HTMLSelectElement;
  model: HTMLInputElement;
  voice: HTMLSelectElement;
  start: HTMLButtonElement;
  finish: HTMLButtonElement;
  stop: HTMLButtonElement;
  mute: HTMLButtonElement;
  status: HTMLElement;
  userTranscript: HTMLElement;
  assistantTranscript: HTMLElement;
  assistantTurn: HTMLElement;
  inputMeter: HTMLElement;
  outputMeter: HTMLElement;
  elapsedRow: HTMLElement;
  elapsed: HTMLElement;
  lastEventRow: HTMLElement;
  lastEvent: HTMLElement;
  transport: HTMLElement;
  endpointRow: HTMLElement;
  endpoint: HTMLElement;
  rateRow: HTMLElement;
  rate: HTMLElement;
  deviceRow: HTMLElement;
  device: HTMLElement;
  networkRow: HTMLElement;
  network: HTMLElement;
  events: HTMLElement;
}

interface VoiceControlHandlers {
  onStart(): void;
  onFinish(): void;
  onStop(): void;
  onToggleMute(): void;
  onModeChange(): void;
}

function followBottom(element: HTMLElement, update: () => void): void {
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  const following = distance <= FOLLOW_THRESHOLD_PX;
  update();
  if (following) element.scrollTop = element.scrollHeight;
}

export class VoicePanel {
  #elapsedTimer?: number;
  #startedAt = 0;
  #status: VoiceStatus = "idle";
  #available = false;

  constructor(private readonly el: VoiceElements) {}

  get mode(): VoiceMode {
    return this.el.mode.value as VoiceMode;
  }

  get model(): string {
    return this.el.model.value.trim();
  }

  get voice(): string {
    return this.el.voice.value;
  }

  get available(): boolean {
    return this.#available;
  }

  get status(): VoiceStatus {
    return this.#status;
  }

  init(available: boolean): void {
    this.#available = available;
    this.el.start.disabled = !available;
    this.el.status.dataset.state = "idle";
    this.el.status.textContent = available
      ? STATUS_COPY.idle
      : "Voice requires localhost or HTTPS with microphone and AudioWorklet support.";
  }

  bindControls(handlers: VoiceControlHandlers): void {
    this.el.start.addEventListener("click", handlers.onStart);
    this.el.finish.addEventListener("click", handlers.onFinish);
    this.el.stop.addEventListener("click", handlers.onStop);
    this.el.mute.addEventListener("click", handlers.onToggleMute);
    this.el.mode.addEventListener("change", handlers.onModeChange);
  }

  resetForSession(): void {
    this.el.userTranscript.textContent = "";
    this.el.assistantTranscript.textContent = "";
    delete this.el.userTranscript.dataset.final;
    delete this.el.assistantTurn.dataset.interrupted;
    this.el.events.replaceChildren();
  }

  renderEndpoint(host: string): void {
    this.el.transport.hidden = false;
    this.el.endpointRow.hidden = false;
    this.el.endpoint.textContent = host;
  }

  renderRate(rate: number): void {
    this.el.rateRow.hidden = false;
    this.el.rate.textContent = `${rate} Hz send`;
  }

  markUserFinal(final: boolean): void {
    if (final) this.el.userTranscript.dataset.final = "true";
    else delete this.el.userTranscript.dataset.final;
  }

  markInterrupted(value: boolean): void {
    if (value) this.el.assistantTurn.dataset.interrupted = "true";
    else delete this.el.assistantTurn.dataset.interrupted;
  }

  resetAssistantTranscript(): void {
    this.el.assistantTranscript.textContent = "";
  }

  createMeter(): VoiceMeter {
    return createVoiceMeter(this.el.inputMeter, this.el.outputMeter);
  }

  renderMute(active: boolean, muted: boolean): void {
    this.el.mute.hidden = !active;
    this.el.mute.setAttribute("aria-pressed", String(muted));
    this.el.mute.setAttribute(
      "aria-label",
      muted
        ? "Unmute microphone. Muted input still streams silence."
        : "Mute microphone",
    );
    const use = this.el.mute.querySelector("use");
    use?.setAttribute("href", muted ? "#i-mic-off" : "#i-mic");
    if (muted) this.el.status.dataset.muted = "true";
    else delete this.el.status.dataset.muted;
  }

  beginSessionClock(): void {
    this.#startedAt = Date.now();
    this.el.elapsedRow.hidden = false;
    this.renderElapsed();
    this.#elapsedTimer = window.setInterval(() => this.renderElapsed(), 1_000);
  }

  renderElapsed(): void {
    const seconds = Math.max(0, Math.round((Date.now() - this.#startedAt) / 1000));
    const minutes = Math.floor(seconds / 60);
    this.el.elapsed.textContent = `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }

  stopSessionClock(): void {
    if (this.#elapsedTimer !== undefined) {
      window.clearInterval(this.#elapsedTimer);
      this.#elapsedTimer = undefined;
    }
  }

  renderDevice(label: string): void {
    this.el.deviceRow.hidden = label.length === 0;
    this.el.device.textContent = label;
    this.el.transport.hidden = false;
  }

  renderNetwork(hasStream: boolean): void {
    if (!hasStream && this.el.transport.hidden) return;
    this.el.networkRow.hidden = false;
    this.el.network.textContent = navigator.onLine ? "online" : "offline";
  }

  recordEvent(type: string): void {
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    this.el.lastEventRow.hidden = false;
    this.el.lastEvent.textContent = type;
    const row = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = type;
    const time = document.createElement("span");
    time.textContent = stamp;
    row.append(name, time);
    followBottom(this.el.events, () => {
      this.el.events.append(row);
      while (this.el.events.childElementCount > EVENT_LOG_LIMIT) {
        this.el.events.firstElementChild?.remove();
      }
    });
  }

  writeUserTranscript(text: string): void {
    followBottom(this.el.userTranscript, () => {
      this.el.userTranscript.textContent = text;
    });
  }

  writeAssistantTranscript(text: string): void {
    followBottom(this.el.assistantTranscript, () => {
      this.el.assistantTranscript.textContent = text;
    });
  }

  appendAssistantTranscript(delta: string): void {
    followBottom(this.el.assistantTranscript, () => {
      this.el.assistantTranscript.textContent += delta;
    });
  }

  syncControls(): void {
    const stt = this.el.mode.value === "stt";
    this.el.model.disabled = stt;
    this.el.voice.disabled = stt;
    this.el.finish.hidden = !stt;
    const active = this.#status !== "idle" &&
      this.#status !== "stopped" &&
      this.#status !== "failed";
    this.el.start.disabled = active || !this.#available;
    this.el.stop.disabled = !active;
    this.el.finish.disabled = !stt || this.#status !== "listening";
  }

  setStatus(status: VoiceStatus, detail?: string): void {
    this.#status = status;
    this.el.status.dataset.state = status;
    this.el.status.textContent = detail ?? STATUS_COPY[status];
    this.syncControls();
  }
}
