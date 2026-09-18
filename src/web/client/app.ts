import { listModels } from "./api.js";
import { ChatController } from "./chat.js";
import { MediaController } from "./media.js";
import { activateTabs } from "./render.js";
import { VoiceController } from "./voice.js";

function required<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing required element: ${selector}`);
  return value;
}

function disableModelDependentControls(): void {
  for (const element of document.querySelectorAll<
    HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement
  >("#chat-panel button, #chat-panel select, #chat-panel textarea, #media-panel button, #media-panel select, #media-panel textarea")) {
    element.disabled = true;
  }
}

async function main(): Promise<void> {
  activateTabs(required<HTMLElement>("#workspace-tabs"));

  const voice = new VoiceController({
    mode: required("#voice-mode"),
    model: required("#voice-model"),
    voice: required("#voice-name"),
    start: required("#voice-start"),
    finish: required("#voice-finish"),
    stop: required("#voice-stop"),
    mute: required("#voice-mute"),
    status: required("#voice-status"),
    userTranscript: required("#voice-user-transcript"),
    assistantTranscript: required("#voice-assistant-transcript"),
    assistantTurn: required("#voice-assistant-turn"),
    inputMeter: required("#voice-input-meter"),
    outputMeter: required("#voice-output-meter"),
    elapsedRow: required("#voice-elapsed-row"),
    elapsed: required("#voice-elapsed"),
    lastEventRow: required("#voice-event-row"),
    lastEvent: required("#voice-last-event"),
    transport: required("#voice-transport"),
    endpointRow: required("#voice-endpoint-row"),
    endpoint: required("#voice-endpoint"),
    rateRow: required("#voice-rate-row"),
    rate: required("#voice-rate"),
    deviceRow: required("#voice-device-row"),
    device: required("#voice-device"),
    networkRow: required("#voice-network-row"),
    network: required("#voice-network"),
    events: required("#voice-events"),
  });
  voice.init();

  try {
    const models = await listModels();
    const chatModels = models.filter((model) => !model.id.includes("imagine-"));
    const chat = new ChatController({
      model: required("#chat-model"),
      sessions: required("#session-list"),
      messages: required("#messages"),
      form: required("#chat-form"),
      input: required("#chat-input"),
      send: required("#chat-send"),
      stop: required("#chat-stop"),
      newSession: required("#new-session"),
      status: required("#chat-status"),
    });
    await chat.init(chatModels);

    const media = new MediaController({
      kind: required("#media-kind"),
      model: required("#media-model"),
      prompt: required("#media-prompt"),
      form: required("#media-form"),
      submit: required("#media-submit"),
      progress: required("#media-progress"),
      status: required("#media-status"),
      results: required("#media-results"),
    }, models);
    media.init();
  } catch (error) {
    disableModelDependentControls();
    const fatal = required<HTMLElement>("#fatal-error");
    fatal.hidden = false;
    fatal.textContent = error instanceof Error ? error.message : String(error);
  }
}

void main();
