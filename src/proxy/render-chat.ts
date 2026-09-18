import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Response } from "express";
import type { AdapterEvent } from "../core/events.js";

export interface ChatRenderContext {
  model: string;
  id?: string;
  created?: number;
}

async function writeChunk(res: Response, chunk: string): Promise<void> {
  if (!res.write(chunk)) await once(res, "drain");
}

function encodedData(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

export async function renderChatEvents(
  first: AdapterEvent,
  rest: AsyncIterator<AdapterEvent>,
  res: Response,
  context: ChatRenderContext,
): Promise<void> {
  const id = context.id ?? `chatcmpl_progrok_${randomUUID()}`;
  const created = context.created ?? Math.floor(Date.now() / 1000);
  const toolIndexes = new Map<string, number>();
  let nextToolIndex = 0;

  const render = async (event: AdapterEvent): Promise<boolean> => {
    const base = {
      id,
      object: "chat.completion.chunk",
      created,
      model: context.model,
    };

    switch (event.type) {
      case "heartbeat":
        await writeChunk(res, ": progrok\n\n");
        return false;
      case "text_delta":
        await writeChunk(res, encodedData({
          ...base,
          choices: [{
            index: 0,
            delta: { content: event.text },
            finish_reason: null,
          }],
        }));
        return false;
      case "reasoning_delta":
        await writeChunk(res, encodedData({
          ...base,
          choices: [{
            index: 0,
            delta: { reasoning_content: event.text },
            finish_reason: null,
          }],
        }));
        return false;
      case "tool_call_start": {
        const index = nextToolIndex;
        nextToolIndex += 1;
        toolIndexes.set(event.id, index);
        await writeChunk(res, encodedData({
          ...base,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index,
                id: event.id,
                type: "function",
                function: { name: event.name, arguments: "" },
              }],
            },
            finish_reason: null,
          }],
        }));
        return false;
      }
      case "tool_call_delta":
        await writeChunk(res, encodedData({
          ...base,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: toolIndexes.get(event.id),
                function: { arguments: event.arguments },
              }],
            },
            finish_reason: null,
          }],
        }));
        return false;
      case "tool_call_end":
        return false;
      case "done":
        await writeChunk(res, encodedData({
          ...base,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: event.finishReason ?? "stop",
          }],
          ...(event.usage ? { usage: event.usage.raw ?? event.usage } : {}),
        }));
        await writeChunk(res, "data: [DONE]\n\n");
        return true;
      case "incomplete":
        await writeChunk(res, encodedData({
          error: {
            message: event.reason,
            type: "upstream_error",
            code: "stream_truncated",
          },
        }));
        return true;
      case "error":
        await writeChunk(res, encodedData({
          error: {
            message: event.message,
            type: "upstream_error",
            code: event.code,
          },
        }));
        return true;
    }
  };

  if (await render(first)) return;
  for (;;) {
    const next = await rest.next();
    if (next.done) {
      await render({
        type: "error",
        code: "stream_truncated",
        message: "Chat stream ended without a terminal event",
        retryable: false,
      });
      return;
    }
    if (await render(next.value)) return;
  }
}
