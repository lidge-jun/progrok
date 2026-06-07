import {
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_SCOPE,
  XAI_OAUTH_FETCH_TIMEOUT_MS,
  XAI_DEVICE_CODE_POLL_INTERVAL_MS,
} from "./constants.js";
import { fetchOIDCDiscovery } from "./discovery.js";
import { saveTokens, type OAuthTokenResponse } from "./token-store.js";
import { log } from "../utils/logger.js";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

export async function loginWithDeviceCode(): Promise<void> {
  const discovery = await fetchOIDCDiscovery();

  if (!discovery.deviceAuthorizationEndpoint) {
    throw new Error(
      "xAI does not support device code flow via OIDC discovery",
    );
  }

  log.info("Requesting device code...");

  const dcRes = await fetch(discovery.deviceAuthorizationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: XAI_OAUTH_CLIENT_ID,
      scope: XAI_OAUTH_SCOPE,
    }),
    signal: AbortSignal.timeout(XAI_OAUTH_FETCH_TIMEOUT_MS),
  });

  if (!dcRes.ok) {
    throw new Error(`Device code request failed: ${await dcRes.text()}`);
  }

  const dc = (await dcRes.json()) as DeviceCodeResponse;

  const url = dc.verification_uri_complete || dc.verification_uri;
  log.info(`\nOpen this URL in your browser:\n  ${url}\n`);
  log.info(`Enter code: ${dc.user_code}\n`);

  const intervalMs = Math.max(
    (dc.interval || 5) * 1000,
    XAI_DEVICE_CODE_POLL_INTERVAL_MS,
  );
  const deadline = Date.now() + dc.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const pollRes = await fetch(discovery.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: XAI_OAUTH_CLIENT_ID,
        device_code: dc.device_code,
      }),
      signal: AbortSignal.timeout(XAI_OAUTH_FETCH_TIMEOUT_MS),
    });

    if (pollRes.ok) {
      const tokens = (await pollRes.json()) as OAuthTokenResponse;
      await saveTokens({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        idToken: tokens.id_token,
        tokenEndpoint: discovery.tokenEndpoint,
      });
      log.success("Logged in to xAI successfully!");
      return;
    }

    const err = (await pollRes.json()) as Record<string, string>;
    if (err.error === "authorization_pending") continue;
    if (err.error === "slow_down") {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    throw new Error(
      `Device code poll failed: ${err.error_description || err.error}`,
    );
  }

  throw new Error("Device code expired. Please try again.");
}
