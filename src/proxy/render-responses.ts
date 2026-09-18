import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Response } from "express";
import type { AdapterEvent } from "../core/events.js";

async function writeChunk(res: Response, chunk: string): Promise<void> {
  if (!res.write(chunk)) await once(res, "drain");
}

function encodedEvent(
  type: string,
  payload: Record<string, unknown>,
): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

export async function renderResponsesEvents(
  first: AdapterEvent,
  rest: AsyncIterator<AdapterEvent>,
  res: Response,
  model: string,
): Promise<void> {
  const responseId = `resp_progrok_${randomUUID()}`;
  const output: Record<string, unknown>[] = [];
  const itemByCall = new Map<string, Record<string, unknown>>();
  let outputIndex = 0;

  await writeChunk(res, encodedEvent("response.created", {
    response: {
      id: responseId,
      object: "response",
      status: "in_progress",
      model,
      output: [],
    },
  }));

  const render = async (event: AdapterEvent): Promise<boolean> => {
    switch (event.type) {
      case "heartbeat":
        await writeChunk(res, ": progrok\n\n");
        return false;
      case "text_delta":
        await writeChunk(res, encodedEvent("response.output_text.delta", {
          response_id: responseId,
          output_index: 0,
          content_index: 0,
          delta: event.text,
        }));
        return false;
      case "reasoning_delta":
        await writeChunk(res, encodedEvent("response.reasoning_text.delta", {
          response_id: responseId,
          delta: event.text,
        }));
        return false;
      case "tool_call_start": {
        const item: Record<string, unknown> = {
          id: `fc_${randomUUID()}`,
          type: "function_call",
          status: "in_progress",
          call_id: event.id,
          name: event.name,
          arguments: "",
        };
        itemByCall.set(event.id, item);
        output.push(item);
        await writeChunk(res, encodedEvent("response.output_item.added", {
          response_id: responseId,
          output_index: outputIndex,
          item,
        }));
        outputIndex += 1;
        return false;
      }
      case "tool_call_delta": {
        const item = itemByCall.get(event.id);
        if (item) item.arguments = String(item.arguments) + event.arguments;
        await writeChunk(
          res,
          encodedEvent("response.function_call_arguments.delta", {
            response_id: responseId,
            item_id: item?.id,
            delta: event.arguments,
          }),
        );
        return false;
      }
      case "tool_call_end": {
        const item = itemByCall.get(event.id);
        if (item) {
          item.status = "completed";
          await writeChunk(res, encodedEvent("response.output_item.done", {
            response_id: responseId,
            item,
          }));
        }
        return false;
      }
      case "done":
        await writeChunk(res, encodedEvent("response.completed", {
          response: {
            id: event.responseId ?? responseId,
            object: "response",
            status: "completed",
            model,
            output,
            ...(event.usage ? { usage: event.usage.raw ?? event.usage } : {}),
          },
        }));
        return true;
      case "incomplete":
        await writeChunk(res, encodedEvent("response.incomplete", {
          response: {
            id: event.responseId ?? responseId,
            object: "response",
            status: "incomplete",
            incomplete_details: { reason: event.reason },
            output,
          },
        }));
        return true;
      case "error":
        await writeChunk(res, encodedEvent("error", {
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
        message: "Responses stream ended without a terminal event",
        retryable: false,
      });
      return;
    }
    if (await render(next.value)) return;
  }
}
