import type { ChatMessage, ToolView } from "./contracts.js";

export function clear(node: Element): void {
  node.replaceChildren();
}

export function renderSafeText(
  container: HTMLElement,
  text: string,
): void {
  clear(container);
  const parts = text.split(/```/);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = part.replace(/^\w+\n/, "");
      pre.append(code);
      container.append(pre);
      return;
    }
    for (const paragraph of part.split(/\n{2,}/)) {
      if (!paragraph) continue;
      const p = document.createElement("p");
      p.textContent = paragraph;
      container.append(p);
    }
  });
}

function safeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function payloadBlock(label: string, value: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "tool-call__payload";
  const heading = document.createElement("strong");
  heading.textContent = label;
  const pre = document.createElement("pre");
  pre.textContent = value;
  wrapper.append(heading, pre);
  return wrapper;
}

function renderTool(tool: ToolView): HTMLElement {
  const details = document.createElement("details");
  details.className = "tool-call";
  details.dataset.status = tool.status;
  const summary = document.createElement("summary");
  const name = document.createElement("span");
  name.textContent = tool.name ?? tool.type.replaceAll("_", " ");
  const status = document.createElement("span");
  status.className = "tool-call__status";
  status.textContent = tool.status;
  summary.append(name, status);
  details.append(summary);
  if (tool.argumentsText) {
    details.append(payloadBlock("Arguments", tool.argumentsText));
  }
  if (tool.outputText) {
    details.append(payloadBlock("Output", tool.outputText));
  }
  if (!tool.argumentsText && !tool.outputText && tool.citations.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No payload was returned.";
    details.append(empty);
  }
  if (tool.citations.length > 0) {
    const list = document.createElement("ul");
    list.className = "citation-list";
    for (const citation of tool.citations) {
      const href = safeExternalUrl(citation.url);
      if (!href) continue;
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = citation.title;
      item.append(link);
      list.append(item);
    }
    if (list.childElementCount > 0) details.append(list);
  }
  return details;
}

export function renderMessage(message: ChatMessage): HTMLElement {
  const article = document.createElement("article");
  article.className = `message message--${message.role}`;
  article.dataset.status = message.status;
  article.setAttribute(
    "aria-label",
    `${message.role === "user" ? "You" : "Grok"}, ${message.status}`,
  );

  const label = document.createElement("p");
  label.className = "message__label";
  label.textContent = message.role === "user" ? "You" : "Grok";
  const body = document.createElement("div");
  body.className = "message__body";
  renderSafeText(body, message.text);
  article.append(label, body);

  if (message.reasoningSummary) {
    const reasoning = document.createElement("details");
    reasoning.className = "reasoning";
    const summary = document.createElement("summary");
    summary.textContent = "Reasoning summary";
    const text = document.createElement("p");
    text.textContent = message.reasoningSummary;
    reasoning.append(summary, text);
    article.append(reasoning);
  }
  for (const tool of message.tools) article.append(renderTool(tool));
  return article;
}

export function activateTabs(tabList: HTMLElement): void {
  const tabs = Array.from(
    tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  const activate = (tab: HTMLButtonElement, moveFocus: boolean): void => {
    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.setAttribute("aria-selected", String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      const panelId = candidate.getAttribute("aria-controls") ?? "";
      const panel = document.getElementById(panelId);
      if (panel) panel.hidden = !selected;
    }
    if (moveFocus) tab.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab, false));
    tab.addEventListener("keydown", (event) => {
      const next = event.key === "ArrowRight" || event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : index;
      if (next === index) return;
      event.preventDefault();
      activate(tabs[(next + tabs.length) % tabs.length], true);
    });
  });
}
