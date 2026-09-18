import type { Response as ExpressResponse } from "express";
import { isTerminalEvent } from "../core/events.js";
import { reduceChatStream } from "../wire/chat-stream.js";
import { reduceResponsesStream } from "../wire/responses-stream.js";
import { copyUpstreamHeaders } from "./relay.js";
import { renderChatEvents } from "./render-chat.js";
import { renderResponsesEvents } from "./render-responses.js";

export type NativeProtocol = "chat" | "responses";

export async function serveNativeStream(input: {
  protocol: NativeProtocol;
  upstream: Response;
  downstream: ExpressResponse;
  model: string;
}): Promise<"handled" | "relay"> {
  const contentType =
    input.upstream.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    !input.upstream.ok ||
    !input.upstream.body ||
    !contentType.includes("text/event-stream")
  ) {
    return "relay";
  }

  const events = input.protocol === "chat"
    ? reduceChatStream(input.upstream.body)
    : reduceResponsesStream(input.upstream.body);
  const iterator = events[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) {
    throw new Error("native stream parser produced no terminal event");
  }
  if (isTerminalEvent(first.value) && first.value.type === "error") {
    throw Object.assign(new Error(first.value.message), {
      code: first.value.code,
    });
  }

  input.downstream.status(input.upstream.status);
  copyUpstreamHeaders(input.upstream, input.downstream);
  input.downstream.setHeader(
    "content-type",
    "text/event-stream; charset=utf-8",
  );
  input.downstream.setHeader("cache-control", "no-cache");

  if (input.protocol === "chat") {
    await renderChatEvents(first.value, iterator, input.downstream, {
      model: input.model,
    });
  } else {
    await renderResponsesEvents(
      first.value,
      iterator,
      input.downstream,
      input.model,
    );
  }
  input.downstream.end();
  return "handled";
}
