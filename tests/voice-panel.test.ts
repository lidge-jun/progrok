import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  VoicePanel,
  type VoiceElements,
} from "../src/web/client/voice-panel.js";

class FakeElement {
  textContent = "";
  dataset: Record<string, string> = {};
  hidden = false;
  disabled = false;
  value = "";
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Array<() => void>>();
  use?: FakeElement;
  #parent?: FakeElement;

  get childElementCount(): number {
    return this.children.length;
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  querySelector(selector: string): FakeElement | null {
    return selector === "use" ? this.use ?? null : null;
  }

  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) child.#parent = undefined;
    this.children.length = 0;
    this.append(...children);
  }

  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.#parent = this;
      this.children.push(child);
    }
  }

  remove(): void {
    const parent = this.#parent;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.#parent = undefined;
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
}

function createElements(): {
  elements: VoiceElements;
  fake: Record<keyof VoiceElements, FakeElement>;
} {
  const fake = {
    mode: new FakeElement(),
    model: new FakeElement(),
    voice: new FakeElement(),
    start: new FakeElement(),
    finish: new FakeElement(),
    stop: new FakeElement(),
    mute: new FakeElement(),
    status: new FakeElement(),
    userTranscript: new FakeElement(),
    assistantTranscript: new FakeElement(),
    assistantTurn: new FakeElement(),
    inputMeter: new FakeElement(),
    outputMeter: new FakeElement(),
    elapsedRow: new FakeElement(),
    elapsed: new FakeElement(),
    lastEventRow: new FakeElement(),
    lastEvent: new FakeElement(),
    transport: new FakeElement(),
    endpointRow: new FakeElement(),
    endpoint: new FakeElement(),
    rateRow: new FakeElement(),
    rate: new FakeElement(),
    deviceRow: new FakeElement(),
    device: new FakeElement(),
    networkRow: new FakeElement(),
    network: new FakeElement(),
    events: new FakeElement(),
  } satisfies Record<keyof VoiceElements, FakeElement>;
  fake.mode.value = "realtime";
  fake.mute.use = new FakeElement();
  return {
    elements: fake as unknown as VoiceElements,
    fake,
  };
}

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

  it("sets status copy and synchronizes control state", () => {
    const { elements, fake } = createElements();
    const panel = new VoicePanel(elements);
    panel.init(true);
    fake.mode.value = "stt";

    panel.setStatus("listening");

    assert.equal(fake.status.dataset.state, "listening");
    assert.equal(fake.status.textContent, "Listening");
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
