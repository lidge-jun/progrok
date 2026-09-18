export const XAI_PUBLIC_API_ORIGIN = "https://api.x.ai";
export const XAI_PUBLIC_API_BASE_URL = `${XAI_PUBLIC_API_ORIGIN}/v1`;
export const XAI_SESSION_API_BASE_URL =
  "https://cli-chat-proxy.grok.com/v1";

export type PublicApiAuthKind = "oauth" | "api-key";
export type UpstreamAuthKind = PublicApiAuthKind | "deployment-key";

export interface CliChatProxyOptIn {
  explicitOptIn: true;
}

const PUBLIC_VERSIONED_PATH = /^\/v\d+(?:\/|$)/;
const DEPLOYMENT_CONFIG = /^\/v1\/deployment\/config(?:\/|$)/;
const FEEDBACK = /^\/v1\/feedback(?:\/|$)/;

function policyPathname(normalized: string): string {
  const pathname = new URL(normalized, "https://local.invalid").pathname;
  try {
    return decodeURIComponent(pathname);
  } catch {
    throw new Error("xAI path contains invalid percent-encoding");
  }
}

export function normalizeXaiPath(pathname: string): string {
  const parsed = new URL(pathname, "https://local.invalid");
  const path = PUBLIC_VERSIONED_PATH.test(parsed.pathname)
    ? parsed.pathname
    : `/v1/${parsed.pathname.replace(/^\/+/, "")}`;
  return `${path}${parsed.search}`;
}

export function resolveUpstreamBase(kind: PublicApiAuthKind): string {
  void kind;
  return XAI_PUBLIC_API_BASE_URL;
}

export function resolveUpstreamUrl(
  path: string,
  kind: PublicApiAuthKind,
): string {
  const normalized = normalizeXaiPath(path);
  const pathOnly = policyPathname(normalized);
  if (DEPLOYMENT_CONFIG.test(pathOnly)) {
    throw new Error("/deployment/config requires GROK_DEPLOYMENT_KEY");
  }
  if (FEEDBACK.test(pathOnly)) {
    throw new Error(
      "feedback base URL is not established; automatic routing is disabled",
    );
  }
  const origin = new URL(resolveUpstreamBase(kind)).origin;
  return new URL(normalized, `${origin}/`).toString();
}

export function resolveCliChatProxyUrl(
  pathname: string,
  _optIn: CliChatProxyOptIn,
): URL {
  const normalized = normalizeXaiPath(pathname);
  const suffix = normalized.replace(/^\/v1/, "");
  return new URL(`${XAI_SESSION_API_BASE_URL}${suffix}`);
}

export function resolveDeploymentConfigUrl(
  authKind: Extract<UpstreamAuthKind, "deployment-key">,
  optIn: CliChatProxyOptIn,
): URL {
  void authKind;
  return resolveCliChatProxyUrl("/v1/deployment/config", optIn);
}
