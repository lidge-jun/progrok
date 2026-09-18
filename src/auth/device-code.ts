import {
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_SCOPE,
  XAI_DEVICE_CODE_POLL_INTERVAL_MS,
} from "./constants.js";
import { fetchOIDCDiscovery } from "./discovery.js";
import {
  OAuthTokenRequestError,
  postXaiToken,
} from "./token-client.js";
import { saveTokensFromOAuthPayload } from "./token-store.js";
import { log } from "../utils/logger.js";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

function parseDeviceCodeResponse(value: unknown): DeviceCodeResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Device code request returned an invalid response");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.device_code !== "string" ||
    !record.device_code ||
    typeof record.user_code !== "string" ||
    !record.user_code ||
    typeof record.verification_uri !== "string" ||
    !record.verification_uri ||
    typeof record.expires_in !== "number" ||
    !Number.isFinite(record.expires_in) ||
    record.expires_in <= 0
  ) {
    throw new Error("Device code request returned an invalid response");
  }
  return {
    device_code: record.device_code,
    user_code: record.user_code,
    verification_uri: record.verification_uri,
    ...(typeof record.verification_uri_complete === "string"
      ? { verification_uri_complete: record.verification_uri_complete }
      : {}),
    expires_in: record.expires_in,
    ...(typeof record.interval === "number" &&
    Number.isFinite(record.interval)
      ? { interval: record.interval }
      : {}),
  };
}

export async function loginWithDeviceCode(): Promise<void> {
  const discovery = await fetchOIDCDiscovery();

  if (!discovery.deviceAuthorizationEndpoint) {
    throw new Error(
      "xAI does not support device code flow via OIDC discovery",
    );
  }

  log.info("Requesting device code...");

  const rawDeviceCode: unknown = await postXaiToken(
    discovery.deviceAuthorizationEndpoint,
    {
      client_id: XAI_OAUTH_CLIENT_ID,
      scope: XAI_OAUTH_SCOPE,
    },
  );
  const dc = parseDeviceCodeResponse(rawDeviceCode);

  const url = dc.verification_uri_complete || dc.verification_uri;
  log.info(`\nOpen this URL in your browser:\n  ${url}\n`);
  log.info(`Enter code: ${dc.user_code}\n`);

  let intervalMs = Math.max(
    (dc.interval ?? 5) * 1000,
    XAI_DEVICE_CODE_POLL_INTERVAL_MS,
  );
  const deadline = Date.now() + dc.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));

    try {
      const tokens = await postXaiToken(discovery.tokenEndpoint, {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: XAI_OAUTH_CLIENT_ID,
        device_code: dc.device_code,
      });
      await saveTokensFromOAuthPayload(tokens, {
        tokenEndpoint: discovery.tokenEndpoint,
      });
      log.success("Logged in to xAI successfully!");
      return;
    } catch (error) {
      if (!(error instanceof OAuthTokenRequestError)) throw error;
      if (error.oauthError === "authorization_pending") continue;
      if (error.oauthError === "slow_down") {
        intervalMs += 5_000;
        continue;
      }
      if (
        error.oauthError === "expired_token" ||
        error.oauthError === "access_denied"
      ) {
        break;
      }
      throw error;
    }
  }

  throw new Error("Device code expired or was denied. Please try again.");
}
