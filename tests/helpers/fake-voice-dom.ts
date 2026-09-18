import type { VoiceElements } from "../../src/web/client/voice-panel.js";

export class FakeElement {
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

export function createElements(): {
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
