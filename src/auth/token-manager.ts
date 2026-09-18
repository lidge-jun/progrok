import { createHash } from "node:crypto";
import {
  TOKEN_REFRESH_SKEW_MS,
  XAI_REFRESH_FLIGHT_STALE_MS,
  XAI_TERMINAL_FAILURE_TTL_MS,
} from "./constants.js";
import {
  OAuthTokenRequestError,
  refreshXaiToken,
  type OAuthTokenPayload,
} from "./token-client.js";
import {
  loadTokens,
  saveTokens,
  type SaveTokenInput,
  type TokenData,
} from "./token-store.js";

export interface BearerSnapshot { bearer: string; expiresAt: number; generation: number }

export interface TokenManagerDependencies {
  now(): number;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  load(): TokenData | null;
  save(input: SaveTokenInput): Promise<void>;
}

interface RefreshFlight { generation: string; startedAt: number; promise: Promise<string> }

interface TokenManager {
  getValidBearer(signal?: AbortSignal): Promise<string>;
  getValidBearerSnapshot(opts?: BearerSnapshotOptions): Promise<BearerSnapshot>;
}

interface BearerSnapshotOptions { forceRefresh?: boolean; rejectedAccessToken?: string; signal?: AbortSignal }

interface ManagerState {
  dependencies: TokenManagerDependencies;
  flights: Map<string, RefreshFlight>;
  terminalFailures: Map<string, number>;
  snapshotFingerprint?: string;
  snapshotGeneration: number;
}

class AuthRequiredError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "AuthRequiredError";
  }
}

class AuthRefreshError extends Error {
  constructor(cause: unknown) {
    super("Token refresh failed. Run `progrok login` again.", { cause });
    this.name = "AuthRefreshError";
  }
}

const TERMINAL_OAUTH_ERRORS = new Set([
  "invalid_grant", "refresh_token_reused", "revoked_token",
]);

function credentialGeneration(tokens: TokenData): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        tokens.accessToken,
        tokens.refreshToken ?? null,
        tokens.expiresAt ?? null,
        tokens.tokenEndpoint ?? null,
      ]),
    )
    .digest("hex");
}

function accountKey(tokens: TokenData): string {
  if (tokens.accountId) return `sub:${tokens.accountId}`;
  if (tokens.email) return `email:${tokens.email.toLowerCase()}`;
  return `credential:${createHash("sha256")
    .update(tokens.refreshToken ?? tokens.accessToken)
    .digest("hex")}`;
}

function terminalKey(tokens: TokenData, generation: string): string {
  return `${accountKey(tokens)}\0${generation}`;
}

function decodeJwtIdentity(token: string | undefined): {
  accountId?: string;
  email?: string;
} {
  if (!token) return {};
  const parts = token.split(".");
  const encoded = parts[1];
  if (parts.length !== 3 || !encoded) return {};
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {};
    }
    const record = payload as Record<string, unknown>;
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

function toSnapshot(tokens: TokenData, state: ManagerState): BearerSnapshot {
  const fingerprint = credentialGeneration(tokens);
  if (state.snapshotFingerprint !== fingerprint) {
    state.snapshotFingerprint = fingerprint;
    state.snapshotGeneration += 1;
  }
  return {
    bearer: tokens.accessToken,
    expiresAt: tokens.expiresAt ?? Number.POSITIVE_INFINITY,
    generation: state.snapshotGeneration,
  };
}

function requireStoredTokens(
  dependencies: TokenManagerDependencies,
): TokenData {
  const stored = dependencies.load();
  if (!stored?.accessToken) {
    throw new AuthRequiredError("Not logged in. Run `progrok login` first.");
  }
  return stored;
}

function refreshSaveInput(
  stored: TokenData,
  payload: OAuthTokenPayload,
  now: number,
): SaveTokenInput {
  if (
    typeof payload.access_token !== "string" ||
    payload.access_token.length === 0
  ) {
    throw new AuthRefreshError(
      new Error("xAI token response did not include an access token"),
    );
  }

  const idToken =
    typeof payload.id_token === "string" && payload.id_token.length > 0
      ? payload.id_token
      : undefined;
  const identity = decodeJwtIdentity(idToken ?? payload.access_token);
  const input: SaveTokenInput = {
    accessToken: payload.access_token,
    refreshToken:
      typeof payload.refresh_token === "string" &&
      payload.refresh_token.length > 0
        ? payload.refresh_token
        : stored.refreshToken,
    tokenEndpoint: stored.tokenEndpoint,
    expectedCredential: {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt,
      tokenEndpoint: stored.tokenEndpoint,
    },
    ...(idToken === undefined ? {} : { idToken }),
    ...(identity.accountId === undefined
      ? {}
      : { accountId: identity.accountId }),
    ...(identity.email === undefined ? {} : { email: identity.email }),
  };
  if (
    typeof payload.expires_in === "number" &&
    Number.isFinite(payload.expires_in)
  ) {
    input.expiresAt = now + payload.expires_in * 1000;
  }
  return input;
}

function isTerminalOAuthError(error: unknown): error is OAuthTokenRequestError {
  return (
    error instanceof OAuthTokenRequestError &&
    error.oauthError !== undefined &&
    TERMINAL_OAUTH_ERRORS.has(error.oauthError)
  );
}

async function performRefresh(
  stored: TokenData,
  generation: string,
  state: ManagerState,
  signal?: AbortSignal,
): Promise<string> {
  const { dependencies, terminalFailures } = state;
  const failureKey = terminalKey(stored, generation);
  try {
    const payload = await refreshXaiToken(
      stored.tokenEndpoint as string,
      stored.refreshToken as string,
      {
        ...(signal === undefined ? {} : { signal }),
        deps: { fetch: dependencies.fetch, now: dependencies.now },
      },
    );
    const input = refreshSaveInput(stored, payload, dependencies.now());

    const current = requireStoredTokens(dependencies);
    if (credentialGeneration(current) !== generation) {
      terminalFailures.delete(failureKey);
      return current.accessToken;
    }

    await dependencies.save(input);
    terminalFailures.delete(failureKey);
    return requireStoredTokens(dependencies).accessToken;
  } catch (error) {
    const current = dependencies.load();
    if (current && credentialGeneration(current) !== generation) {
      return current.accessToken;
    }
    if (isTerminalOAuthError(error)) {
      if (current && credentialGeneration(current) === generation) {
        terminalFailures.set(
          failureKey,
          dependencies.now() + XAI_TERMINAL_FAILURE_TTL_MS,
        );
      }
      throw new AuthRequiredError(
        "Stored xAI session is no longer valid. Run `progrok login` again.",
        { cause: error },
      );
    }
    if (error instanceof AuthRequiredError || error instanceof AuthRefreshError) {
      throw error;
    }
    throw new AuthRefreshError(error);
  }
}

function runRefreshFlight(
  stored: TokenData,
  generation: string,
  state: ManagerState,
  signal?: AbortSignal,
): Promise<string> {
  const key = accountKey(stored);
  const existing = state.flights.get(key);
  if (
    existing &&
    existing.generation === generation &&
    state.dependencies.now() - existing.startedAt <= XAI_REFRESH_FLIGHT_STALE_MS
  ) {
    return existing.promise;
  }

  const startedAt = state.dependencies.now();
  const refreshPromise = performRefresh(stored, generation, state, signal);
  const flight: RefreshFlight = {
    generation,
    startedAt,
    promise: refreshPromise,
  };
  flight.promise = refreshPromise.finally(() => {
    if (state.flights.get(key) === flight) state.flights.delete(key);
  });
  state.flights.set(key, flight);
  return flight.promise;
}

async function resolveValidBearerSnapshot(
  state: ManagerState,
  opts: BearerSnapshotOptions = {},
): Promise<BearerSnapshot> {
  const stored = requireStoredTokens(state.dependencies);
  const generation = credentialGeneration(stored);

  if (
    opts.rejectedAccessToken !== undefined &&
    stored.accessToken !== opts.rejectedAccessToken
  ) {
    return toSnapshot(stored, state);
  }

  const expiring =
    stored.expiresAt !== undefined &&
    state.dependencies.now() + TOKEN_REFRESH_SKEW_MS >= stored.expiresAt;
  if (!opts.forceRefresh && !expiring) return toSnapshot(stored, state);

  if (!stored.refreshToken || !stored.tokenEndpoint) {
    throw new AuthRequiredError(
      "Token expired and cannot be refreshed. Run `progrok login` again.",
    );
  }

  const failureKey = terminalKey(stored, generation);
  const failureUntil = state.terminalFailures.get(failureKey);
  if (failureUntil !== undefined) {
    if (state.dependencies.now() < failureUntil) {
      throw new AuthRequiredError(
        "Stored xAI session is no longer valid. Run `progrok login` again.",
      );
    }
    state.terminalFailures.delete(failureKey);
  }

  const bearer = await runRefreshFlight(
    stored,
    generation,
    state,
    opts.signal,
  );
  const current = state.dependencies.load();
  if (current?.accessToken) return toSnapshot(current, state);
  return toSnapshot({ ...stored, accessToken: bearer }, state);
}

async function resolveValidBearer(
  state: ManagerState,
  signal?: AbortSignal,
): Promise<string> {
  return (await resolveValidBearerSnapshot(state, { signal })).bearer;
}

const defaultTokenManagerDependencies: TokenManagerDependencies = {
  now: Date.now,
  fetch: (input, init) => globalThis.fetch(input, init),
  load: () => loadTokens(),
  save: (input) => saveTokens(input),
};

export function createTokenManager(
  deps?: TokenManagerDependencies,
): TokenManager {
  const state: ManagerState = {
    dependencies: deps ?? defaultTokenManagerDependencies,
    flights: new Map<string, RefreshFlight>(),
    terminalFailures: new Map<string, number>(),
    snapshotGeneration: 0,
  };

  async function getValidBearer(signal?: AbortSignal): Promise<string> {
    return resolveValidBearer(state, signal);
  }

  async function getValidBearerSnapshot(
    opts: BearerSnapshotOptions = {},
  ): Promise<BearerSnapshot> {
    return resolveValidBearerSnapshot(state, opts);
  }

  return { getValidBearer, getValidBearerSnapshot };
}

const defaultTokenManager = createTokenManager();

export function getValidBearerSnapshot(opts?: {
  forceRefresh?: boolean;
  rejectedAccessToken?: string;
  signal?: AbortSignal;
}): Promise<BearerSnapshot> {
  return defaultTokenManager.getValidBearerSnapshot(opts);
}

export async function withBearer401Replay<T>(
  run: (bearer: string) => Promise<T>,
): Promise<T> {
  const firstBearer = await getValidBearerSnapshot();
  const firstResponse = await run(firstBearer.bearer);
  if ((firstResponse as { status?: unknown }).status !== 401) {
    return firstResponse;
  }

  if (firstResponse instanceof Response) {
    await firstResponse.body?.cancel();
  }
  const replayBearer = await getValidBearerSnapshot({
    forceRefresh: true,
    rejectedAccessToken: firstBearer.bearer,
  });
  return run(replayBearer.bearer);
}
