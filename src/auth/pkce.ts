import { randomBytes, createHash } from "node:crypto";
import {
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_SCOPE,
  XAI_OAUTH_REDIRECT_URI,
  XAI_OAUTH_FETCH_TIMEOUT_MS,
} from "./constants.js";
import { fetchOIDCDiscovery } from "./discovery.js";
import { startCallbackServer } from "./callback-server.js";
import { readManualAuthorizationCode } from "./manual-code.js";
import { saveTokens } from "./token-store.js";
import { openUrl } from "../utils/open-url.js";
import { log } from "../utils/logger.js";

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export async function loginWithPKCE(
  options: { manualCode?: boolean } = {},
): Promise<void> {
  const discovery = await fetchOIDCDiscovery();
  const pkce = generatePKCE();
  const state = randomBytes(16).toString("hex");

  const authorizeUrl = new URL(discovery.authorizationEndpoint);
  authorizeUrl.searchParams.set("client_id", XAI_OAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", XAI_OAUTH_REDIRECT_URI);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", XAI_OAUTH_SCOPE);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", pkce.challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  log.info(
    options.manualCode
      ? "Manual xAI login for headless/remote environments..."
      : "Opening browser for xAI login...",
  );
  log.dim(
    `If the browser doesn't open, visit:\n${authorizeUrl.toString()}`,
  );

  let code: string;
  if (options.manualCode) {
    log.info(
      `\nOpen the URL above on your local machine. After login, your browser may fail to\nload 127.0.0.1; copy that full address-bar URL back here.\n`,
    );
    code = await readManualAuthorizationCode(state);
  } else {
    const callbackPromise = startCallbackServer(state);
    await openUrl(authorizeUrl.toString());
    ({ code } = await callbackPromise);
  }

  log.info("Exchanging authorization code...");

  const tokenRes = await fetch(discovery.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: XAI_OAUTH_CLIENT_ID,
      code,
      redirect_uri: XAI_OAUTH_REDIRECT_URI,
      code_verifier: pkce.verifier,
    }),
    signal: AbortSignal.timeout(XAI_OAUTH_FETCH_TIMEOUT_MS),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const tokens = (await tokenRes.json()) as Record<string, unknown>;

  await saveTokens({
    accessToken: tokens.access_token as string,
    refreshToken: tokens.refresh_token as string | undefined,
    expiresIn: tokens.expires_in as number | undefined,
    idToken: tokens.id_token as string | undefined,
    tokenEndpoint: discovery.tokenEndpoint,
  });

  log.success("Logged in to xAI successfully!");
}
