import type { XaiTransport } from "../transport/fetch.js";
import { expectObject, jsonBody, requestJson } from "./client.js";

export interface ImageRequest {
  model: string;
  prompt: string;
  n?: number;
  response_format?: "url" | "b64_json";
  aspect_ratio?: string;
  resolution?: string;
  image?: unknown;
  images?: unknown[];
}

export interface ImageResponse {
  data: unknown[];
  usage?: unknown;
}

export class ImagesClient {
  constructor(private readonly transport: XaiTransport) {}

  create(request: ImageRequest): Promise<ImageResponse> {
    const edit = request.image !== undefined || request.images !== undefined;
    return requestJson(
      this.transport,
      edit ? "/images/edits" : "/images/generations",
      { method: "POST", ...jsonBody(request) },
      (wire) => {
        const raw = expectObject(wire, "image response");
        if (!Array.isArray(raw.data)) {
          throw new TypeError("image response.data must be an array");
        }
        return { data: raw.data, usage: raw.usage };
      },
    );
  }
}
