import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

export interface MediaRef {
  url?: string;
  file_id?: string;
}

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const VIDEO_MIME: Record<string, string> = {
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

/** Convert a local file to a data: URI for API upload. */
export function fileToDataUri(
  filePath: string,
  mediaKind: "image" | "video",
): string {
  const abs = resolve(filePath);
  const buf = readFileSync(abs);
  const ext = extname(abs).toLowerCase();
  const mime =
    mediaKind === "image"
      ? IMAGE_MIME[ext] ?? "image/jpeg"
      : VIDEO_MIME[ext] ?? "video/mp4";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * Resolve user input (file path, URL, data URI, or file_id) into an API-ready
 * media reference object.
 */
export function mediaRef(
  input: string,
  mediaKind: "image" | "video",
): MediaRef {
  if (input.startsWith("file_id:")) {
    return { file_id: input.slice("file_id:".length) };
  }
  if (
    input.startsWith("http://") ||
    input.startsWith("https://") ||
    input.startsWith("data:")
  ) {
    return { url: input };
  }
  if (existsSync(resolve(input))) {
    return { url: fileToDataUri(input, mediaKind) };
  }
  if (/^file[-_]/.test(input)) {
    return { file_id: input };
  }
  throw new Error(
    `${mediaKind} input must be a local file, URL, data URI, or file_id:<id>. Got: ${input}`,
  );
}
