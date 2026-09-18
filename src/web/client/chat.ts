import { streamResponses } from "./api.js";
import type {
  ChatMessage,
  ChatSession,
  ModelRecord,
  ToolView,
  TurnStatus,
} from "./contracts.js";
import { reduceResponseEvent } from "./response-state.js";
import { renderMessage } from "./render.js";

const STORE_KEY = "progrok.web.sessions.v2";
const LEGACY_STORE_KEY = "progrok_sessions";
const MAX_SESSIONS = 50;
const VALID_STATUSES: readonly TurnStatus[] = [
  "composing",
  "queued",
  "streaming",
  "complete",
  "stopped",
  "failed",
];

export interface ChatElements {
  model: HTMLSelectElement;
  sessions: HTMLElement;
  messages: HTMLElement;
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  stop: HTMLButtonElement;
  newSession: HTMLButtonElement;
  status: HTMLElement;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseTool(value: unknown): ToolView | undefined {
  const tool = record(value);
  if (!tool || typeof tool.id !== "string" || typeof tool.type !== "string") {
    return undefined;
  }
  const statuses: ToolView["status"][] = [
    "queued",
    "running",
    "complete",
    "failed",
  ];
  const citations = Array.isArray(tool.citations)
    ? tool.citations.flatMap((entry) => {
        const citation = record(entry);
        return typeof citation?.title === "string" &&
          typeof citation.url === "string"
          ? [{ title: citation.title, url: citation.url }]
          : [];
      })
    : [];
  return {
    id: tool.id,
    type: tool.type,
    ...(typeof tool.name === "string" ? { name: tool.name } : {}),
    status: statuses.includes(tool.status as ToolView["status"])
      ? tool.status as ToolView["status"]
      : "complete",
    argumentsText: typeof tool.argumentsText === "string"
      ? tool.argumentsText
      : "",
    ...(typeof tool.outputText === "string"
      ? { outputText: tool.outputText }
      : {}),
    citations,
  };
}

function parseMessage(value: unknown): ChatMessage | undefined {
  const message = record(value);
  if (!message || (message.role !== "user" && message.role !== "assistant")) {
    return undefined;
  }
  return {
    id: typeof message.id === "string" ? message.id : crypto.randomUUID(),
    role: message.role,
    text: String(message.text ?? message.content ?? ""),
    reasoningSummary: String(
      message.reasoningSummary ?? message._reasoning ?? "",
    ),
    tools: Array.isArray(message.tools)
      ? message.tools.flatMap((tool) => {
          const parsed = parseTool(tool);
          return parsed ? [parsed] : [];
        })
      : [],
    status: VALID_STATUSES.includes(message.status as TurnStatus)
      ? message.status as TurnStatus
      : "complete",
  };
}

export class ChatController {
  #sessions: ChatSession[] = [];
  #currentId = "";
  #active?: AbortController;
  #modelIds = new Set<string>();

  constructor(private readonly el: ChatElements) {}

  async init(models: ModelRecord[]): Promise<void> {
    this.loadRuntimeModels(models);
    this.#sessions = this.loadSessions();
    for (const session of this.#sessions) {
      if (!this.#modelIds.has(session.model)) session.model = models[0].id;
    }
    if (this.#sessions.length === 0) this.createSession();
    this.#currentId = this.#sessions[0].id;
    this.el.model.value = this.#sessions[0].model;
    this.el.input.disabled = false;
    this.el.send.disabled = false;
    this.el.newSession.disabled = false;
    this.bind();
    this.persist();
    this.render();
  }

  stop(): void {
    const active = this.#active;
    if (!active) return;
    active.abort(new DOMException("Stopped by user", "AbortError"));
    const message = this.current().messages.at(-1);
    if (message?.role === "assistant" && message.status === "streaming") {
      message.status = "stopped";
      this.persist();
      this.render();
    }
  }

  private loadRuntimeModels(models: ModelRecord[]): void {
    const sorted = [...models].sort((a, b) => a.id.localeCompare(b.id));
    if (sorted.length === 0) throw new Error("No runtime models are available");
    this.#modelIds = new Set(sorted.map((model) => model.id));
    this.el.model.replaceChildren(
      ...sorted.map((model) => new Option(model.id, model.id)),
    );
    this.el.model.disabled = false;
  }

  private async send(text: string): Promise<void> {
    const value = text.trim();
    if (!value || this.#active) return;
    const session = this.current();
    const user: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: value,
      reasoningSummary: "",
      tools: [],
      status: "complete",
    };
    const assistant: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "",
      reasoningSummary: "",
      tools: [],
      status: "queued",
    };
    session.messages.push(user, assistant);
    session.model = this.el.model.value;
    if (session.title === "New chat") session.title = value.slice(0, 60);
    const active = new AbortController();
    this.#active = active;
    this.render();

    try {
      assistant.status = "streaming";
      this.render();
      for await (const event of streamResponses({
        model: session.model,
        input: session.messages
          .filter((message) => message !== assistant)
          .map((message) => ({
            role: message.role,
            content: message.text,
          })),
        stream: true,
      }, active.signal)) {
        const terminal = reduceResponseEvent(assistant, event);
        this.renderMessages();
        if (terminal !== "continue") break;
      }
      if (assistant.status === "streaming") {
        assistant.status = "failed";
        assistant.text ||= "The stream ended before a terminal event.";
      }
    } catch (error) {
      if (active.signal.aborted) {
        assistant.status = "stopped";
      } else {
        assistant.status = "failed";
        assistant.text ||= error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (this.#active === active) this.#active = undefined;
      this.persist();
      this.render();
    }
  }

  private bind(): void {
    this.el.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = this.el.input.value;
      if (!value.trim()) return;
      this.el.input.value = "";
      void this.send(value);
    });
    this.el.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.el.form.requestSubmit();
      }
    });
    this.el.stop.addEventListener("click", () => this.stop());
    this.el.newSession.addEventListener("click", () => {
      this.createSession();
      this.render();
      this.el.input.focus();
    });
    this.el.model.addEventListener("change", () => {
      this.current().model = this.el.model.value;
      this.persist();
    });
  }

  private current(): ChatSession {
    const session = this.#sessions.find(
      (candidate) => candidate.id === this.#currentId,
    );
    if (!session) throw new Error("Current chat session is missing");
    return session;
  }

  private createSession(): void {
    const session: ChatSession = {
      id: crypto.randomUUID(),
      model: this.el.model.value,
      title: "New chat",
      createdAt: Date.now(),
      messages: [],
    };
    this.#sessions.unshift(session);
    this.#sessions = this.#sessions.slice(0, MAX_SESSIONS);
    this.#currentId = session.id;
    this.persist();
  }

  private loadSessions(): ChatSession[] {
    const raw = localStorage.getItem(STORE_KEY) ??
      localStorage.getItem(LEGACY_STORE_KEY);
    if (!raw) return [];
    try {
      const values: unknown = JSON.parse(raw);
      if (!Array.isArray(values)) return [];
      return values.slice(0, MAX_SESSIONS).flatMap((value) => {
        const session = record(value);
        if (!session || typeof session.id !== "string" ||
          !Array.isArray(session.messages)) return [];
        return [{
          id: session.id,
          model: typeof session.model === "string" ? session.model : "",
          title: String(session.title ?? session.preview ?? "New chat"),
          createdAt: typeof session.createdAt === "number"
            ? session.createdAt
            : Date.now(),
          messages: session.messages.flatMap((message) => {
            const parsed = parseMessage(message);
            return parsed ? [parsed] : [];
          }),
        }];
      });
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify(this.#sessions.slice(0, MAX_SESSIONS)),
      );
      localStorage.removeItem(LEGACY_STORE_KEY);
    } catch {
      this.el.status.textContent = "Session history could not be saved.";
    }
  }

  private renderMessages(): void {
    const messages = this.current().messages;
    if (messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const heading = document.createElement("h2");
      heading.textContent = "Start a conversation";
      const copy = document.createElement("p");
      copy.textContent = "Responses stream here with reasoning summaries and tool activity.";
      empty.append(heading, copy);
      this.el.messages.replaceChildren(empty);
    } else {
      this.el.messages.replaceChildren(...messages.map(renderMessage));
    }
    this.el.messages.scrollTop = this.el.messages.scrollHeight;
  }

  private render(): void {
    this.renderMessages();
    this.el.sessions.replaceChildren(...this.#sessions.map((session) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = session.title;
      button.title = session.title;
      if (session.id === this.#currentId) {
        button.setAttribute("aria-current", "true");
      }
      button.addEventListener("click", () => {
        this.#currentId = session.id;
        this.el.model.value = this.#modelIds.has(session.model)
          ? session.model
          : this.el.model.options[0].value;
        session.model = this.el.model.value;
        this.render();
      });
      return button;
    }));
    const active = Boolean(this.#active);
    this.el.send.hidden = active;
    this.el.stop.hidden = !active;
    this.el.model.disabled = active;
    this.el.newSession.disabled = active;
    this.el.status.textContent = active ? "Generating response" : "Ready";
  }
}
