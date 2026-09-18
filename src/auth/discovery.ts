import {
  XAI_OAUTH_DISCOVERY_URL,
  XAI_OAUTH_FETCH_TIMEOUT_MS,
} from "./constants.js";

export interface OIDCDiscovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  deviceAuthorizationEndpoint?: string;
}

const TRUSTED_AUTH_HOSTS = new Set(["auth.x.ai", "accounts.x.ai"]);

function discoverySignal(signal?: AbortSignal): AbortSignal {
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

function requireTrustedEndpoint(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`OIDC discovery missing ${label}`);
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !TRUSTED_AUTH_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
      throw new Error("untrusted endpoint");
    }
    return parsed.toString();
  } catch {
    throw new Error(`OIDC discovery returned untrusted ${label}`);
  }
}

export async function fetchOIDCDiscovery(
  signal?: AbortSignal,
): Promise<OIDCDiscovery> {
  const res = await fetch(XAI_OAUTH_DISCOVERY_URL, {
    headers: { Accept: "application/json" },
    signal: discoverySignal(signal),
  });

  if (!res.ok) {
    throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  }

  const raw: unknown = await res.json();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid OIDC discovery response");
  }
  const data = raw as Record<string, unknown>;

  const authorizationEndpoint = requireTrustedEndpoint(
    data.authorization_endpoint,
    "authorization_endpoint",
  );
  const tokenEndpoint = requireTrustedEndpoint(
    data.token_endpoint,
    "token_endpoint",
  );
  return {
    authorizationEndpoint,
    tokenEndpoint,
    ...(data.device_authorization_endpoint === undefined
      ? {}
      : {
          deviceAuthorizationEndpoint: requireTrustedEndpoint(
            data.device_authorization_endpoint,
            "device_authorization_endpoint",
          ),
        }),
  };
}
