export function encodeGrpcWebFrame(message: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(5 + message.length);
  new DataView(out.buffer).setUint32(1, message.length);
  out.set(message, 5);
  return out;
}
export function decodeVarint(bytes: Uint8Array, offset: number): { value: number; bytesRead: number } {
  if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.length) throw new Error("Invalid varint offset");
  let value = 0;
  for (let i = 0; i < 10; i++) {
    if (offset + i >= bytes.length) throw new Error("Truncated varint");
    const b = bytes[offset + i];
    const part = (b & 127) * 2 ** (7 * i);
    if (!Number.isSafeInteger(part) || value > Number.MAX_SAFE_INTEGER - part) throw new Error("Varint exceeds safe integer");
    value += part;
    if (!(b & 128)) return { value, bytesRead: i + 1 };
  }
  throw new Error("Overlong varint");
}
export function readLengthDelimited(bytes: Uint8Array, offset: number): { start: number; end: number } {
  const { value, bytesRead } = decodeVarint(bytes, offset);
  const start = offset + bytesRead;
  if (value > bytes.length - start) throw new Error("Invalid length-delimited field");
  return { start, end: start + value };
}
export function decodeGrpcWebResponse(bytes: Uint8Array): { messages: Uint8Array[]; statusValues: string[]; statusMessage?: string; framingComplete: boolean } {
  const messages: Uint8Array[] = [], statusValues: string[] = [];
  let offset = 0, framingComplete = true, trailer: Uint8Array | undefined, statusMessage: string | undefined;
  while (offset + 5 <= bytes.length) {
    const flag = bytes[offset], len = new DataView(bytes.buffer, bytes.byteOffset + offset, 5).getUint32(1), start = offset + 5, end = start + len;
    if (end > bytes.length) throw new Error("Incomplete gRPC-Web frame");
    const payload = bytes.subarray(start, end);
    if (flag === 0) { if (trailer) framingComplete = false; messages.push(payload); }
    else if (flag === 128) {
      if (trailer && (trailer.length !== payload.length || trailer.some((b,i) => b !== payload[i]))) framingComplete = false;
      trailer = payload;
      for (const line of new TextDecoder().decode(payload).split(/\r?\n/)) {
        const i = line.indexOf(":"); if (i < 0) continue;
        const key = line.slice(0,i).trim().toLowerCase(), val = line.slice(i+1).trim();
        if (key === "grpc-status") statusValues.push(val);
        if (key === "grpc-message") { try { statusMessage = decodeURIComponent(val); } catch { statusMessage = val; } }
      }
    } else framingComplete = false;
    offset = end;
  }
  return { messages, statusValues, statusMessage, framingComplete: framingComplete && offset === bytes.length };
}
