import {
  DEFAULT_REALTIME_MODEL,
  parseRealtimeServerEvent,
  parseSttServerEvent,
  type RealtimeClientEvent,
  type RealtimeServerEvent,
  type SttClientControl,
  type SttServerEvent,
} from "../../voice/protocol.js";
import { mintClientSecret } from "./api.js";
import type { VoiceMode, VoiceStatus } from "./contracts.js";
import {
  decodeBase64Pcm,
  PcmPlaybackQueue,
} from "./pcm-playback.js";
import { createVoiceMeter, type VoiceMeter } from "./voice-meter.js";
import { buildVoiceSocketSpec } from "./voice-socket.js";
export {
  buildVoiceSocketSpec,
  type VoiceSocketSpec,
} from "./voice-socket.js";

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

function describeMediaError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone permission was denied. Allow it for this site in your browser settings, then start again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone input was found. Connect a device and start again.";
  }
  if (name === "NotReadableError") {
    return "The microphone is busy in another application. Close it and start again.";
  }
  return error instanceof Error ? error.message : String(error);
}

function followBottom(element: HTMLElement, update: () => void): void {
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  const following = distance <= FOLLOW_THRESHOLD_PX;
  update();
  if (following) element.scrollTop = element.scrollHeight;
}

export class VoiceController {
  #status: VoiceStatus = "idle";
  #socket?: WebSocket;
  #stream?: MediaStream;
  #context?: AudioContext;
  #source?: MediaStreamAudioSourceNode;
  #worklet?: AudioWorkletNode;
  #silentSink?: GainNode;
  #inputAnalyser?: AnalyserNode;
  #meter?: VoiceMeter;
  #conversationId?: string;
  #playback?: PcmPlaybackQueue;
  #stoppingStt = false;
  #sttTerminal = false;
  #drainTimer?: number;
  #elapsedTimer?: number;
  #startedAt = 0;
  #connectionAbort?: AbortController;
  #generation = 0;
  #available = false;
  #muted = false;

  constructor(private readonly el: VoiceElements) {}

  init(): void {
    this.#available = window.isSecureContext &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      "AudioWorkletNode" in window;
    this.el.start.disabled = !this.#available;
    this.el.status.dataset.state = "idle";
    this.el.status.textContent = this.#available
      ? STATUS_COPY.idle
      : "Voice requires localhost or HTTPS with microphone and AudioWorklet support.";
    this.el.start.addEventListener("click", () => void this.start());
    this.el.finish.addEventListener("click", () => this.finalizeUtterance());
    this.el.stop.addEventListener("click", () => void this.stop());
    this.el.mute.addEventListener("click", () => this.toggleMute());
    this.el.mode.addEventListener("change", () => {
      void this.stop(false);
      this.syncControls();
    });
    window.addEventListener("online", () => this.renderNetwork());
    window.addEventListener("offline", () => this.renderNetwork());
    window.addEventListener("beforeunload", () => void this.stop(false));
    this.syncControls();
  }

  async start(): Promise<void> {
    if (!this.#available) {
      this.fail("Voice requires localhost or HTTPS with microphone and AudioWorklet support.");
      return;
    }
    await this.stop(false);
    const generation = ++this.#generation;
    const abort = new AbortController();
    this.#connectionAbort = abort;
    this.#sttTerminal = false;
    this.#muted = false;
    this.el.userTranscript.textContent = "";
    this.el.assistantTranscript.textContent = "";
    delete this.el.userTranscript.dataset.final;
    delete this.el.assistantTurn.dataset.interrupted;
    this.el.events.replaceChildren();
    this.renderMute();

    try {
      this.setStatus("requesting-permission");
      this.#stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true },
        video: false,
      });
      if (generation !== this.#generation) return;
      const mode = this.el.mode.value as VoiceMode;
      this.beginSessionClock();
      this.renderDevice();
      this.renderNetwork();
      const socket = await this.openFreshSocket(mode, abort.signal);
      if (generation !== this.#generation) {
        socket.close();
        return;
      }
      this.#socket = socket;
      socket.binaryType = "arraybuffer";
      socket.addEventListener("open", () => {
        void this.onOpen(mode, socket).catch((error: unknown) => {
          if (this.#socket === socket) {
            this.fail(error instanceof Error ? error.message : String(error));
          }
        });
      });
      socket.addEventListener("message", (event) => {
        this.onMessage(mode, event as MessageEvent<string | ArrayBuffer>);
      });
      socket.addEventListener("error", () => {
        if (this.#socket === socket) this.fail("Voice WebSocket failed.");
      });
      socket.addEventListener("close", (event) => {
        if (this.#socket !== socket) return;
        this.#socket = undefined;
        void this.stopMedia();
        if (this.#status === "stopped" || this.#status === "failed") return;
        if (mode === "stt" && this.#sttTerminal && event.code === 1006) {
          this.setStatus("stopped");
          return;
        }
        this.fail(`Voice connection closed (${event.code}).`);
      });
    } catch (error) {
      if (generation !== this.#generation) return;
      if (abort.signal.aborted) {
        this.setStatus("stopped");
      } else {
        this.fail(describeMediaError(error));
      }
      await this.stopMedia();
    } finally {
      if (this.#connectionAbort === abort) this.#connectionAbort = undefined;
    }
  }

  async stop(drainStt = true): Promise<void> {
    this.#generation += 1;
    this.#connectionAbort?.abort();
    this.#connectionAbort = undefined;
    const socket = this.#socket;
    if (socket?.readyState === WebSocket.OPEN) {
      if (this.el.mode.value === "stt" && drainStt) {
        this.#stoppingStt = true;
        this.sendJson({ type: "audio.done" } satisfies SttClientControl);
        this.cancelPlayback();
        await this.stopMedia();
        this.setStatus("stopped");
        this.#drainTimer = window.setTimeout(() => this.closeSocket(), 2_000);
        return;
      }
      if (this.el.mode.value === "realtime") {
        this.sendJson({ type: "response.cancel" } satisfies RealtimeClientEvent);
      }
    }
    this.closeSocket();
    this.cancelPlayback();
    await this.stopMedia();
    if (this.#status !== "idle") this.setStatus("stopped");
  }

  finalizeUtterance(): void {
    if (
      this.el.mode.value === "stt" &&
      this.#socket?.readyState === WebSocket.OPEN
    ) {
      this.sendJson({ type: "finalize" } satisfies SttClientControl);
    }
  }

  private toggleMute(): void {
    const track = this.#stream?.getAudioTracks()[0];
    if (!track) return;
    this.#muted = !this.#muted;
    track.enabled = !this.#muted;
    this.renderMute();
  }

  private renderMute(): void {
    const active = Boolean(this.#stream);
    this.el.mute.hidden = !active;
    this.el.mute.setAttribute("aria-pressed", String(this.#muted));
    this.el.mute.setAttribute(
      "aria-label",
      this.#muted
        ? "Unmute microphone. Muted input still streams silence."
        : "Mute microphone",
    );
    const use = this.el.mute.querySelector("use");
    use?.setAttribute("href", this.#muted ? "#i-mic-off" : "#i-mic");
    if (this.#muted) this.el.status.dataset.muted = "true";
    else delete this.el.status.dataset.muted;
  }

  private beginSessionClock(): void {
    this.#startedAt = Date.now();
    this.el.elapsedRow.hidden = false;
    this.renderElapsed();
    this.#elapsedTimer = window.setInterval(() => this.renderElapsed(), 1_000);
  }

  private renderElapsed(): void {
    const seconds = Math.max(0, Math.round((Date.now() - this.#startedAt) / 1000));
    const minutes = Math.floor(seconds / 60);
    this.el.elapsed.textContent = `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }

  private stopSessionClock(): void {
    if (this.#elapsedTimer !== undefined) {
      window.clearInterval(this.#elapsedTimer);
      this.#elapsedTimer = undefined;
    }
  }

  private renderDevice(): void {
    const label = this.#stream?.getAudioTracks()[0]?.label ?? "";
    this.el.deviceRow.hidden = label.length === 0;
    this.el.device.textContent = label;
    this.el.transport.hidden = false;
  }

  private renderNetwork(): void {
    if (!this.#stream && this.el.transport.hidden) return;
    this.el.networkRow.hidden = false;
    this.el.network.textContent = navigator.onLine ? "online" : "offline";
  }

  private recordEvent(type: string): void {
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

  private async openFreshSocket(
    mode: VoiceMode,
    signal: AbortSignal,
  ): Promise<WebSocket> {
    this.setStatus("minting-secret");
    const secret = await mintClientSecret(signal);
    const spec = buildVoiceSocketSpec(mode, secret, {
      model: this.el.model.value.trim() || DEFAULT_REALTIME_MODEL,
      ...(mode === "realtime" && this.#conversationId
        ? { conversationId: this.#conversationId }
        : {}),
    });
    this.setStatus("connecting");
    this.el.transport.hidden = false;
    this.el.endpointRow.hidden = false;
    this.el.endpoint.textContent = new URL(spec.url).host;
    return new WebSocket(spec.url, spec.protocols);
  }

  private async onOpen(mode: VoiceMode, socket: WebSocket): Promise<void> {
    if (this.#socket !== socket || !this.#stream) return;
    if (mode === "realtime") this.sendJson(this.sessionUpdate());
    const rate = mode === "stt" ? 16000 : 24000;
    const context = new AudioContext();
    this.#context = context;
    this.#playback = new PcmPlaybackQueue(
      context,
      () => this.setStatus("speaking"),
      () => {
        if (this.#status === "speaking") this.setStatus("listening");
      },
    );
    await context.audioWorklet.addModule("/assets/pcm-worklet.js");
    if (this.#socket !== socket || !this.#stream) {
      await this.stopMedia();
      return;
    }
    this.#source = context.createMediaStreamSource(this.#stream);
    this.#worklet = new AudioWorkletNode(context, "pcm-capture", {
      processorOptions: { targetSampleRate: rate },
    });
    this.#worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.#socket === socket && socket.readyState === WebSocket.OPEN) {
        socket.send(event.data);
      }
    };
    this.#source.connect(this.#worklet);
    this.#inputAnalyser = context.createAnalyser();
    this.#inputAnalyser.fftSize = 256;
    this.#inputAnalyser.smoothingTimeConstant = 0.72;
    this.#source.connect(this.#inputAnalyser);
    this.#silentSink = context.createGain();
    this.#silentSink.gain.value = 0;
    this.#worklet.connect(this.#silentSink).connect(context.destination);
    this.#meter = createVoiceMeter(this.el.inputMeter, this.el.outputMeter);
    this.#meter.attachInput(this.#inputAnalyser);
    this.#meter.attachOutput(this.#playback.analyser);
    this.el.rateRow.hidden = false;
    this.el.rate.textContent = `${rate} Hz send`;
    this.renderMute();
    this.setStatus("listening");
  }

  private onMessage(
    mode: VoiceMode,
    event: MessageEvent<string | ArrayBuffer>,
  ): void {
    if (event.data instanceof ArrayBuffer) {
      this.recordEvent("audio(binary)");
      if (mode === "realtime") this.#playback?.enqueue(event.data, 24000);
      return;
    }
    try {
      if (mode === "stt") {
        const parsed = parseSttServerEvent(event.data);
        this.recordEvent(parsed.type);
        this.onSttEvent(parsed);
      } else {
        const parsed = parseRealtimeServerEvent(event.data);
        this.recordEvent(parsed.type);
        this.onRealtimeEvent(parsed);
      }
    } catch {
      this.fail("Voice API returned an invalid event.");
    }
  }

  private onSttEvent(event: SttServerEvent): void {
    if (event.type === "transcript.partial") {
      this.writeUserTranscript(event.text);
      if (event.speech_final) {
        this.#sttTerminal = true;
        this.el.userTranscript.dataset.final = "true";
      }
    } else if (event.type === "transcript.done") {
      this.#sttTerminal = true;
      if (event.text) this.writeUserTranscript(event.text);
      if (this.#stoppingStt) this.closeSocket();
    } else if (event.type === "error") {
      this.fail(event.message);
    }
  }

  private onRealtimeEvent(event: RealtimeServerEvent): void {
    if (event.type === "ping") {
      this.sendJson({
        type: "pong",
        ping_timestamp: event.timestamp,
      } satisfies RealtimeClientEvent);
    } else if (event.type === "conversation.created") {
      this.#conversationId = event.conversation.id;
    } else if (event.type === "input_audio_buffer.speech_started") {
      const wasPlaying = Boolean(this.#playback?.active);
      this.cancelPlayback();
      if (wasPlaying) this.el.assistantTurn.dataset.interrupted = "true";
      this.setStatus("listening");
    } else if (
      event.type === "conversation.item.input_audio_transcription.updated" ||
      event.type === "conversation.item.input_audio_transcription.completed"
    ) {
      this.writeUserTranscript(event.transcript);
    } else if (event.type === "response.created") {
      delete this.el.assistantTurn.dataset.interrupted;
      this.el.assistantTranscript.textContent = "";
      if (this.#status === "listening") this.setStatus("responding");
    } else if (event.type === "response.output_audio.delta") {
      this.#playback?.enqueue(decodeBase64Pcm(event.delta), 24000);
    } else if (event.type === "response.output_audio_transcript.delta") {
      this.appendAssistantTranscript(event.delta);
    } else if (event.type === "response.output_audio_transcript.done") {
      this.writeAssistantTranscript(event.transcript);
    } else if (event.type === "response.done") {
      if (!this.#playback?.active) this.setStatus("listening");
    } else if (event.type === "response.cancelled") {
      this.cancelPlayback();
      this.setStatus("stopped");
    } else if (event.type === "error") {
      this.fail(event.error.message);
    }
  }

  private writeUserTranscript(text: string): void {
    followBottom(this.el.userTranscript, () => {
      this.el.userTranscript.textContent = text;
    });
  }

  private writeAssistantTranscript(text: string): void {
    followBottom(this.el.assistantTranscript, () => {
      this.el.assistantTranscript.textContent = text;
    });
  }

  private appendAssistantTranscript(delta: string): void {
    followBottom(this.el.assistantTranscript, () => {
      this.el.assistantTranscript.textContent += delta;
    });
  }

  private sendJson(event: SttClientControl | RealtimeClientEvent): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify(event));
    }
  }

  private sessionUpdate(): Extract<
    RealtimeClientEvent,
    { type: "session.update" }
  > {
    return {
      type: "session.update",
      session: {
        voice: this.el.voice.value,
        reasoning: { effort: "high" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.85,
          silence_duration_ms: 500,
          prefix_padding_ms: 333,
          idle_timeout_ms: 10000,
        },
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transport: "binary",
            transcription: { model: "grok-transcribe" },
          },
          output: {
            format: { type: "audio/pcm", rate: 24000 },
            transport: "binary",
            speed: 1,
          },
        },
        resumption: { enabled: true },
      },
    };
  }

  private cancelPlayback(): void {
    this.#playback?.cancel();
    this.#meter?.resetOutput();
  }

  private closeSocket(): void {
    if (this.#drainTimer !== undefined) {
      window.clearTimeout(this.#drainTimer);
      this.#drainTimer = undefined;
    }
    this.#stoppingStt = false;
    const socket = this.#socket;
    this.#socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "user stop");
    }
  }

  private async stopMedia(): Promise<void> {
    this.stopSessionClock();
    this.#meter?.resetOutput();
    this.#meter?.dispose();
    this.#playback?.dispose();
    this.#inputAnalyser?.disconnect();
    this.#worklet?.disconnect();
    this.#silentSink?.disconnect();
    this.#source?.disconnect();
    this.#stream?.getTracks().forEach((track) => track.stop());
    const context = this.#context;
    this.#meter = undefined;
    this.#inputAnalyser = undefined;
    this.#worklet = undefined;
    this.#silentSink = undefined;
    this.#source = undefined;
    this.#stream = undefined;
    this.#context = undefined;
    this.#playback = undefined;
    this.#muted = false;
    this.renderMute();
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }
  }

  private syncControls(): void {
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

  private setStatus(status: VoiceStatus, detail?: string): void {
    this.#status = status;
    this.el.status.dataset.state = status;
    this.el.status.textContent = detail ?? STATUS_COPY[status];
    this.syncControls();
  }

  private fail(message: string): void {
    this.closeSocket();
    this.cancelPlayback();
    void this.stopMedia();
    this.setStatus("failed", message);
  }
}

