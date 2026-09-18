import type { Request } from "express";

export const MAX_PROXY_BODY_BYTES = 100 * 1024 * 1024;

export class PayloadTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Request body exceeds ${limitBytes / 1024 / 1024}MB limit`);
    this.name = "PayloadTooLargeError";
  }
}

export async function readBoundedBody(
  req: Request,
  limitBytes = MAX_PROXY_BODY_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    total += buffer.byteLength;
    if (total > limitBytes) {
      req.resume();
      throw new PayloadTooLargeError(limitBytes);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, total);
}
