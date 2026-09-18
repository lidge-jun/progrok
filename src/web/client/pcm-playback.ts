export function decodeBase64Pcm(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export class PcmPlaybackQueue {
  #sources: AudioBufferSourceNode[] = [];
  #nextPlaybackAt = 0;
  readonly #bus: GainNode;
  readonly analyser: AnalyserNode;

  constructor(
    private readonly context: AudioContext,
    private readonly onActive: () => void,
    private readonly onIdle: () => void,
  ) {
    this.#bus = context.createGain();
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.72;
    this.#bus.connect(this.analyser);
    this.#bus.connect(context.destination);
  }

  get active(): boolean {
    return this.#sources.length > 0;
  }

  enqueue(buffer: ArrayBuffer, sampleRate: number): void {
    if (buffer.byteLength % 2 !== 0) return;
    const input = new Int16Array(buffer);
    const audio = this.context.createBuffer(1, input.length, sampleRate);
    const channel = audio.getChannelData(0);
    for (let index = 0; index < input.length; index += 1) {
      channel[index] = input[index] / 32768;
    }
    const source = this.context.createBufferSource();
    source.buffer = audio;
    source.connect(this.#bus);
    this.#nextPlaybackAt = Math.max(
      this.context.currentTime,
      this.#nextPlaybackAt,
    );
    source.start(this.#nextPlaybackAt);
    this.#nextPlaybackAt += audio.duration;
    this.#sources.push(source);
    source.addEventListener("ended", () => {
      this.#sources = this.#sources.filter((item) => item !== source);
      if (this.#sources.length === 0) this.onIdle();
    });
    this.onActive();
  }

  cancel(): void {
    for (const source of this.#sources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
    }
    this.#sources = [];
    this.#nextPlaybackAt = 0;
  }

  dispose(): void {
    this.cancel();
    this.#bus.disconnect();
    this.analyser.disconnect();
  }
}
