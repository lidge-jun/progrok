export type ReplayClass = "replayable" | "not-replayable";

export interface RetryPolicy {
  replay: ReplayClass;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retry429: boolean;
  retry5xx: boolean;
}

const RETRYABLE_SERVER_STATUSES = new Set([
  500, 502, 503, 504, 520, 521, 522,
]);

export function classifyReplay(
  method: string,
  headers: Headers,
): ReplayClass {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") {
    return "replayable";
  }
  return headers.has("idempotency-key") ? "replayable" : "not-replayable";
}

export function isRetryableStatus(
  status: number,
  policy: RetryPolicy,
): boolean {
  if (policy.replay === "not-replayable") return false;
  if (status === 429) return policy.retry429;
  return policy.retry5xx && RETRYABLE_SERVER_STATUSES.has(status);
}

export function retryDelayMs(
  attempt: number,
  headers: Headers,
  policy: RetryPolicy,
  now = Date.now(),
): number | undefined {
  const raw = headers.get("retry-after")?.trim();
  let serverDelay: number | undefined;
  if (raw && /^\d+(?:\.\d+)?$/.test(raw)) {
    serverDelay = Math.ceil(Number(raw) * 1000);
  } else if (raw) {
    const date = Date.parse(raw);
    if (Number.isFinite(date)) serverDelay = Math.max(0, date - now);
  }
  if (serverDelay !== undefined) {
    return serverDelay <= policy.maxDelayMs ? serverDelay : undefined;
  }

  const exponential = Math.min(
    policy.baseDelayMs * 2 ** attempt,
    policy.maxDelayMs,
  );
  return Math.floor(exponential * (0.8 + Math.random() * 0.4));
}

export async function sleepWithAbort(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
    };
    const done = (): void => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(done, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
