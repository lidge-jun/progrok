import {
  DEFAULT_REALTIME_MODEL,
  safeEventLabel,
  tryParseRealtimeServerEvent,
  tryParseSttServerEvent,
  type RealtimeClientEvent,
  type RealtimeServerEvent,
  type SttClientControl,
  type SttServerEvent,
} from "../../voice/protocol.js";
import { mintClientSecret } from "./api.js";
import type { VoiceMode } from "./contracts.js";
import {
  decodeBase64Pcm,
  PcmPlaybackQueue,
} from "./pcm-playback.js";
import type { VoiceMeter } from "./voice-meter.js";
import { VoicePanel, type VoiceElements } from "./voice-panel.js";
import { buildSessionUpdate, describeMediaError } from "./voice-session.js";
import { buildVoiceSocketSpec } from "./voice-socket.js";
export type { VoiceElements } from "./voice-panel.js";
export {
  buildVoiceSocketSpec,
  type VoiceSocketSpec,
} from "./voice-socket.js";

export class VoiceController {
  readonly #panel: VoicePanel;
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
  #connectionAbort?: AbortController;
  #generation = 0;
  #muted = false;

  constructor(el: VoiceElements) {
    this.#panel = new VoicePanel(el);
  }

  init(): void {
    const available = window.isSecureContext &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      "AudioWorkletNode" in window;
    this.#panel.init(available);
    this.#panel.bindControls({
      onStart: () => void this.start(),
      onFinish: () => this.finalizeUtterance(),
      onStop: () => void this.stop(),
      onToggleMute: () => this.toggleMute(),
      onModeChange: () => {
        void this.stop(false);
        this.#panel.syncControls();
      },
    });
    window.addEventListener("online", () => {
      this.#panel.renderNetwork(Boolean(this.#stream));
    });
    window.addEventListener("offline", () => {
      this.#panel.renderNetwork(Boolean(this.#stream));
    });
    window.addEventListener("beforeunload", () => void this.stop(false));
    this.#panel.syncControls();
  }

  async start(): Promise<void> {
    if (!this.#panel.available) {
      this.fail("Voice requires localhost or HTTPS with microphone and AudioWorklet support.");
      return;
    }
    await this.stop(false);
    const generation = ++this.#generation;
    const abort = new AbortController();
    this.#connectionAbort = abort;
    this.#sttTerminal = false;
    this.#muted = false;
    this.#panel.resetForSession();
    this.#panel.renderMute(Boolean(this.#stream), this.#muted);

    try {
      this.#panel.setStatus("requesting-permission");
      this.#stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true },
        video: false,
      });
      if (generation !== this.#generation) return;
      const mode = this.#panel.mode;
      this.#panel.beginSessionClock();
      this.#panel.renderDevice(this.#stream.getAudioTracks()[0]?.label ?? "");
      this.#panel.renderNetwork(Boolean(this.#stream));
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
        if (this.#panel.status === "stopped" || this.#panel.status === "failed") return;
        if (mode === "stt" && this.#sttTerminal && event.code === 1006) {
          this.#panel.setStatus("stopped");
          return;
        }
        this.fail(`Voice connection closed (${event.code}).`);
      });
    } catch (error) {
      if (generation !== this.#generation) return;
      if (abort.signal.aborted) {
        this.#panel.setStatus("stopped");
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
      if (this.#panel.mode === "stt" && drainStt) {
        this.#stoppingStt = true;
        this.sendJson({ type: "audio.done" } satisfies SttClientControl);
        this.cancelPlayback();
        await this.stopMedia();
        this.#panel.setStatus("stopped");
        this.#drainTimer = window.setTimeout(() => this.closeSocket(), 2_000);
        return;
      }
      if (this.#panel.mode === "realtime") {
        this.sendJson({ type: "response.cancel" } satisfies RealtimeClientEvent);
      }
    }
    this.closeSocket();
    this.cancelPlayback();
    await this.stopMedia();
    if (this.#panel.status !== "idle") this.#panel.setStatus("stopped");
  }

  finalizeUtterance(): void {
    if (
      this.#panel.mode === "stt" &&
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
    this.#panel.renderMute(Boolean(this.#stream), this.#muted);
  }

  private async openFreshSocket(
    mode: VoiceMode,
    signal: AbortSignal,
  ): Promise<WebSocket> {
    this.#panel.setStatus("minting-secret");
    const secret = await mintClientSecret(signal);
    const spec = buildVoiceSocketSpec(mode, secret, {
      model: this.#panel.model || DEFAULT_REALTIME_MODEL,
      ...(mode === "realtime" && this.#conversationId
        ? { conversationId: this.#conversationId }
        : {}),
    });
    this.#panel.setStatus("connecting");
    this.#panel.renderEndpoint(new URL(spec.url).host);
    return new WebSocket(spec.url, spec.protocols);
  }

  private async onOpen(mode: VoiceMode, socket: WebSocket): Promise<void> {
    if (this.#socket !== socket || !this.#stream) return;
    if (mode === "realtime") this.sendJson(buildSessionUpdate(this.#panel.voice));
    const rate = mode === "stt" ? 16000 : 24000;
    const context = new AudioContext();
    this.#context = context;
    this.#playback = new PcmPlaybackQueue(
      context,
      () => this.#panel.setStatus("speaking"),
      () => {
        if (this.#panel.status === "speaking") this.#panel.setStatus("listening");
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
    this.#meter = this.#panel.createMeter();
    this.#meter.attachInput(this.#inputAnalyser);
    this.#meter.attachOutput(this.#playback.analyser);
    this.#panel.renderRate(rate);
    this.#panel.renderMute(Boolean(this.#stream), this.#muted);
    this.#panel.setStatus("listening");
  }

  private onMessage(
    mode: VoiceMode,
    event: MessageEvent<string | ArrayBuffer>,
  ): void {
    if (event.data instanceof ArrayBuffer) {
      this.#panel.recordEvent("audio(binary)");
      if (mode === "realtime") this.#playback?.enqueue(event.data, 24000);
      return;
    }
    // A frame this build cannot model is not a reason to end a live call. Log
    // the sanitised type and keep reading, the way the codex realtime client
    // drops an unsupported frame and continues. Only a server-sent error event
    // fails the session.
    if (mode === "stt") {
      const parsed = tryParseSttServerEvent(event.data);
      if (!parsed) {
        this.#panel.recordEvent(safeEventLabel(event.data));
        return;
      }
      this.#panel.recordEvent(parsed.type);
      this.onSttEvent(parsed);
      return;
    }
    const parsed = tryParseRealtimeServerEvent(event.data);
    if (!parsed) {
      this.#panel.recordEvent(safeEventLabel(event.data));
      return;
    }
    this.#panel.recordEvent(parsed.type);
    this.onRealtimeEvent(parsed);
  }

  private onSttEvent(event: SttServerEvent): void {
    if (event.type === "transcript.partial") {
      this.#panel.writeUserTranscript(event.text);
      if (event.speech_final) {
        this.#sttTerminal = true;
        this.#panel.markUserFinal(true);
      }
    } else if (event.type === "transcript.done") {
      this.#sttTerminal = true;
      if (event.text) this.#panel.writeUserTranscript(event.text);
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
      if (wasPlaying) this.#panel.markInterrupted(true);
      this.#panel.setStatus("listening");
    } else if (
      event.type === "conversation.item.input_audio_transcription.updated" ||
      event.type === "conversation.item.input_audio_transcription.completed"
    ) {
      this.#panel.writeUserTranscript(event.transcript);
    } else if (event.type === "response.created") {
      this.#panel.markInterrupted(false);
      this.#panel.resetAssistantTranscript();
      if (this.#panel.status === "listening") this.#panel.setStatus("responding");
    } else if (event.type === "response.output_audio.delta") {
      this.#playback?.enqueue(decodeBase64Pcm(event.delta), 24000);
    } else if (event.type === "response.output_audio_transcript.delta") {
      this.#panel.appendAssistantTranscript(event.delta);
    } else if (event.type === "response.output_audio_transcript.done") {
      this.#panel.writeAssistantTranscript(event.transcript);
    } else if (event.type === "response.done") {
      if (!this.#playback?.active) this.#panel.setStatus("listening");
    } else if (event.type === "response.cancelled") {
      this.cancelPlayback();
      this.#panel.setStatus("stopped");
    } else if (event.type === "error") {
      this.fail(event.error.message);
    }
  }

  private sendJson(event: SttClientControl | RealtimeClientEvent): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify(event));
    }
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
    this.#panel.stopSessionClock();
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
    this.#panel.renderMute(Boolean(this.#stream), this.#muted);
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }
  }

  private fail(message: string): void {
    this.closeSocket();
    this.cancelPlayback();
    void this.stopMedia();
    this.#panel.setStatus("failed", message);
  }
}
