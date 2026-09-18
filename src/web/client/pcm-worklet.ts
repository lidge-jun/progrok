declare const sampleRate: number;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(inputs: Float32Array[][]): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (
    options?: AudioWorkletNodeOptions,
  ) => AudioWorkletProcessor,
): void;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly targetSampleRate: number;
  private carry = new Float32Array(0);

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const configured = Number(
      options?.processorOptions?.targetSampleRate ?? 16000,
    );
    this.targetSampleRate = Number.isFinite(configured) && configured > 0
      ? Math.min(configured, sampleRate)
      : 16000;
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;
    const merged = new Float32Array(this.carry.length + channel.length);
    merged.set(this.carry);
    merged.set(channel, this.carry.length);
    const ratio = sampleRate / this.targetSampleRate;
    const outputLength = Math.floor(merged.length / ratio);
    const output = new ArrayBuffer(outputLength * 2);
    const view = new DataView(output);
    for (let index = 0; index < outputLength; index += 1) {
      const sample = Math.max(
        -1,
        Math.min(1, merged[Math.floor(index * ratio)]),
      );
      const pcm = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
      view.setInt16(index * 2, pcm, true);
    }
    const consumed = Math.floor(outputLength * ratio);
    this.carry = merged.slice(consumed);
    if (outputLength > 0) this.port.postMessage(output, [output]);
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
