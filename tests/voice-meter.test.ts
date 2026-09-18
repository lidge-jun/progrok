import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  averageBand,
  bandRanges,
  clampLevel,
  METER_STEPS,
  normalizeBand,
  quantize,
  smooth,
} from "../src/web/client/voice-meter.js";

describe("voice level meter", () => {
  it("clamps every level into the 0..1 range the bars expect", () => {
    assert.equal(clampLevel(-3), 0);
    assert.equal(clampLevel(0), 0);
    assert.equal(clampLevel(0.42), 0.42);
    assert.equal(clampLevel(1), 1);
    assert.equal(clampLevel(1.13), 1);
    assert.equal(clampLevel(Number.NaN), 0);
  });

  it("treats anything at or below the noise floor as silence", () => {
    assert.equal(normalizeBand(0), 0);
    assert.equal(normalizeBand(18), 0);
    assert.ok(normalizeBand(19) > 0);
    assert.equal(normalizeBand(255), 1);
  });

  it("quantises to the discrete steps the stylesheet declares", () => {
    assert.equal(quantize(0), 0);
    assert.equal(quantize(1), METER_STEPS);
    assert.equal(quantize(2), METER_STEPS);
    assert.equal(quantize(0.5), 6);
    for (let index = 0; index <= 24; index += 1) {
      const step = quantize(index / 24);
      assert.ok(Number.isInteger(step));
      assert.ok(step >= 0 && step <= METER_STEPS);
    }
  });

  it("rises faster than it falls so speech reads as attack and decay", () => {
    const rising = smooth(0, 1);
    const falling = smooth(1, 0);
    assert.ok(rising > 0.5);
    assert.ok(falling > 0.8);
    assert.ok(rising > 1 - falling);
  });

  it("splits the spectrum into contiguous, in-bounds bands", () => {
    const ranges = bandRanges(128, 7);
    assert.equal(ranges.length, 7);
    for (const [start, end] of ranges) {
      assert.ok(end > start, "each band covers at least one bin");
      assert.ok(start >= 1, "the DC bin is skipped");
      assert.ok(end <= 128, "bands stay inside the analyser");
    }
    for (let index = 1; index < ranges.length; index += 1) {
      assert.ok(ranges[index][0] >= ranges[index - 1][0]);
    }
  });

  it("averages only the bins inside a band", () => {
    const data = new Uint8Array([0, 10, 20, 30, 40]);
    assert.equal(averageBand(data, [1, 3]), 15);
    assert.equal(averageBand(data, [0, 5]), 20);
    assert.equal(averageBand(data, [2, 2]), 0);
  });

  it("never reports motion for an all-zero analyser read", () => {
    const silent = new Uint8Array(128);
    for (const range of bandRanges(128, 7)) {
      assert.equal(quantize(normalizeBand(averageBand(silent, range))), 0);
    }
  });
});

