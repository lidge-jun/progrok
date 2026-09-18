const NOISE_FLOOR = 18;
const RANGE = 210;
const ATTACK = 0.55;
const RELEASE = 0.16;

export const METER_STEPS = 12;

export function clampLevel(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value > 1 ? 1 : value;
}

export function normalizeBand(value: number): number {
  return clampLevel((value - NOISE_FLOOR) / RANGE);
}

export function quantize(level: number): number {
  return Math.round(clampLevel(level) * METER_STEPS);
}

export function smooth(previous: number, next: number): number {
  const factor = next > previous ? ATTACK : RELEASE;
  return clampLevel(previous + (next - previous) * factor);
}

export function bandRanges(
  binCount: number,
  bands: number,
): Array<[number, number]> {
  const first = 1;
  const last = Math.max(first + bands, Math.floor(binCount * 0.7));
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < bands; index += 1) {
    const start = Math.floor(first * (last / first) ** (index / bands));
    const rawEnd = Math.floor(first * (last / first) ** ((index + 1) / bands));
    const end = Math.min(binCount, Math.max(start + 1, rawEnd));
    ranges.push([start, end]);
  }
  return ranges;
}

export function averageBand(
  data: Uint8Array | number[],
  range: [number, number],
): number {
  let total = 0;
  for (let index = range[0]; index < range[1]; index += 1) {
    total += data[index] ?? 0;
  }
  const width = range[1] - range[0];
  return width > 0 ? total / width : 0;
}

export interface VoiceMeter {
  attachInput(analyser: AnalyserNode): void;
  attachOutput(analyser: AnalyserNode): void;
  resetOutput(): void;
  dispose(): void;
}

interface Channel {
  bars: HTMLElement[];
  levels: Float32Array;
  analyser?: AnalyserNode;
  data?: Uint8Array<ArrayBuffer>;
  ranges: Array<[number, number]>;
}

function readBars(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>("i"));
}

function paint(channel: Channel, levels: Float32Array): void {
  for (let index = 0; index < channel.bars.length; index += 1) {
    const step = quantize(levels[index] ?? 0);
    const bar = channel.bars[index];
    if (bar.dataset.level !== String(step)) bar.dataset.level = String(step);
  }
}

function makeChannel(host: HTMLElement): Channel {
  const bars = readBars(host);
  return { bars, levels: new Float32Array(bars.length), ranges: [] };
}

/**
 * Drives both meters from a single animation frame. Levels come from real
 * AnalyserNode data; with reduced motion the loop is never created and the
 * bars stay at their resting step.
 */
export function createVoiceMeter(
  inputHost: HTMLElement,
  outputHost: HTMLElement,
): VoiceMeter {
  const input = makeChannel(inputHost);
  const output = makeChannel(outputHost);
  const reduced = typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame: number | undefined;
  let disposed = false;

  const bind = (channel: Channel, analyser: AnalyserNode): void => {
    channel.analyser = analyser;
    channel.data = new Uint8Array(analyser.frequencyBinCount);
    channel.ranges = bandRanges(analyser.frequencyBinCount, channel.bars.length);
  };

  const step = (channel: Channel): void => {
    const { analyser, data } = channel;
    if (!analyser || !data) return;
    analyser.getByteFrequencyData(data);
    for (let index = 0; index < channel.bars.length; index += 1) {
      const range = channel.ranges[index];
      const next = range ? normalizeBand(averageBand(data, range)) : 0;
      channel.levels[index] = smooth(channel.levels[index] ?? 0, next);
    }
    paint(channel, channel.levels);
  };

  const loop = (): void => {
    if (disposed) return;
    step(input);
    step(output);
    frame = requestAnimationFrame(loop);
  };

  const ensureLoop = (): void => {
    if (reduced || disposed || frame !== undefined) return;
    frame = requestAnimationFrame(loop);
  };

  return {
    attachInput(analyser) {
      bind(input, analyser);
      ensureLoop();
    },
    attachOutput(analyser) {
      bind(output, analyser);
      ensureLoop();
    },
    resetOutput() {
      output.levels.fill(0);
      paint(output, output.levels);
    },
    dispose() {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      input.analyser = undefined;
      output.analyser = undefined;
      input.levels.fill(0);
      output.levels.fill(0);
      paint(input, input.levels);
      paint(output, output.levels);
    },
  };
}
