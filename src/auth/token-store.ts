import { randomBytes } from "node:crypto";
import {
  chmodSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { AUTH_FILE, CONFIG_DIR } from "./constants.js";
import type { OAuthTokenPayload } from "./token-client.js";
import { ensureConfigDir } from "../utils/config.js";

export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint?: string;
  email?: string;
  idToken?: string;
  accountId?: string;
  [key: string]: unknown;
}

export interface SaveTokenInput {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  expiresAt?: number;
  idToken?: string;
  tokenEndpoint?: string;
  email?: string;
  accountId?: string;
  expectedCredential?: Pick<
    TokenData,
    "accessToken" | "refreshToken" | "expiresAt" | "tokenEndpoint"
  >;
}

interface GetValidBearerOptions {
  forceRefresh?: boolean;
  rejectedAccessToken?: string;
  signal?: AbortSignal;
}
interface JwtIdentity {
  accountId?: string;
  email?: string;
}

function decodeJwtIdentity(token: string | undefined): JwtIdentity {
  if (!token) return {};
  const parts = token.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || !payload) return {};
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.sub === "string" && record.sub.length > 0
        ? { accountId: record.sub }
        : {}),
      ...(typeof record.email === "string" && record.email.length > 0
        ? { email: record.email.toLowerCase() }
        : {}),
    };
  } catch {
    return {};
  }
}

function assignOptionalString(
  target: TokenData,
  key: "refreshToken" | "tokenEndpoint" | "idToken" | "email" | "accountId",
  input: SaveTokenInput,
): void {
  if (!Object.prototype.hasOwnProperty.call(input, key)) return;
  const value = input[key];
  if (typeof value === "string" && value.length > 0) {
    target[key] = value;
  } else {
    delete target[key];
  }
}

function writeTokensAtomic(next: TokenData): void {
  ensureConfigDir();
  if (process.platform !== "win32") chmodSync(CONFIG_DIR, 0o700);

  const tmp = `${AUTH_FILE}.tmp-${randomBytes(6).toString("hex")}`;
  let published = false;
  try {
    writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(tmp, AUTH_FILE);
    published = true;
  } finally {
    if (!published) rmSync(tmp, { force: true });
  }
}

function hasSameCredential(
  current: TokenData,
  expected: NonNullable<SaveTokenInput["expectedCredential"]>,
): boolean {
  return (
    current.accessToken === expected.accessToken &&
    current.refreshToken === expected.refreshToken &&
    current.expiresAt === expected.expiresAt &&
    current.tokenEndpoint === expected.tokenEndpoint
  );
}

export async function saveTokens(input: SaveTokenInput): Promise<void> {
  const current = loadTokens();
  if (
    input.expectedCredential !== undefined &&
    (!current || !hasSameCredential(current, input.expectedCredential))
  ) {
    return;
  }
  const next: TokenData = {
    ...(current ?? {}),
    accessToken: input.accessToken,
  };

  assignOptionalString(next, "refreshToken", input);
  assignOptionalString(next, "tokenEndpoint", input);
  assignOptionalString(next, "idToken", input);
  assignOptionalString(next, "email", input);
  assignOptionalString(next, "accountId", input);

  if (typeof input.expiresAt === "number" && Number.isFinite(input.expiresAt)) {
    next.expiresAt = input.expiresAt;
  } else if (
    typeof input.expiresIn === "number" &&
    Number.isFinite(input.expiresIn)
  ) {
    next.expiresAt = Date.now() + input.expiresIn * 1000;
  } else {
    delete next.expiresAt;
  }

  if (Object.prototype.hasOwnProperty.call(input, "idToken")) {
    delete next.email;
    delete next.accountId;
    const identity = decodeJwtIdentity(input.idToken);
    if (identity.email !== undefined) next.email = identity.email;
    if (identity.accountId !== undefined) next.accountId = identity.accountId;
  }
  if (input.email !== undefined) next.email = input.email.toLowerCase();
  if (input.accountId !== undefined) next.accountId = input.accountId;

  writeTokensAtomic(next);
}

export function loadTokens(): TokenData | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(AUTH_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.accessToken !== "string" ||
      record.accessToken.length === 0
    ) {
      return null;
    }
    return record as TokenData;
  } catch {
    return null;
  }
}

export function deleteTokens(): void {
  rmSync(AUTH_FILE, { force: true });
}

export async function getValidBearer(
  options: GetValidBearerOptions = {},
): Promise<string> {
  const { getValidBearerSnapshot } = await import("./token-manager.js");
  return (await getValidBearerSnapshot(options)).bearer;
}

export async function saveTokensFromOAuthPayload(
  payload: OAuthTokenPayload,
  context: { tokenEndpoint: string },
): Promise<void> {
  if (
    typeof payload.access_token !== "string" ||
    payload.access_token.length === 0
  ) {
    throw new Error("xAI token response did not include an access token");
  }

  const input: SaveTokenInput = {
    accessToken: payload.access_token,
    refreshToken:
      typeof payload.refresh_token === "string" &&
      payload.refresh_token.length > 0
        ? payload.refresh_token
        : undefined,
    idToken:
      typeof payload.id_token === "string" && payload.id_token.length > 0
        ? payload.id_token
        : undefined,
    tokenEndpoint: context.tokenEndpoint,
  };
  if (
    typeof payload.expires_in === "number" &&
    Number.isFinite(payload.expires_in)
  ) {
    input.expiresIn = payload.expires_in;
  }
  await saveTokens(input);
}
