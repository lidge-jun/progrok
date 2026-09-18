import { withBearer401Replay } from "../auth/token-manager.js";
import { readPackageVersion } from "../utils/version.js";
import {
  normalizeXaiPath,
  resolveCliChatProxyUrl,
  resolveUpstreamUrl,
  type UpstreamAuthKind,
} from "./base-url.js";
import { buildUpstreamHeaders } from "./headers.js";
import {
  classifyReplay,
  isRetryableStatus,
  retryDelayMs,
  sleepWithAbort,
  type ReplayClass,
  type RetryPolicy,
} from "./retry.js";

const DEFAULT_HEADER_TIMEOUT_MS = 30_000;
const MAX_NETWORK_BACKOFF_MS = 1_000;
const FEEDBACK = /^\/v1\/feedback(?:\/|$)/;
const DEPLOYMENT_CONFIG = /^\/v1\/deployment\/config(?:\/|$)/;

export interface XaiFetchInput {
  pathWithQuery: string;
  method: string;
  headers: Headers;
  body?: BodyInit | null;
  signal?: AbortSignal;
}

export interface XaiTransport {
  fetch(input: XaiFetchInput): Promise<Response>;
}

export type CliChatProxyCredential =
  | { kind: "oauth" }
  | { kind: "deployment-key"; env: "GROK_DEPLOYMENT_KEY" };

interface ExecuteOptions {
  bearer: string;
  authKind: UpstreamAuthKind;
  fetchImpl: typeof fetch;
  resolveUrl(path: string): string | URL;
  timeoutMs: number;
}

function combineSignals(
  first: AbortSignal | undefined,
  second: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!first) return second;
  if (!second) return first;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([first, second]);
  }

  const controller = new AbortController();
  const cleanup = (): void => {
    first.removeEventListener("abort", abortFromFirst);
    second.removeEventListener("abort", abortFromSecond);
  };
  const abortFrom = (source: AbortSignal): void => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  const abortFromFirst = (): void => abortFrom(first);
  const abortFromSecond = (): void => abortFrom(second);
  controller.signal.addEventListener("abort", cleanup, { once: true });
  first.addEventListener("abort", abortFromFirst, { once: true });
  second.addEventListener("abort", abortFromSecond, { once: true });
  if (first.aborted) abortFromFirst();
  else if (second.aborted) abortFromSecond();
  return controller.signal;
}

function headerSignal(
  caller: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; clear(): void } {
  const headerTimeout = new AbortController();
  const timer = setTimeout(() => {
    headerTimeout.abort(
      new DOMException("Upstream headers timed out", "TimeoutError"),
    );
  }, timeoutMs);
  return {
    signal:
      combineSignals(caller, headerTimeout.signal) ?? headerTimeout.signal,
    clear: () => clearTimeout(timer),
  };
}

function replayClass(input: XaiFetchInput, headers: Headers): ReplayClass {
  if (input.body instanceof ReadableStream) return "not-replayable";
  return classifyReplay(input.method, headers);
}

function requestInit(
  input: XaiFetchInput,
  headers: Headers,
  signal: AbortSignal,
): RequestInit {
  const init: RequestInit & { duplex?: "half" } = {
    method: input.method,
    headers,
    body: input.body,
    signal,
    redirect: "error",
  };
  if (input.body instanceof ReadableStream) init.duplex = "half";
  return init;
}

async function fetchAttempt(
  input: XaiFetchInput,
  headers: Headers,
  options: ExecuteOptions,
): Promise<Response> {
  const bounded = headerSignal(input.signal, options.timeoutMs);
  try {
    return await options.fetchImpl(
      options.resolveUrl(input.pathWithQuery),
      requestInit(input, headers, bounded.signal),
    );
  } finally {
    bounded.clear();
  }
}

async function executeWithOptions(
  input: XaiFetchInput,
  options: ExecuteOptions,
): Promise<Response> {
  const headers = buildUpstreamHeaders({
    incoming: input.headers,
    auth: { kind: options.authKind, bearer: options.bearer },
    clientVersion: readPackageVersion(),
  });
  const replay = replayClass(input, headers);
  const policy: RetryPolicy = {
    replay,
    maxAttempts: replay === "not-replayable" ? 1 : 3,
    baseDelayMs: 400,
    maxDelayMs: 5_000,
    retry429: true,
    retry5xx: true,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
    if (input.signal?.aborted) throw input.signal.reason;
    let response: Response;
    try {
      response = await fetchAttempt(input, headers, options);
    } catch (error) {
      if (
        input.signal?.aborted ||
        replay === "not-replayable" ||
        attempt + 1 >= policy.maxAttempts ||
        (error instanceof Error &&
          (error.name === "AbortError" || error.name === "TimeoutError"))
      ) {
        throw error;
      }
      lastError = error;
      await sleepWithAbort(
        Math.min(150 * 2 ** attempt, MAX_NETWORK_BACKOFF_MS),
        input.signal,
      );
      continue;
    }

    if (
      !isRetryableStatus(response.status, policy) ||
      attempt + 1 >= policy.maxAttempts
    ) {
      return response;
    }
    const delay = retryDelayMs(attempt, response.headers, policy);
    if (delay === undefined) return response;
    await response.body?.cancel().catch(() => undefined);
    await sleepWithAbort(delay, input.signal);
  }

  throw lastError ?? new Error("xAI fetch exhausted retries");
}

export function executeXaiFetch(
  input: XaiFetchInput,
  deps: { bearer: string; fetchImpl?: typeof fetch },
): Promise<Response> {
  return executeWithOptions(input, {
    bearer: deps.bearer,
    authKind: "oauth",
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    resolveUrl: (path) => resolveUpstreamUrl(path, "oauth"),
    timeoutMs: DEFAULT_HEADER_TIMEOUT_MS,
  });
}

export function xaiFetch(
  input: XaiFetchInput,
  deps?: { fetchImpl?: typeof fetch },
): Promise<Response> {
  return withBearer401Replay((bearer) =>
    deps?.fetchImpl
      ? executeXaiFetch(input, { bearer, fetchImpl: deps.fetchImpl })
      : executeXaiFetch(input, { bearer }),
  );
}

export function createXaiTransport(opts?: {
  fetchImpl?: typeof fetch;
}): XaiTransport {
  return {
    fetch(input) {
      return xaiFetch(input, opts);
    },
  };
}

function validateCliProxyPath(
  pathWithQuery: string,
  credential: CliChatProxyCredential,
): void {
  const encodedPathname = new URL(
    normalizeXaiPath(pathWithQuery),
    "https://local.invalid",
  ).pathname;
  let pathname: string;
  try {
    pathname = decodeURIComponent(encodedPathname);
  } catch {
    throw new Error("xAI path contains invalid percent-encoding");
  }
  if (FEEDBACK.test(pathname)) {
    throw new Error(
      "feedback base URL is not established; automatic routing is disabled",
    );
  }
  if (credential.kind === "deployment-key") {
    if (!DEPLOYMENT_CONFIG.test(pathname)) {
      throw new Error(
        "GROK_DEPLOYMENT_KEY is restricted to /v1/deployment/config",
      );
    }
  } else if (DEPLOYMENT_CONFIG.test(pathname)) {
    throw new Error("/deployment/config requires GROK_DEPLOYMENT_KEY");
  }
}

function deploymentKey(env: "GROK_DEPLOYMENT_KEY"): string {
  const value = process.env[env];
  if (!value) throw new Error(`${env} is required for deployment config`);
  return value;
}

export function createCliChatProxyTransport(options: {
  explicitOptIn: true;
  credential: CliChatProxyCredential;
  signal?: AbortSignal;
  timeoutMs?: number;
}): XaiTransport {
  if (options.explicitOptIn !== true) {
    throw new Error("cli-chat-proxy requires explicit opt-in");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_HEADER_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive finite number");
  }

  return {
    async fetch(input) {
      validateCliProxyPath(input.pathWithQuery, options.credential);
      const scopedInput: XaiFetchInput = {
        ...input,
        signal: combineSignals(input.signal, options.signal),
      };
      const run = (bearer: string): Promise<Response> =>
        executeWithOptions(scopedInput, {
          bearer,
          authKind: options.credential.kind,
          fetchImpl: globalThis.fetch,
          resolveUrl: (path) =>
            resolveCliChatProxyUrl(path, { explicitOptIn: true }),
          timeoutMs,
        });

      if (options.credential.kind === "oauth") {
        return withBearer401Replay(run);
      }
      return run(deploymentKey(options.credential.env));
    },
  };
}
