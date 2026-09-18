import { listModels } from "./api.js";
import { ChatController } from "./chat.js";
import type { ModelRecord } from "./contracts.js";
import { MediaController } from "./media.js";
import { activateTabs } from "./render.js";
import { VoiceController } from "./voice.js";

function required<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing required element: ${selector}`);
  return value;
}

function show(rowId: string, valueId: string, value: string): void {
  const row = document.getElementById(rowId);
  const slot = document.getElementById(valueId);
  if (!row || !slot) return;
  slot.textContent = value;
  row.hidden = false;
}

function disablePanel(panel: string): void {
  for (const element of document.querySelectorAll<
    HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement
  >(`${panel} button, ${panel} select, ${panel} textarea`)) {
    element.disabled = true;
  }
}

/**
 * Renders a panel-scoped failure with its own retry, so one surface going down
 * never blanks the others. The banner owns the retry button and is removed
 * before a new mount so listeners cannot stack up.
 */
function panelError(
  panel: HTMLElement,
  message: string,
  retry: () => Promise<void>,
): void {
  panel.querySelector(".banner--panel")?.remove();
  const banner = document.createElement("p");
  banner.className = "banner banner--panel";
  banner.setAttribute("role", "alert");
  const text = document.createElement("span");
  text.textContent = message;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button";
  button.textContent = "Retry";
  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = "Retrying";
    void retry().finally(() => {
      button.disabled = false;
      button.textContent = "Retry";
    });
  });
  banner.append(text, button);
  panel.prepend(banner);
}

async function main(): Promise<void> {
  activateTabs(required<HTMLElement>("#workspace-tabs"));
  show("rt-endpoint-row", "rt-endpoint", `${location.origin}/v1`);

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

  const chatPanel = required<HTMLElement>("#chat-panel");
  const mediaPanel = required<HTMLElement>("#media-panel");
  let chatMount: AbortController | undefined;
  let mediaMount: AbortController | undefined;

  const mountChat = async (models: ModelRecord[]): Promise<void> => {
    chatMount?.abort();
    chatMount = new AbortController();
    const chatModels = models.filter((model) => !model.id.includes("imagine-"));
    const modelSelect = required<HTMLSelectElement>("#chat-model");
    const chat = new ChatController({
      model: modelSelect,
      sessions: required("#session-list"),
      messages: required("#messages"),
      form: required("#chat-form"),
      input: required("#chat-input"),
      send: required("#chat-send"),
      stop: required("#chat-stop"),
      newSession: required("#new-session"),
      status: required("#chat-status"),
      jump: required("#chat-jump"),
    }, chatMount.signal);
    await chat.init(chatModels);
    chatPanel.querySelector(".banner--panel")?.remove();
    show("rt-model-row", "rt-model", modelSelect.value);
    modelSelect.addEventListener("change", () => {
      show("rt-model-row", "rt-model", modelSelect.value);
    }, { signal: chatMount.signal });
  };

  const mountMedia = (models: ModelRecord[]): void => {
    mediaMount?.abort();
    mediaMount = new AbortController();
    const media = new MediaController({
      kind: required("#media-kind"),
      model: required("#media-model"),
      prompt: required("#media-prompt"),
      form: required("#media-form"),
      submit: required("#media-submit"),
      progress: required("#media-progress"),
      status: required("#media-status"),
      results: required("#media-results"),
    }, models, mediaMount.signal);
    media.init();
    mediaPanel.querySelector(".banner--panel")?.remove();
  };

  const mountCatalogSurfaces = async (): Promise<void> => {
    let models: ModelRecord[];
    try {
      models = await listModels();
      show("rt-catalog-row", "rt-catalog", `${models.length} models`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      show("rt-catalog-row", "rt-catalog", "unavailable");
      disablePanel("#chat-panel");
      disablePanel("#media-panel");
      panelError(chatPanel, message, mountCatalogSurfaces);
      panelError(mediaPanel, message, mountCatalogSurfaces);
      return;
    }
    try {
      await mountChat(models);
    } catch (error) {
      disablePanel("#chat-panel");
      panelError(
        chatPanel,
        error instanceof Error ? error.message : String(error),
        mountCatalogSurfaces,
      );
    }
    try {
      mountMedia(models);
    } catch (error) {
      disablePanel("#media-panel");
      panelError(
        mediaPanel,
        error instanceof Error ? error.message : String(error),
        mountCatalogSurfaces,
      );
    }
  };

  await mountCatalogSurfaces();
}

void main().catch((error: unknown) => {
  const fatal = document.querySelector<HTMLElement>("#fatal-error");
  if (!fatal) return;
  fatal.hidden = false;
  fatal.textContent = error instanceof Error ? error.message : String(error);
});

