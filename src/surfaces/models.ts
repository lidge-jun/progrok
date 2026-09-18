import type { XaiTransport } from "../transport/fetch.js";
import { expectObject, expectString, requestJson } from "./client.js";

export type ModelFamily =
  | "models"
  | "language-models"
  | "image-generation-models"
  | "video-generation-models"
  | "embedding-models";

export interface XaiModel {
  id: string;
  aliases: string[];
  raw: Record<string, unknown>;
}

function decodeModel(wire: unknown): XaiModel {
  const raw = expectObject(wire, "model");
  return {
    id: expectString(raw.id, "model.id"),
    aliases: Array.isArray(raw.aliases)
      ? raw.aliases.filter((value): value is string => typeof value === "string")
      : [],
    raw,
  };
}

export class ModelsClient {
  constructor(private readonly transport: XaiTransport) {}

  async list(family: ModelFamily = "models"): Promise<XaiModel[]> {
    const raw = await requestJson(
      this.transport,
      `/${family}`,
      {},
      (wire) => expectObject(wire, family),
    );
    const values = family === "models" ? raw.data : raw.models;
    if (!Array.isArray(values)) {
      throw new TypeError(`${family} list is missing its array`);
    }
    return values.map(decodeModel);
  }

  get(family: ModelFamily, modelId: string): Promise<XaiModel> {
    return requestJson(
      this.transport,
      `/${family}/${encodeURIComponent(modelId)}`,
      {},
      decodeModel,
    );
  }
}
