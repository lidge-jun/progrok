import type { XaiTransport } from "../transport/fetch.js";
import {
  expectObject,
  expectString,
  jsonBody,
  requestBytes,
  requestJson,
} from "./client.js";

export interface XaiFile {
  id: string;
  filename: string;
  bytes: number;
  created_at: number;
  expires_at?: number | null;
  public_url?: string | null;
  raw: Record<string, unknown>;
}

export interface UploadFileInput {
  file: Blob;
  filename: string;
  purpose?: string;
  expiresAfterSeconds?: number;
}

function decodeFile(wire: unknown): XaiFile {
  const raw = expectObject(wire, "file");
  if (typeof raw.bytes !== "number" || typeof raw.created_at !== "number") {
    throw new TypeError("invalid file metadata");
  }
  return {
    id: expectString(raw.id, "file.id"),
    filename: expectString(raw.filename, "file.filename"),
    bytes: raw.bytes,
    created_at: raw.created_at,
    expires_at:
      typeof raw.expires_at === "number" || raw.expires_at === null
        ? raw.expires_at
        : undefined,
    public_url:
      typeof raw.public_url === "string" || raw.public_url === null
        ? raw.public_url
        : undefined,
    raw,
  };
}

export class FilesClient {
  constructor(private readonly transport: XaiTransport) {}

  upload(input: UploadFileInput): Promise<XaiFile> {
    const form = new FormData();
    if (input.purpose) form.append("purpose", input.purpose);
    if (input.expiresAfterSeconds !== undefined) {
      form.append("expires_after", String(input.expiresAfterSeconds));
    }
    form.append("file", input.file, input.filename);
    return requestJson(
      this.transport,
      "/files",
      { method: "POST", body: form },
      decodeFile,
    );
  }

  list(
    options: { limit?: number; paginationToken?: string } = {},
  ): Promise<unknown> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.paginationToken) {
      query.set("pagination_token", options.paginationToken);
    }
    const encoded = query.toString();
    return requestJson(
      this.transport,
      encoded ? `/files?${encoded}` : "/files",
      {},
      (wire) => expectObject(wire, "files"),
    );
  }

  get(fileId: string): Promise<XaiFile> {
    return requestJson(
      this.transport,
      `/files/${encodeURIComponent(fileId)}`,
      {},
      decodeFile,
    );
  }

  delete(fileId: string): Promise<{ id: string; deleted: boolean }> {
    return requestJson(
      this.transport,
      `/files/${encodeURIComponent(fileId)}`,
      { method: "DELETE" },
      (wire) => {
        const raw = expectObject(wire, "deleted file");
        return {
          id: expectString(raw.id, "deleted file.id"),
          deleted: raw.deleted === true,
        };
      },
    );
  }

  // These file-content/public URL operations are documented only by OpenAPI.
  download(
    fileId: string,
  ): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    return requestBytes(
      this.transport,
      `/files/${encodeURIComponent(fileId)}/content`,
    );
  }

  createPublicUrl(
    fileId: string,
    expiresAfter?: number,
  ): Promise<{ public_url: string; expires_at?: number | null }> {
    return requestJson(
      this.transport,
      `/files/${encodeURIComponent(fileId)}/public-url`,
      { method: "POST", ...jsonBody({ expires_after: expiresAfter }) },
      (wire) => {
        const raw = expectObject(wire, "public URL");
        return {
          public_url: expectString(raw.public_url, "public URL.public_url"),
          expires_at:
            typeof raw.expires_at === "number" || raw.expires_at === null
              ? raw.expires_at
              : undefined,
        };
      },
    );
  }

  revokePublicUrl(fileId: string): Promise<{ id: string; revoked: boolean }> {
    return requestJson(
      this.transport,
      `/files/${encodeURIComponent(fileId)}/public-url/revoke`,
      { method: "POST" },
      (wire) => {
        const raw = expectObject(wire, "revoke public URL");
        return {
          id: expectString(raw.id, "revoke.id"),
          revoked: raw.revoked === true,
        };
      },
    );
  }
}
