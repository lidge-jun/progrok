import type { XaiTransport } from "../transport/fetch.js";
import {
  expectObject,
  expectString,
  requestBytes,
  requestJson,
} from "./client.js";

// Skills CRUD and content download are OpenAPI-only surfaces.
export interface XaiSkill {
  id: string;
  name: string;
  description: string;
  default_version: string;
  latest_version: string;
  created_at: number;
  raw: Record<string, unknown>;
}

export interface SkillUploadFile {
  path: string;
  data: Blob;
}

function decodeSkill(wire: unknown): XaiSkill {
  const raw = expectObject(wire, "skill");
  if (typeof raw.created_at !== "number") {
    throw new TypeError("skill.created_at must be a number");
  }
  return {
    id: expectString(raw.id, "skill.id"),
    name: expectString(raw.name, "skill.name"),
    description: expectString(raw.description, "skill.description"),
    default_version: expectString(
      raw.default_version,
      "skill.default_version",
    ),
    latest_version: expectString(raw.latest_version, "skill.latest_version"),
    created_at: raw.created_at,
    raw,
  };
}

export class SkillsClient {
  constructor(private readonly transport: XaiTransport) {}

  list(): Promise<unknown> {
    return requestJson(this.transport, "/skills", {}, (wire) =>
      expectObject(wire, "skills"),
    );
  }

  upload(files: readonly SkillUploadFile[]): Promise<XaiSkill> {
    const form = new FormData();
    for (const file of files) form.append("files", file.data, file.path);
    return requestJson(
      this.transport,
      "/skills",
      { method: "POST", body: form },
      decodeSkill,
    );
  }

  get(skillId: string): Promise<XaiSkill> {
    return requestJson(
      this.transport,
      `/skills/${encodeURIComponent(skillId)}`,
      {},
      decodeSkill,
    );
  }

  delete(skillId: string): Promise<{ id: string; deleted: boolean }> {
    return requestJson(
      this.transport,
      `/skills/${encodeURIComponent(skillId)}`,
      { method: "DELETE" },
      (wire) => {
        const raw = expectObject(wire, "deleted skill");
        return {
          id: expectString(raw.id, "deleted skill.id"),
          deleted: raw.deleted === true,
        };
      },
    );
  }

  downloadContent(
    skillId: string,
  ): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    return requestBytes(
      this.transport,
      `/skills/${encodeURIComponent(skillId)}/content`,
    );
  }
}
