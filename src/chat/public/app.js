import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";

// --- Marked config ---
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      const langClass = lang ? ` class="language-${lang}"` : "";
      const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<div class="code-wrap"><button class="code-copy" onclick="copyCode(this)">Copy</button><pre><code${langClass}>${escaped}</code></pre></div>`;
    },
  },
});

// --- DOM refs ---
const messagesEl = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");
const modelSelect = document.getElementById("model-select");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sessionListEl = document.getElementById("session-list");
const newChatBtn = document.getElementById("new-chat-btn");
const spinnerEl = document.getElementById("spinner");

// --- State ---
const MAX_SESSIONS = 50;
let sessions = loadSessions();
let currentSessionId = null;
let streaming = false;

// --- Session Management ---
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem("progrok_sessions") || "[]");
  } catch { return []; }
}

function saveSessions() {
  while (sessions.length > MAX_SESSIONS) sessions.pop();
  localStorage.setItem("progrok_sessions", JSON.stringify(sessions));
}

function getSession(id) {
  return sessions.find(function(s) { return s.id === id; });
}

function createSession() {
  const s = {
    id: genId(),
    model: modelSelect.value,
    messages: [],
    preview: "New chat",
    createdAt: Date.now(),
  };
  sessions.unshift(s);
  saveSessions();
  return s;
}

function switchSession(id) {
  currentSessionId = id;
  const s = getSession(id);
  if (s) {
    modelSelect.value = s.model;
    renderMessages(s.messages);
  }
  renderSessionList();
  localStorage.setItem("progrok_current", id);
}

function deleteSession(id) {
  sessions = sessions.filter(function(s) { return s.id !== id; });
  saveSessions();
  if (currentSessionId === id) {
    if (sessions.length > 0) {
      switchSession(sessions[0].id);
    } else {
      const s = createSession();
      switchSession(s.id);
    }
  }
  renderSessionList();
}

// --- Rendering ---
function renderSessionList() {
  sessionListEl.innerHTML = "";
  for (const s of sessions) {
    const div = document.createElement("div");
    div.className = "session-item" + (s.id === currentSessionId ? " active" : "");
    div.textContent = s.preview || "New chat";

    const modelSpan = document.createElement("span");
    modelSpan.className = "session-model";
    modelSpan.textContent = s.model;
    div.appendChild(modelSpan);

    div.addEventListener("click", function() { switchSession(s.id); });
    sessionListEl.appendChild(div);
  }
}

function renderMessages(messages) {
  messagesEl.innerHTML = "";
  for (const msg of messages) {
    appendMessageEl(msg);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMessageEl(msg) {
  const div = document.createElement("div");
  div.className = "message " + msg.role;

  const roleLabel = document.createElement("div");
  roleLabel.className = "role";
  roleLabel.textContent = msg.role === "user" ? "You" : "Grok";
  div.appendChild(roleLabel);

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (msg.role === "assistant") {
    bubble.classList.add("md-content");
    bubble.innerHTML = renderMarkdown(msg.content);
    highlightAll(bubble);

    if (msg.tools && msg.tools.length > 0) {
      for (const tool of msg.tools) {
        bubble.appendChild(createToolEl(tool));
      }
    }

    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-copy";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", function() { copyText(msg.content, copyBtn); });
    div.appendChild(copyBtn);
  } else {
    bubble.textContent = msg.content;
  }

  div.appendChild(bubble);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMarkdown(text) {
  if (!text) return "";
  try {
    return marked.parse(text);
  } catch {
    return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}

function highlightAll(container) {
  const blocks = container.querySelectorAll("pre code");
  for (const block of blocks) {
    if (typeof hljs !== "undefined") {
      hljs.highlightElement(block);
    }
  }
}

function createToolEl(tool) {
  const wrap = document.createElement("div");
  wrap.className = "tool-result";

  const header = document.createElement("div");
  header.className = "tool-header";

  const icon = document.createElement("span");
  icon.className = "tool-icon";
  icon.textContent = tool.type === "x_search_call" ? "𝕏" : "🔍";

  const label = document.createElement("span");
  label.textContent = tool.type === "x_search_call" ? "X Search" : "Web Search";

  const arrow = document.createElement("span");
  arrow.className = "tool-arrow";
  arrow.textContent = "▸";

  header.appendChild(icon);
  header.appendChild(label);
  header.appendChild(arrow);

  const body = document.createElement("div");
  body.className = "tool-body";

  if (tool.citations && tool.citations.length > 0) {
    for (const cite of tool.citations) {
      const a = document.createElement("a");
      a.className = "tool-citation";
      a.href = cite.url || "#";
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = cite.title || cite.url || "Source";
      body.appendChild(a);
    }
  } else {
    body.textContent = tool.query || "Search performed";
  }

  header.addEventListener("click", function() {
    arrow.classList.toggle("open");
    body.classList.toggle("open");
  });

  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

// --- Copy ---
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(function() {
    const orig = btn.textContent;
    btn.textContent = "✓";
    btn.classList.add("copied");
    setTimeout(function() {
      btn.textContent = orig;
      btn.classList.remove("copied");
    }, 1500);
  });
}

window.copyCode = function(btn) {
  const pre = btn.parentElement.querySelector("pre code");
  if (pre) copyText(pre.textContent, btn);
};

// --- Spinner ---
function showSpinner() { spinnerEl.classList.remove("hidden"); }
function hideSpinner() { spinnerEl.classList.add("hidden"); }

// --- Streaming Chat ---
async function sendMessage(text) {
  if (!text.trim() || streaming) return;

  let session = getSession(currentSessionId);
  if (!session) {
    session = createSession();
    switchSession(session.id);
  }

  const userMsg = { role: "user", content: text.trim() };
  session.messages.push(userMsg);
  if (session.messages.length === 1) {
    session.preview = text.trim().slice(0, 60);
  }
  session.model = modelSelect.value;
  saveSessions();
  renderSessionList();

  appendMessageEl(userMsg);
  input.value = "";
  input.style.height = "auto";
  streaming = true;
  sendBtn.disabled = true;
  showSpinner();

  const assistantMsg = { role: "assistant", content: "", tools: [] };

  try {
    const res = await fetch("/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer progrok-local",
      },
      body: JSON.stringify({
        model: modelSelect.value,
        input: session.messages.filter(function(m) { return m.role !== "system"; }).map(function(m) {
          return { role: m.role, content: m.content };
        }),
        stream: true,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(function() { return { error: { message: res.statusText } }; });
      assistantMsg.content = "Error: " + (err.error?.message || res.statusText);
      hideSpinner();
      session.messages.push(assistantMsg);
      saveSessions();
      appendMessageEl(assistantMsg);
      return;
    }

    hideSpinner();
    session.messages.push(assistantMsg);

    const msgDiv = document.createElement("div");
    msgDiv.className = "message assistant";
    const roleLabel = document.createElement("div");
    roleLabel.className = "role";
    roleLabel.textContent = "Grok";
    msgDiv.appendChild(roleLabel);
    const bubble = document.createElement("div");
    bubble.className = "bubble md-content";
    msgDiv.appendChild(bubble);

    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-copy";
    copyBtn.textContent = "Copy";
    msgDiv.appendChild(copyBtn);
    messagesEl.appendChild(msgDiv);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const event = JSON.parse(data);

          if (event.type === "response.output_text.delta") {
            assistantMsg.content += event.delta || "";
            bubble.innerHTML = renderMarkdown(assistantMsg.content);
            highlightAll(bubble);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          } else if (event.type === "response.completed") {
            const output = event.response?.output;
            if (Array.isArray(output)) {
              for (const item of output) {
                if (item.type === "web_search_call" || item.type === "x_search_call") {
                  const toolInfo = {
                    type: item.type,
                    query: item.query || item.search_query || "",
                    citations: [],
                  };
                  if (item.results && Array.isArray(item.results)) {
                    toolInfo.citations = item.results.map(function(r) {
                      return { title: r.title, url: r.url };
                    });
                  }
                  assistantMsg.tools.push(toolInfo);
                }
                if (item.type === "message" && Array.isArray(item.content)) {
                  for (const part of item.content) {
                    if (part.type === "output_text" && !assistantMsg.content) {
                      assistantMsg.content = part.text;
                    }
                    if (part.annotations && Array.isArray(part.annotations)) {
                      for (const ann of part.annotations) {
                        if (ann.type === "url_citation") {
                          const existing = assistantMsg.tools.find(function(t) { return t.type === "citations"; });
                          if (existing) {
                            existing.citations.push({ title: ann.title, url: ann.url });
                          } else {
                            assistantMsg.tools.push({
                              type: "citations",
                              query: "Citations",
                              citations: [{ title: ann.title, url: ann.url }],
                            });
                          }
                        }
                      }
                    }
                  }
                }
              }
            }

            bubble.innerHTML = renderMarkdown(assistantMsg.content);
            highlightAll(bubble);

            if (assistantMsg.tools.length > 0) {
              for (const tool of assistantMsg.tools) {
                bubble.appendChild(createToolEl(tool));
              }
            }
          }
        } catch (_e) { /* skip */ }
      }
    }

    copyBtn.addEventListener("click", function() { copyText(assistantMsg.content, copyBtn); });
    saveSessions();
  } catch (err) {
    hideSpinner();
    assistantMsg.content = "Connection error: " + err.message;
    session.messages.push(assistantMsg);
    saveSessions();
    appendMessageEl(assistantMsg);
  } finally {
    streaming = false;
    sendBtn.disabled = false;
  }
}

// --- Events ---
form.addEventListener("submit", function(e) {
  e.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("keydown", function(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage(input.value);
  }
});

input.addEventListener("input", function() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
});

sidebarToggle.addEventListener("click", function() {
  sidebar.classList.toggle("collapsed");
});

newChatBtn.addEventListener("click", function() {
  const s = createSession();
  switchSession(s.id);
  input.focus();
});

modelSelect.addEventListener("change", function() {
  const s = getSession(currentSessionId);
  if (s) {
    s.model = modelSelect.value;
    saveSessions();
    renderSessionList();
  }
  localStorage.setItem("progrok_model", modelSelect.value);
});

// --- Init ---
const DEFAULT_MODELS = [
  { id: "grok-4.3", label: "Grok 4.3" },
  { id: "grok-4.20-beta-latest-reasoning", label: "Grok 4.20 Reasoning" },
  { id: "grok-4.20-beta-latest-non-reasoning", label: "Grok 4.20 Fast" },
  { id: "grok-build-0.1", label: "Grok Build" },
];

function initModels() {
  modelSelect.innerHTML = "";
  for (const m of DEFAULT_MODELS) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    modelSelect.appendChild(opt);
  }

  const saved = localStorage.getItem("progrok_model");
  if (saved) modelSelect.value = saved;

  fetch("/v1/models", { headers: { Authorization: "Bearer progrok-local" } })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.data && Array.isArray(data.data)) {
        const models = data.data.filter(function(m) {
          return !m.id.startsWith("grok-imagine") && !m.id.startsWith("grok-vision");
        });
        if (models.length > 0) {
          modelSelect.innerHTML = "";
          for (const m of models) {
            const opt = document.createElement("option");
            opt.value = m.id;
            opt.textContent = m.id;
            modelSelect.appendChild(opt);
          }
          if (saved) modelSelect.value = saved;
        }
      }
    })
    .catch(function() { /* use defaults */ });
}

function init() {
  initModels();

  if (sessions.length === 0) {
    const s = createSession();
    switchSession(s.id);
  } else {
    const lastId = localStorage.getItem("progrok_current");
    const target = lastId && getSession(lastId) ? lastId : sessions[0].id;
    switchSession(target);
  }

  renderSessionList();
}

init();
