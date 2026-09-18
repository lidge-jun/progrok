import type { XaiTransport } from "../transport/fetch.js";
import {
  expectObject,
  expectString,
  jsonBody,
  requestJson,
  requestVoid,
} from "./client.js";

export interface BatchInfo {
  batch_id: string;
  name: string;
  state: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface PageOptions {
  limit?: number;
  paginationToken?: string;
}

export interface BatchRequest {
  batch_request_id: string;
  batch_request: Record<string, unknown>;
}

function decodeBatch(wire: unknown): BatchInfo {
  const raw = expectObject(wire, "batch");
  return {
    batch_id: expectString(raw.batch_id, "batch.batch_id"),
    name: expectString(raw.name, "batch.name"),
    state: expectObject(raw.state, "batch.state"),
    raw,
  };
}

function withPage(path: string, options: PageOptions): string {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.paginationToken) {
    query.set("pagination_token", options.paginationToken);
  }
  const encoded = query.toString();
  return encoded.length === 0 ? path : `${path}?${encoded}`;
}

export class BatchesClient {
  constructor(private readonly transport: XaiTransport) {}

  create(name: string): Promise<BatchInfo> {
    return requestJson(
      this.transport,
      "/batches",
      { method: "POST", ...jsonBody({ name }) },
      decodeBatch,
    );
  }

  get(batchId: string): Promise<BatchInfo> {
    return requestJson(
      this.transport,
      `/batches/${encodeURIComponent(batchId)}`,
      {},
      decodeBatch,
    );
  }

  list(options: PageOptions = {}): Promise<unknown> {
    return requestJson(
      this.transport,
      withPage("/batches", options),
      {},
      (wire) => expectObject(wire, "batches"),
    );
  }

  listRequests(
    batchId: string,
    options: PageOptions = {},
  ): Promise<unknown> {
    return requestJson(
      this.transport,
      withPage(
        `/batches/${encodeURIComponent(batchId)}/requests`,
        options,
      ),
      {},
      (wire) => expectObject(wire, "batch requests"),
    );
  }

  addRequests(
    batchId: string,
    requests: readonly BatchRequest[],
  ): Promise<void> {
    return requestVoid(
      this.transport,
      `/batches/${encodeURIComponent(batchId)}/requests`,
      {
        method: "POST",
        ...jsonBody({ batch_requests: requests }),
      },
    );
  }

  results(batchId: string, options: PageOptions = {}): Promise<unknown> {
    return requestJson(
      this.transport,
      withPage(`/batches/${encodeURIComponent(batchId)}/results`, options),
      {},
      (wire) => expectObject(wire, "batch results"),
    );
  }

  cancel(batchId: string): Promise<BatchInfo> {
    return requestJson(
      this.transport,
      `/batches/${encodeURIComponent(batchId)}:cancel`,
      { method: "POST" },
      decodeBatch,
    );
  }
}
