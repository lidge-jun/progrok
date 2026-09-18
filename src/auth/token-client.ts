import {
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_FETCH_TIMEOUT_MS,
  XAI_TOKEN_MAX_ATTEMPTS,
  XAI_TOKEN_RETRY_AFTER_CAP_MS,
} from "./constants.js";

export interface OAuthTokenPayload {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  id_token?: unknown;
  token_type?: unknown;
}

export class OAuthTokenRequestError extends Error {
  readonly retryAfterMs: number | undefined;

  constructor(
    readonly status: number | undefined,
    readonly oauthError: string | undefined,
    message: string,
    options?: { cause?: unknown; retryAfterMs?: number },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "OAuthTokenRequestError";
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export interface TokenRequestDeps {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

const TRUSTED_AUTH_HOSTS = new Set(["auth.x.ai", "accounts.x.ai"]);

function requireTrustedTokenEndpoint(tokenEndpoint: string): string {
  let parsed: URL;
  try {
    parsed = new URL(tokenEndpoint);
  } catch {
    throw new Error("xAI token endpoint is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !TRUSTED_AUTH_HOSTS.has(parsed.hostname.toLowerCase())
  ) {
    throw new Error("xAI token endpoint is not trusted");
  }
  return parsed.toString();
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(XAI_OAUTH_FETCH_TIMEOUT_MS);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeout]);
  }

  const controller = new AbortController();
  const abortFrom = (source: AbortSignal): void => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  const onCallerAbort = (): void => abortFrom(signal);
  const onTimeout = (): void => abortFrom(timeout);
  const cleanup = (): void => {
    signal.removeEventListener("abort", onCallerAbort);
    timeout.removeEventListener("abort", onTimeout);
  };
  controller.signal.addEventListener("abort", cleanup, { once: true });
  signal.addEventListener("abort", onCallerAbort, { once: true });
  timeout.addEventListener("abort", onTimeout, { once: true });
  if (signal.aborted) onCallerAbort();
  else if (timeout.aborted) onTimeout();
  return controller.signal;
}

function parseRetryAfterMs(
  raw: string | null,
  now: number,
): number | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    return Math.max(0, Math.ceil(Number(value) * 1000));
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

async function readOAuthError(
  response: Response,
  now: number,
): Promise<OAuthTokenRequestError> {
  const retryAfterMs = parseRetryAfterMs(
    response.headers.get("retry-after"),
    now,
  );
  let oauthError: string | undefined;
  let description: string | undefined;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      if (typeof record.error === "string") oauthError = record.error;
      if (typeof record.error_description === "string") {
        description = record.error_description;
      }
    }
  } catch {
    // The HTTP status remains authoritative when the error body is not JSON.
  }
  return new OAuthTokenRequestError(
    response.status,
    oauthError,
    `xAI token request failed: HTTP ${response.status}${description ? `: ${description}` : ""}`,
    { retryAfterMs },
  );
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function postXaiToken(
  tokenEndpoint: string,
  fields: Record<string, string>,
  options: { signal?: AbortSignal; deps?: TokenRequestDeps } = {},
): Promise<OAuthTokenPayload> {
  const endpoint = requireTrustedTokenEndpoint(tokenEndpoint);
  const fetchImpl = options.deps?.fetch ?? globalThis.fetch;
  const sleep = options.deps?.sleep ?? defaultSleep;
  const random = options.deps?.random ?? Math.random;
  const now = options.deps?.now ?? Date.now;

  for (let attempt = 1; attempt <= XAI_TOKEN_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(fields).toString(),
        signal: requestSignal(options.signal),
      });
    } catch (cause) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (
        cause instanceof Error &&
        (cause.name === "AbortError" || cause.name === "TimeoutError")
      ) {
        throw new OAuthTokenRequestError(
          undefined,
          undefined,
          "xAI token request timed out",
          { cause },
        );
      }
      if (attempt === XAI_TOKEN_MAX_ATTEMPTS) {
        throw new OAuthTokenRequestError(
          undefined,
          undefined,
          "xAI token request failed: network error",
          { cause },
        );
      }
      await sleep(
        Math.round(
          (attempt === 1 ? 100 : 250) * (0.75 + random() * 0.5),
        ),
        options.signal,
      );
      continue;
    }

    if (response.ok) {
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new OAuthTokenRequestError(
          response.status,
          undefined,
          "xAI token request returned invalid JSON",
        );
      }
      return body as OAuthTokenPayload;
    }

    const error = await readOAuthError(response, now());
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === XAI_TOKEN_MAX_ATTEMPTS) throw error;
    if (
      error.retryAfterMs !== undefined &&
      error.retryAfterMs > XAI_TOKEN_RETRY_AFTER_CAP_MS
    ) {
      throw error;
    }
    await sleep(error.retryAfterMs ?? 250 * attempt, options.signal);
  }

  throw new OAuthTokenRequestError(
    undefined,
    undefined,
    "xAI token request exhausted retries",
  );
}

export function refreshXaiToken(
  tokenEndpoint: string,
  refreshToken: string,
  options: { signal?: AbortSignal; deps?: TokenRequestDeps } = {},
): Promise<OAuthTokenPayload> {
  return postXaiToken(
    tokenEndpoint,
    {
      grant_type: "refresh_token",
      client_id: XAI_OAUTH_CLIENT_ID,
      refresh_token: refreshToken,
    },
    options,
  );
}
