import type { XaiTransport } from "../transport/fetch.js";
import {
  expectObject,
  expectString,
  jsonBody,
  requestJson,
} from "./client.js";

export type VideoOperation = "generations" | "edits" | "extensions";

export interface VideoStartResponse {
  requestId: string;
}

export interface VideoPollResponse {
  status: "pending" | "done" | "failed" | "expired";
  progress?: number;
  video?: { url: string; duration?: number };
  error?: unknown;
  raw: Record<string, unknown>;
}

export class VideosClient {
  constructor(private readonly transport: XaiTransport) {}

  start(
    operation: VideoOperation,
    request: Record<string, unknown>,
  ): Promise<VideoStartResponse> {
    return requestJson(
      this.transport,
      `/videos/${operation}`,
      { method: "POST", ...jsonBody(request) },
      (wire) => {
        const raw = expectObject(wire, "video start");
        return {
          requestId: expectString(raw.request_id, "video start.request_id"),
        };
      },
    );
  }

  poll(requestId: string): Promise<VideoPollResponse> {
    return requestJson(
      this.transport,
      `/videos/${encodeURIComponent(requestId)}`,
      {},
      (wire) => {
        const raw = expectObject(wire, "video poll");
        const status =
          raw.status === "done" ||
          raw.status === "failed" ||
          raw.status === "expired"
            ? raw.status
            : "pending";
        const videoRaw =
          raw.video === undefined
            ? undefined
            : expectObject(raw.video, "video poll.video");
        return {
          status,
          progress:
            typeof raw.progress === "number" ? raw.progress : undefined,
          video: videoRaw
            ? {
                url: expectString(videoRaw.url, "video.url"),
                duration:
                  typeof videoRaw.duration === "number"
                    ? videoRaw.duration
                    : undefined,
              }
            : undefined,
          error: raw.error,
          raw,
        };
      },
    );
  }
}
