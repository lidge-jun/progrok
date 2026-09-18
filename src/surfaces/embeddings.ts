import type { XaiTransport } from "../transport/fetch.js";
import {
  expectObject,
  expectString,
  jsonBody,
  requestJson,
} from "./client.js";

// This entire surface is OpenAPI-only as of the 2026-09-18 inventory.
export interface EmbeddingRequest {
  model: string;
  input: string | string[] | number[] | number[][];
  dimensions?: number;
  encoding_format?: "float" | "base64";
  user?: string;
}

export interface EmbeddingResponse {
  object: string;
  model: string;
  data: unknown[];
  usage?: unknown;
}

export class EmbeddingsClient {
  constructor(private readonly transport: XaiTransport) {}

  create(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return requestJson(
      this.transport,
      "/embeddings",
      { method: "POST", ...jsonBody(request) },
      (wire) => {
        const raw = expectObject(wire, "embeddings");
        if (!Array.isArray(raw.data)) {
          throw new TypeError("embeddings.data must be an array");
        }
        return {
          object: expectString(raw.object, "embeddings.object"),
          model: expectString(raw.model, "embeddings.model"),
          data: raw.data,
          usage: raw.usage,
        };
      },
    );
  }

  listModels(): Promise<unknown> {
    return requestJson(this.transport, "/embedding-models", {}, (wire) =>
      expectObject(wire, "embedding models"),
    );
  }

  getModel(modelId: string): Promise<unknown> {
    return requestJson(
      this.transport,
      `/embedding-models/${encodeURIComponent(modelId)}`,
      {},
      (wire) => expectObject(wire, "embedding model"),
    );
  }
}
