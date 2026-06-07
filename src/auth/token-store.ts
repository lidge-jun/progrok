import {
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import {
  AUTH_FILE,
  TOKEN_REFRESH_SKEW_MS,
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_FETCH_TIMEOUT_MS,
} from "./constants.js";
import { log } from "../utils/logger.js";
import { ensureConfigDir } from "../utils/config.js";

export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint?: string;
  email?: string;
  idToken?: string;
}

export interface SaveTokenInput {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  idToken?: string;
  tokenEndpoint?: string;
}

/** Shape returned by xAI OAuth token endpoint (token exchange and refresh). */
export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  token_type?: string;
}



export async function saveTokens(input: SaveTokenInput): Promise<void> {
  ensureConfigDir();

  const data: TokenData = {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresIn
      ? Date.now() + input.expiresIn * 1000
      : undefined,
    tokenEndpoint: input.tokenEndpoint,
    idToken: input.idToken,
  };

  if (input.idToken) {
    try {
      const parts = input.idToken.split(".");
      if (parts[1]) {
        const payload = JSON.parse(
          Buffer.from(parts[1], "base64url").toString(),
        ) as Record<string, unknown>;
        if (typeof payload.email === "string") {
          data.email = payload.email;
        }
      }
    } catch {
      /* ignore malformed JWT */
    }
  }

  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function loadTokens(): TokenData | null {
  try {
    const raw = readFileSync(AUTH_FILE, "utf8");
    return JSON.parse(raw) as TokenData;
  } catch {
    return null;
  }
}

export function deleteTokens(): void {
  try {
    unlinkSync(AUTH_FILE);
  } catch {
    /* ignore if not exists */
  }
}

export async function getValidBearer(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens?.accessToken) {
    throw new Error("Not logged in. Run `progrok login` first.");
  }

  if (
    tokens.expiresAt &&
    Date.now() + TOKEN_REFRESH_SKEW_MS >= tokens.expiresAt
  ) {
    if (!tokens.refreshToken || !tokens.tokenEndpoint) {
      throw new Error(
        "Token expired and no refresh token available. Run `progrok login` again.",
      );
    }

    log.dim("Refreshing access token...");

    const res = await fetch(tokens.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: XAI_OAUTH_CLIENT_ID,
        refresh_token: tokens.refreshToken,
      }),
      signal: AbortSignal.timeout(XAI_OAUTH_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error("Token refresh failed. Run `progrok login` again.");
    }

    const refreshed = (await res.json()) as OAuthTokenResponse;

    if (
      typeof refreshed.access_token !== "string" ||
      !refreshed.access_token
    ) {
      throw new Error(
        "Token refresh returned invalid access_token. Run `progrok login` again.",
      );
    }

    await saveTokens({
      accessToken: refreshed.access_token,
      refreshToken:
        (typeof refreshed.refresh_token === "string"
          ? refreshed.refresh_token
          : undefined) || tokens.refreshToken,
      expiresIn:
        typeof refreshed.expires_in === "number"
          ? refreshed.expires_in
          : undefined,
      tokenEndpoint: tokens.tokenEndpoint,
    });

    return refreshed.access_token;
  }

  return tokens.accessToken;
}
