import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createVoiceMeter } from "../src/web/client/voice-meter.js";

const BAR_COUNT = 7;
const SILENCE = 18;
const MEDIUM_INPUT = 100;
const LOUD_INPUT = 220;
const PEAK_INPUT = 255;
const PEAK_LEVEL = 12;

class FakeBar {
  readonly dataset: Record<string, string> = {};
}

class FakeBarHost {
  readonly bars = Array.from({ length: BAR_COUNT }, () => new FakeBar());

  querySelectorAll(selector: string): FakeBar[] {
    assert.equal(selector, "i");
    return this.bars;
  }
}

class FakeAnalyser {
  readonly frequencyBinCount = 128;

  constructor(public value: number) {}

  getByteFrequencyData(data: Uint8Array): void {
    data.fill(this.value);
  }
}

function asElement(host: FakeBarHost): HTMLElement {
  return host as unknown as HTMLElement;
}

function asAnalyser(analyser: FakeAnalyser): AnalyserNode {
  return analyser as unknown as AnalyserNode;
}

function renderedLevels(host: FakeBarHost): number[] {
  return host.bars.map((bar) => Number(bar.dataset.level));
}

describe("voice meter rendering", () => {
  let reducedMotion = false;
  let nextFrameId = 1;
  let frames: Map<number, FrameRequestCallback>;

  const runFrame = (): void => {
    assert.equal(frames.size, 1, "exactly one animation frame is pending");
    const entry = frames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    assert.ok(entry);
    const [frameId, callback] = entry;
    frames.delete(frameId);
    callback(16.67);
  };

  const runFrames = (count: number): void => {
    for (let index = 0; index < count; index += 1) runFrame();
  };

  const createMeter = (
    input: FakeBarHost,
    output = new FakeBarHost(),
  ) => createVoiceMeter(asElement(input), asElement(output));

  beforeEach(() => {
    assert.equal(globalThis.window, undefined);
    assert.equal(globalThis.requestAnimationFrame, undefined);
    assert.equal(globalThis.cancelAnimationFrame, undefined);

    reducedMotion = false;
    nextFrameId = 1;
    frames = new Map();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        matchMedia: () => ({ matches: reducedMotion }),
      },
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback): number => {
        const frameId = nextFrameId;
        nextFrameId += 1;
        frames.set(frameId, callback);
        return frameId;
      },
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: (frameId: number): void => {
        frames.delete(frameId);
      },
    });
  });

  afterEach(() => {
    delete (globalThis as { window?: Window }).window;
    delete (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame })
      .requestAnimationFrame;
    delete (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame })
      .cancelAnimationFrame;
  });

  it("renders every bar at zero for input at the noise floor", () => {
    const input = new FakeBarHost();
    const meter = createMeter(input);

    meter.attachInput(asAnalyser(new FakeAnalyser(SILENCE)));
    runFrame();

    assert.deepEqual(input.bars.map((bar) => bar.dataset.level), [
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
    ]);
  });

  it("raises the rendered bars when analyser input grows", () => {
    const input = new FakeBarHost();
    const analyser = new FakeAnalyser(SILENCE);
    const meter = createMeter(input);
    meter.attachInput(asAnalyser(analyser));
    runFrame();

    analyser.value = PEAK_INPUT;
    runFrames(3);

    assert.ok(renderedLevels(input).every((level) => level > 0));
  });

  it("renders louder input higher than medium input", () => {
    const measureSettledLevel = (value: number): number => {
      const input = new FakeBarHost();
      const meter = createMeter(input);
      meter.attachInput(asAnalyser(new FakeAnalyser(value)));
      runFrames(24);
      const level = renderedLevels(input)[0];
      meter.dispose();
      return level;
    };

    const medium = measureSettledLevel(MEDIUM_INPUT);
    const loud = measureSettledLevel(LOUD_INPUT);

    assert.ok(medium > 0);
    assert.ok(loud > medium, `expected ${loud} to exceed ${medium}`);
  });

  it("attacks faster than it releases from an independently warmed peak", () => {
    const fallingHost = new FakeBarHost();
    const fallingAnalyser = new FakeAnalyser(PEAK_INPUT);
    const fallingMeter = createMeter(fallingHost);
    fallingMeter.attachInput(asAnalyser(fallingAnalyser));
    runFrames(24);
    const peak = renderedLevels(fallingHost)[0];
    assert.equal(peak, PEAK_LEVEL);

    fallingAnalyser.value = SILENCE;
    runFrame();
    const releaseDistance = peak - renderedLevels(fallingHost)[0];
    fallingMeter.dispose();

    const risingHost = new FakeBarHost();
    const risingAnalyser = new FakeAnalyser(SILENCE);
    const risingMeter = createMeter(risingHost);
    risingMeter.attachInput(asAnalyser(risingAnalyser));
    runFrame();
    const floor = renderedLevels(risingHost)[0];

    risingAnalyser.value = PEAK_INPUT;
    runFrame();
    const attackDistance = renderedLevels(risingHost)[0] - floor;
    risingMeter.dispose();

    assert.ok(
      attackDistance > releaseDistance,
      `expected attack ${attackDistance} to exceed release ${releaseDistance}`,
    );
  });

  it("resets the bars and cancels the loop when disposed", () => {
    const input = new FakeBarHost();
    const output = new FakeBarHost();
    const meter = createMeter(input, output);
    meter.attachInput(asAnalyser(new FakeAnalyser(PEAK_INPUT)));
    meter.attachOutput(asAnalyser(new FakeAnalyser(PEAK_INPUT)));
    runFrames(3);
    assert.ok(renderedLevels(input).every((level) => level > 0));
    assert.ok(renderedLevels(output).every((level) => level > 0));
    assert.equal(frames.size, 1);

    meter.dispose();

    assert.ok(input.bars.every((bar) => bar.dataset.level === "0"));
    assert.ok(output.bars.every((bar) => bar.dataset.level === "0"));
    assert.equal(frames.size, 0);
  });

  it("does not schedule an animation frame for reduced motion", () => {
    reducedMotion = true;
    const input = new FakeBarHost();
    const meter = createMeter(input);

    meter.attachInput(asAnalyser(new FakeAnalyser(PEAK_INPUT)));

    assert.equal(frames.size, 0);
  });
});
