import type { XaiTransport } from "../transport/fetch.js";
import { expectObject, jsonBody, requestJson } from "./client.js";

export interface DocumentsSearchRequest {
  query: string;
  source: Record<string, unknown>;
  limit?: number;
  filter?: string;
  instructions?: string;
  retrieval_mode?: unknown;
  group_by?: unknown;
}

export class CollectionsSearchClient {
  constructor(private readonly transport: XaiTransport) {}

  search(request: DocumentsSearchRequest): Promise<{ matches: unknown[] }> {
    return requestJson(
      this.transport,
      "/documents/search",
      { method: "POST", ...jsonBody(request) },
      (wire) => {
        const raw = expectObject(wire, "documents search");
        if (!Array.isArray(raw.matches)) {
          throw new TypeError("documents search.matches must be an array");
        }
        return { matches: raw.matches };
      },
    );
  }
}
