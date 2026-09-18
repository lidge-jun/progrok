import type { XaiTransport } from "../transport/fetch.js";
import {
  expectObject,
  expectString,
  jsonBody,
  requestJson,
} from "./client.js";

export interface MeResponse {
  user_id: string;
  team_id: string;
  zdr_status: string;
  team_blocked: boolean;
  oauth?: unknown;
  api_key?: unknown;
}

export class MiscClient {
  constructor(private readonly transport: XaiTransport) {}

  tokenize(input: {
    model: string;
    text: string;
    user?: string;
  }): Promise<unknown[]> {
    return requestJson(
      this.transport,
      "/tokenize-text",
      { method: "POST", ...jsonBody(input) },
      (wire) => {
        const raw = expectObject(wire, "tokenize response");
        if (!Array.isArray(raw.token_ids)) {
          throw new TypeError("tokenize response.token_ids must be an array");
        }
        return raw.token_ids;
      },
    );
  }

  // GET /v1/me is an OpenAPI-only account surface.
  me(): Promise<MeResponse> {
    return requestJson(this.transport, "/me", {}, (wire) => {
      const raw = expectObject(wire, "me");
      return {
        user_id: expectString(raw.user_id, "me.user_id"),
        team_id: expectString(raw.team_id, "me.team_id"),
        zdr_status: expectString(raw.zdr_status, "me.zdr_status"),
        team_blocked: raw.team_blocked === true,
        oauth: raw.oauth,
        api_key: raw.api_key,
      };
    });
  }
}
