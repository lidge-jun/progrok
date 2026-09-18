import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VoiceController } from "../src/web/client/voice.js";
import type { VoiceMeter } from "../src/web/client/voice-meter.js";
import { VoicePanel } from "../src/web/client/voice-panel.js";
import { createElements } from "./helpers/fake-voice-dom.js";

interface HarnessOptions {
  getUserMediaError?: Error;
  mintFails?: boolean;
}

class FakeTrack {
  readonly label = "Test microphone";
  enabled = true;
  stopCalls = 0;

  stop(): void {
    this.stopCalls += 1;
  }
}

class FakeStream {
  readonly track = new FakeTrack();

  getAudioTracks(): FakeTrack[] {
    return [this.track];
  }

  getTracks(): FakeTrack[] {
    return [this.track];
  }
}

class FakeAnalyser {
  fftSize = 0;
  smoothingTimeConstant = 0;
  readonly frequencyBinCount = 128;
  disconnectCalls = 0;

  disconnect(): void {
    this.disconnectCalls += 1;
  }
}

class FakeAudioNode {
  readonly connections: unknown[] = [];
  disconnectCalls = 0;

  connect<T>(target: T): T {
    this.connections.push(target);
    return target;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = { value: 1 };
}

class FakeMediaStreamSource extends FakeAudioNode {
  constructor(readonly stream: FakeStream) {
    super();
  }
}

class FakeAudioContext {
  readonly destination = new FakeAudioNode();
  readonly analysers: FakeAnalyser[] = [];
  readonly gains: FakeGainNode[] = [];
  readonly sources: FakeMediaStreamSource[] = [];
  readonly addModuleCalls: string[] = [];
  state = "running";
  readonly audioWorklet = {
    addModule: async (url: string): Promise<void> => {
      this.addModuleCalls.push(url);
    },
  };

  createMediaStreamSource(stream: FakeStream): FakeMediaStreamSource {
    const source = new FakeMediaStreamSource(stream);
    this.sources.push(source);
    return source;
  }

  createAnalyser(): FakeAnalyser {
    const analyser = new FakeAnalyser();
    this.analysers.push(analyser);
    return analyser;
  }

  createGain(): FakeGainNode {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }

  async close(): Promise<void> {
    this.state = "closed";
  }
}

class FakeAudioWorkletNode extends FakeAudioNode {
  readonly port: { onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null } = {
    onmessage: null,
  };
}

type SocketListener = (event: { code: number }) => void;

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = 0;
  binaryType = "blob";
  readonly listeners = new Map<string, SocketListener[]>();
  readonly sent: unknown[] = [];
  readonly closeCalls: Array<[number | undefined, string | undefined]> = [];

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {}

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(value: unknown): void {
    this.sent.push(value);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    for (const listener of this.listeners.get("open") ?? []) listener({ code: 0 });
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push([code, reason]);
    this.readyState = FakeWebSocket.CLOSED;
  }
}

function installGlobal(name: string, value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  };
}

async function settleOpen(status: () => string | undefined): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (status() === "listening" || status() === "failed") return;
    await Promise.resolve();
  }
  throw new Error(`voice open did not settle (status=${status() ?? "unset"})`);
}

function installHarness(options: HarnessOptions = {}) {
  const restores: Array<() => void> = [];
  const stream = new FakeStream();
  const getUserMediaCalls: MediaStreamConstraints[] = [];
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const contexts: FakeAudioContext[] = [];
  const sockets: FakeWebSocket[] = [];
  const windowListeners = new Map<string, Array<() => void>>();
  const intervalIds = new Set<number>();
  let nextTimerId = 1;

  const meterCalls = {
    attachInput: [] as AnalyserNode[],
    attachOutput: [] as AnalyserNode[],
    resetOutput: 0,
    dispose: 0,
  };
  const meter: VoiceMeter = {
    attachInput(analyser) {
      meterCalls.attachInput.push(analyser);
    },
    attachOutput(analyser) {
      meterCalls.attachOutput.push(analyser);
    },
    resetOutput() {
      meterCalls.resetOutput += 1;
    },
    dispose() {
      meterCalls.dispose += 1;
    },
  };

  const windowFake = {
    isSecureContext: true,
    AudioWorkletNode: FakeAudioWorkletNode,
    addEventListener(type: string, listener: () => void): void {
      const listeners = windowListeners.get(type) ?? [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    setInterval(): number {
      const id = nextTimerId++;
      intervalIds.add(id);
      return id;
    },
    clearInterval(id: number): void {
      intervalIds.delete(id);
    },
    setTimeout(): number {
      return nextTimerId++;
    },
    clearTimeout(): void {},
  };

  restores.push(installGlobal("window", windowFake));
  restores.push(installGlobal("navigator", {
    onLine: true,
    mediaDevices: {
      async getUserMedia(constraints: MediaStreamConstraints): Promise<FakeStream> {
        getUserMediaCalls.push(constraints);
        if (options.getUserMediaError) throw options.getUserMediaError;
        return stream;
      },
    },
  }));
  restores.push(installGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ input: String(input), init });
    if (options.mintFails) {
      return Response.json({ error: { message: "mint failed" } }, { status: 500 });
    }
    return Response.json({ value: "one-use-test-secret", expires_at: 1_900_000_000 });
  }));
  restores.push(installGlobal("AudioContext", class extends FakeAudioContext {
    constructor() {
      super();
      contexts.push(this);
    }
  }));
  restores.push(installGlobal("AudioWorkletNode", FakeAudioWorkletNode));
  restores.push(installGlobal("WebSocket", class extends FakeWebSocket {
    static readonly OPEN = FakeWebSocket.OPEN;
    static readonly CLOSING = FakeWebSocket.CLOSING;

    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols);
      sockets.push(this);
    }
  }));

  const createMeterDescriptor = Object.getOwnPropertyDescriptor(
    VoicePanel.prototype,
    "createMeter",
  );
  Object.defineProperty(VoicePanel.prototype, "createMeter", {
    configurable: true,
    value: () => meter,
  });
  restores.push(() => {
    if (createMeterDescriptor) {
      Object.defineProperty(VoicePanel.prototype, "createMeter", createMeterDescriptor);
    }
  });

  const { elements, fake } = createElements();
  const controller = new VoiceController(elements);
  controller.init();

  return {
    controller,
    contexts,
    fake,
    fetchCalls,
    getUserMediaCalls,
    intervalIds,
    meterCalls,
    sockets,
    stream,
    windowListeners,
    async openAndSettle(): Promise<void> {
      const socket = sockets[0];
      assert.ok(socket, "start() should create a WebSocket before open");
      socket.open();
      await settleOpen(() => fake.status.dataset.state);
    },
    async restore(): Promise<void> {
      try {
        await controller.stop(false);
      } finally {
        for (const restore of restores.reverse()) restore();
      }
    },
  };
}

describe("voice stream-to-meter wiring", () => {
  it("D-1 requests a mono echo-cancelled audio stream without video", async () => {
    const harness = installHarness();
    try {
      await harness.controller.start();
      assert.deepEqual(harness.getUserMediaCalls, [{
        audio: { channelCount: 1, echoCancellation: true },
        video: false,
      }]);
    } finally {
      await harness.restore();
    }
  });

  it("D-2 creates the media source from the acquired stream", async () => {
    const harness = installHarness();
    try {
      await harness.controller.start();
      await harness.openAndSettle();
      assert.equal(harness.contexts.length, 1);
      assert.equal(harness.contexts[0].sources[0]?.stream, harness.stream);
    } finally {
      await harness.restore();
    }
  });

  it("D-3 configures the input analyser for the voice meter", async () => {
    const harness = installHarness();
    try {
      await harness.controller.start();
      await harness.openAndSettle();
      const inputAnalyser = harness.meterCalls.attachInput[0] as unknown as FakeAnalyser;
      assert.equal(inputAnalyser.fftSize, 256);
      assert.equal(inputAnalyser.smoothingTimeConstant, 0.72);
    } finally {
      await harness.restore();
    }
  });

  it("D-4 connects the stream source to the input analyser", async () => {
    const harness = installHarness();
    try {
      await harness.controller.start();
      await harness.openAndSettle();
      const context = harness.contexts[0];
      const inputAnalyser = harness.meterCalls.attachInput[0];
      assert.ok(context.sources[0]?.connections.includes(inputAnalyser));
    } finally {
      await harness.restore();
    }
  });

  it("D-5 attaches that exact input analyser to the meter", async () => {
    const harness = installHarness();
    try {
      await harness.controller.start();
      await harness.openAndSettle();
      const context = harness.contexts[0];
      const inputAnalyser = context.analysers[1];
      assert.equal(harness.meterCalls.attachInput.length, 1);
      assert.equal(harness.meterCalls.attachInput[0], inputAnalyser);
    } finally {
      await harness.restore();
    }
  });

  it("D-6a fails before minting or opening a socket when permission is denied", async () => {
    const harness = installHarness({ getUserMediaError: new Error("permission denied") });
    try {
      await harness.controller.start();
      assert.equal(harness.fake.status.dataset.state, "failed");
      assert.equal(harness.fetchCalls.length, 0);
      assert.equal(harness.sockets.length, 0);
    } finally {
      await harness.restore();
    }
  });

  it("D-6b stops the acquired track when secret minting fails", async () => {
    const harness = installHarness({ mintFails: true });
    try {
      await harness.controller.start();
      assert.equal(harness.fake.status.dataset.state, "failed");
      assert.equal(harness.fetchCalls[0]?.input, "/v1/realtime/client_secrets");
      assert.equal(harness.sockets.length, 0);
      assert.equal(harness.stream.track.stopCalls, 1);
    } finally {
      await harness.restore();
    }
  });

  it("D-7 does not create audio or attach meters before socket open", async () => {
    const harness = installHarness();
    try {
      await harness.controller.start();
      assert.equal(harness.sockets.length, 1);
      assert.equal(harness.contexts.length, 0);
      assert.equal(harness.meterCalls.attachInput.length, 0);
      assert.equal(harness.meterCalls.attachOutput.length, 0);
    } finally {
      await harness.restore();
    }
  });

  it("D-8 reaches listening only after the full open path succeeds", async () => {
    const harness = installHarness();
    try {
      await harness.controller.start();
      await harness.openAndSettle();
      assert.equal(harness.fake.status.dataset.state, "listening");
      assert.equal(harness.contexts[0]?.addModuleCalls[0], "/assets/pcm-worklet.js");
      assert.equal(harness.meterCalls.attachOutput.length, 1);
      assert.equal(harness.sockets[0]?.sent.length, 1);
      assert.equal(harness.windowListeners.has("online"), true);
      assert.equal(harness.windowListeners.has("offline"), true);
      assert.equal(harness.windowListeners.has("beforeunload"), true);
      assert.equal(harness.intervalIds.size, 1);

      await harness.controller.stop(false);
      assert.equal(harness.meterCalls.resetOutput > 0, true);
      assert.equal(harness.meterCalls.dispose, 1);
      assert.equal(harness.intervalIds.size, 0);
    } finally {
      await harness.restore();
    }
  });
});
