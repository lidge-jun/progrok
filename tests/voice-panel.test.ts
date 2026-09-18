import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  VoicePanel,
  type VoiceElements,
} from "../src/web/client/voice-panel.js";
import type { VoiceStatus } from "../src/web/client/contracts.js";
import { createElements, FakeElement } from "./helpers/fake-voice-dom.js";

const EXPECTED_STATUS_COPY = {
  idle: "Microphone is idle",
  "requesting-permission": "Waiting for microphone permission",
  "minting-secret": "Creating a one-use connection secret",
  connecting: "Connecting to xAI Voice",
  listening: "Listening",
  responding: "Preparing a reply",
  speaking: "Grok is speaking",
  stopped: "Voice stopped",
  failed: "Voice connection failed",
} satisfies Record<VoiceStatus, string>;

// The fake DOM lives in a helper so the wiring test can reuse it.

describe("voice panel", () => {
  before(() => {
    assert.equal(globalThis.document, undefined);
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => new FakeElement(),
      },
    });
  });

  after(() => {
    delete (globalThis as { document?: Document }).document;
  });

  it("renders mute state without owning the media stream", () => {
    const { elements, fake } = createElements();
    const panel = new VoicePanel(elements);

    panel.renderMute(true, true);
    assert.equal(fake.mute.hidden, false);
    assert.equal(fake.mute.attributes.get("aria-pressed"), "true");
    assert.equal(
      fake.mute.attributes.get("aria-label"),
      "Unmute microphone. Muted input still streams silence.",
    );
    assert.equal(fake.mute.use?.attributes.get("href"), "#i-mic-off");
    assert.equal(fake.status.dataset.muted, "true");

    panel.renderMute(false, false);
    assert.equal(fake.mute.hidden, true);
    assert.equal(fake.mute.attributes.get("aria-pressed"), "false");
    assert.equal(fake.mute.attributes.get("aria-label"), "Mute microphone");
    assert.equal(fake.mute.use?.attributes.get("href"), "#i-mic");
    assert.equal(fake.status.dataset.muted, undefined);
  });

  it("hides an empty device label and reveals a named device", () => {
    const { elements, fake } = createElements();
    const panel = new VoicePanel(elements);

    panel.renderDevice("");
    assert.equal(fake.deviceRow.hidden, true);
    assert.equal(fake.device.textContent, "");

    panel.renderDevice("Studio Mic");
    assert.equal(fake.deviceRow.hidden, false);
    assert.equal(fake.device.textContent, "Studio Mic");
    assert.equal(fake.transport.hidden, false);
  });

  it("leaves network display untouched before transport is visible", () => {
    const { elements, fake } = createElements();
    const panel = new VoicePanel(elements);
    fake.transport.hidden = true;
    fake.networkRow.hidden = true;
    fake.network.textContent = "unchanged";

    panel.renderNetwork(false);

    assert.equal(fake.networkRow.hidden, true);
    assert.equal(fake.network.textContent, "unchanged");
  });

  it("formats elapsed time as minutes and zero-padded seconds", () => {
    const { elements, fake } = createElements();
    const panel = new VoicePanel(elements);
    const originalNow = Date.now;
    Date.now = () => 125_000;
    try {
      panel.renderElapsed();
    } finally {
      Date.now = originalNow;
    }

    assert.equal(fake.elapsed.textContent, "2:05");
  });

  it("keeps only the newest 30 event rows", () => {
    const { elements, fake } = createElements();
    const panel = new VoicePanel(elements);

    for (let index = 0; index < 35; index += 1) {
      panel.recordEvent(`event-${index}`);
    }

    assert.equal(fake.events.childElementCount, 30);
    assert.equal(fake.events.firstElementChild?.children[0]?.textContent, "event-5");
    assert.equal(fake.lastEvent.textContent, "event-34");
  });

  it("renders distinct copy for every voice connection status", () => {
    const { elements, fake } = createElements();
    const panel = new VoicePanel(elements);
    const statuses = Object.entries(EXPECTED_STATUS_COPY) as Array<
      [VoiceStatus, string]
    >;

    for (const [status, expectedCopy] of statuses) {
      panel.setStatus(status);
      assert.equal(fake.status.dataset.state, status);
      assert.equal(fake.status.textContent, expectedCopy);
      assert.notEqual(fake.status.textContent, "");
    }

    assert.equal(statuses.length, 9);
    assert.equal(new Set(statuses.map(([, copy]) => copy)).size, 9);

    panel.setStatus("failed", "Microphone permission was denied");
    assert.equal(fake.status.dataset.state, "failed");
    assert.equal(fake.status.textContent, "Microphone permission was denied");
  });

  it("synchronizes control state with the current status", () => {
    const { elements, fake } = createElements();
    const panel = new VoicePanel(elements);
    panel.init(true);
    fake.mode.value = "stt";

    panel.setStatus("listening");

    assert.equal(fake.model.disabled, true);
    assert.equal(fake.voice.disabled, true);
    assert.equal(fake.finish.hidden, false);
    assert.equal(fake.start.disabled, true);
    assert.equal(fake.stop.disabled, false);
    assert.equal(fake.finish.disabled, false);
  });

  it("follows nearby content to the bottom and preserves distant scroll", () => {
    const { elements, fake } = createElements();
    const panel = new VoicePanel(elements);
    fake.userTranscript.scrollHeight = 200;
    fake.userTranscript.clientHeight = 40;
    fake.userTranscript.scrollTop = 130;

    panel.writeUserTranscript("near bottom");
    assert.equal(fake.userTranscript.scrollTop, 200);

    fake.userTranscript.scrollTop = 100;
    panel.writeUserTranscript("far from bottom");
    assert.equal(fake.userTranscript.scrollTop, 100);
    assert.equal(fake.userTranscript.textContent, "far from bottom");
  });
});
