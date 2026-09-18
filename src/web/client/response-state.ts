import type { ChatMessage, ToolView } from "./contracts.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toolId(
  item: Record<string, unknown>,
  message: ChatMessage,
): string {
  for (const key of ["id", "item_id", "call_id"]) {
    if (typeof item[key] === "string" && item[key].length > 0) {
      return item[key];
    }
  }
  if (Number.isSafeInteger(item.output_index)) {
    return `${String(item.type ?? "tool")}:${String(item.output_index)}`;
  }
  return `${String(item.type ?? "tool")}:${message.tools.length}`;
}

function upsertTool(
  message: ChatMessage,
  item: Record<string, unknown>,
): ToolView {
  const id = toolId(item, message);
  let tool = message.tools.find((candidate) => candidate.id === id);
  if (!tool) {
    tool = {
      id,
      type: String(item.type ?? "tool"),
      ...(typeof item.name === "string" ? { name: item.name } : {}),
      status: "running",
      argumentsText: "",
      citations: [],
    };
    message.tools.push(tool);
  } else if (typeof item.name === "string") {
    tool.name = item.name;
  }
  return tool;
}

function citationList(item: Record<string, unknown>): ToolView["citations"] {
  const action = record(item.action);
  const candidates = [item.sources, action?.sources, item.results]
    .find(Array.isArray);
  if (!Array.isArray(candidates)) return [];
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const source = record(candidate);
    if (!source || typeof source.url !== "string" || seen.has(source.url)) {
      return [];
    }
    seen.add(source.url);
    return [{
      title: typeof source.title === "string" ? source.title : source.url,
      url: source.url,
    }];
  });
}

function failureMessage(event: Record<string, unknown>): string | undefined {
  const response = record(event.response);
  const error = record(event.error) ?? record(response?.error);
  if (typeof error?.message === "string") return error.message;
  const details = record(response?.incomplete_details);
  if (typeof details?.reason === "string") return details.reason;
  return undefined;
}

export type ReduceResult = "continue" | "complete" | "failed";

export function reduceResponseEvent(
  message: ChatMessage,
  wire: unknown,
): ReduceResult {
  const event = record(wire);
  if (!event || typeof event.type !== "string") return "continue";

  if (
    event.type === "response.output_text.delta" &&
    typeof event.delta === "string"
  ) {
    message.text += event.delta;
  } else if (
    (event.type === "response.reasoning_summary_text.delta" ||
      event.type === "response.reasoning_text.delta") &&
    typeof event.delta === "string"
  ) {
    message.reasoningSummary += event.delta;
  } else if (event.type === "response.output_item.added") {
    const item = record(event.item);
    if (item && item.type !== "message" && item.type !== "reasoning") {
      upsertTool(message, { ...event, ...item }).status = "running";
    }
  } else if (
    /^response\.(?:web_search_call|x_search_call|mcp_call|file_search_call|code_interpreter_call|image_generation_call)\.(?:queued|searching|in_progress|completed|failed)$/.test(
      event.type,
    )
  ) {
    const tool = upsertTool(message, event);
    tool.type = event.type.split(".")[1];
    tool.status = event.type.endsWith(".failed")
      ? "failed"
      : event.type.endsWith(".completed")
        ? "complete"
        : event.type.endsWith(".queued")
          ? "queued"
          : "running";
  } else if (event.type === "response.function_call_arguments.delta") {
    const tool = upsertTool(message, event);
    if (typeof event.delta === "string") tool.argumentsText += event.delta;
  } else if (event.type === "response.function_call_arguments.done") {
    const tool = upsertTool(message, event);
    if (typeof event.arguments === "string") {
      tool.argumentsText = event.arguments;
    }
  } else if (event.type === "response.output_item.done") {
    const item = record(event.item);
    if (item && item.type !== "message" && item.type !== "reasoning") {
      const tool = upsertTool(message, { ...event, ...item });
      tool.status = item.status === "failed" ? "failed" : "complete";
      if (typeof item.arguments === "string") {
        tool.argumentsText = item.arguments;
      }
      const output = textValue(item.output ?? item.result);
      if (output !== undefined) tool.outputText = output;
      tool.citations = citationList(item);
    }
  } else if (event.type === "response.completed") {
    message.status = "complete";
    return "complete";
  } else if (
    event.type === "response.failed" ||
    event.type === "response.incomplete" ||
    event.type === "response.cancelled" ||
    event.type === "error"
  ) {
    message.status = "failed";
    if (!message.text) {
      message.text = failureMessage(event) ?? "The response failed.";
    }
    return "failed";
  }
  return "continue";
}
