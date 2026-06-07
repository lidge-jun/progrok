import {
  XAI_OAUTH_DISCOVERY_URL,
  XAI_OAUTH_FETCH_TIMEOUT_MS,
} from "./constants.js";

export interface OIDCDiscovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  deviceAuthorizationEndpoint?: string;
}

function requireTrustedEndpoint(url: string, label: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new Error("not HTTPS");
    }
    if (parsed.hostname !== "x.ai" && !parsed.hostname.endsWith(".x.ai")) {
      throw new Error("not *.x.ai");
    }
    return url;
  } catch {
    throw new Error(`OIDC discovery returned untrusted ${label}: ${url}`);
  }
}

export async function fetchOIDCDiscovery(): Promise<OIDCDiscovery> {
  const res = await fetch(XAI_OAUTH_DISCOVERY_URL, {
    signal: AbortSignal.timeout(XAI_OAUTH_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  }

  /** Shape of a standard OIDC .well-known/openid-configuration response. */
  interface OIDCRawResponse {
    authorization_endpoint: string;
    token_endpoint: string;
    device_authorization_endpoint?: string;
  }

  const data = (await res.json()) as OIDCRawResponse;

  const authorizationEndpoint = requireTrustedEndpoint(
    data.authorization_endpoint,
    "authorization_endpoint",
  );
  const tokenEndpoint = requireTrustedEndpoint(
    data.token_endpoint,
    "token_endpoint",
  );
  const deviceAuthorizationEndpoint = data.device_authorization_endpoint
    ? requireTrustedEndpoint(
        data.device_authorization_endpoint,
        "device_authorization_endpoint",
      )
    : undefined;

  return { authorizationEndpoint, tokenEndpoint, deviceAuthorizationEndpoint };
}
