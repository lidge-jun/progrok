const messagesEl = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");
const modelSelect = document.getElementById("model-select");
const clearBtn = document.getElementById("clear-btn");

let messages = [];
let streaming = false;

function addMessage(role, content) {
  messages.push({ role, content });
  renderMessages();
}

function renderMessages() {
  messagesEl.innerHTML = "";
  for (const msg of messages) {
    const div = document.createElement("div");
    div.className = "message " + msg.role;
    const roleLabel = document.createElement("div");
    roleLabel.className = "role";
    roleLabel.textContent = msg.role === "user" ? "You" : "Grok";
    div.appendChild(roleLabel);
    const content = document.createElement("div");
    content.textContent = msg.content;
    div.appendChild(content);
    messagesEl.appendChild(div);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function sendMessage(text) {
  if (!text.trim() || streaming) return;

  addMessage("user", text.trim());
  input.value = "";
  input.style.height = "auto";
  streaming = true;
  sendBtn.disabled = true;

  const model = modelSelect.value;
  const assistantMsg = { role: "assistant", content: "" };
  messages.push(assistantMsg);

  try {
    const res = await fetch("/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer progrok-local",
      },
      body: JSON.stringify({
        model,
        input: messages.slice(0, -1).map(function (m) {
          return { role: m.role, content: m.content };
        }),
        stream: true,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(function () {
        return { error: { message: res.statusText } };
      });
      assistantMsg.content = "Error: " + (err.error?.message || res.statusText);
      renderMessages();
      return;
    }

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
            renderMessages();
          } else if (event.type === "response.completed") {
            const output = event.response?.output;
            if (Array.isArray(output)) {
              for (const item of output) {
                if (item.type === "message" && Array.isArray(item.content)) {
                  for (const part of item.content) {
                    if (part.type === "output_text" && !assistantMsg.content) {
                      assistantMsg.content = part.text;
                    }
                  }
                }
              }
            }
            renderMessages();
          }
        } catch (_e) {
          /* skip unparseable events */
        }
      }
    }
  } catch (err) {
    assistantMsg.content = "Connection error: " + err.message;
  } finally {
    streaming = false;
    sendBtn.disabled = false;
    renderMessages();
  }
}

form.addEventListener("submit", function (e) {
  e.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage(input.value);
  }
});

input.addEventListener("input", function () {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
});

clearBtn.addEventListener("click", function () {
  messages = [];
  renderMessages();
  input.focus();
});

fetch("/v1/models", {
  headers: { Authorization: "Bearer progrok-local" },
})
  .then(function (r) { return r.json(); })
  .then(function (data) {
    if (data.data && Array.isArray(data.data)) {
      modelSelect.innerHTML = "";
      for (const m of data.data) {
        if (m.id.startsWith("grok-imagine") || m.id.startsWith("grok-vision")) continue;
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.id;
        if (m.id === "grok-4.3") opt.selected = true;
        modelSelect.appendChild(opt);
      }
    }
  })
  .catch(function () {
    /* use static list */
  });
