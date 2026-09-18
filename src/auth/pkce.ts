import { randomBytes, createHash } from "node:crypto";
import { createInterface } from "node:readline";
import {
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_SCOPE,
  XAI_OAUTH_REDIRECT_URI,
} from "./constants.js";
import { fetchOIDCDiscovery } from "./discovery.js";
import { startCallbackServer } from "./callback-server.js";
import { postXaiToken } from "./token-client.js";
import { saveTokensFromOAuthPayload } from "./token-store.js";
import { openUrl } from "../utils/open-url.js";
import { log } from "../utils/logger.js";

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

interface PKCEOptions {
  manualPaste?: boolean;
}

function extractCodeFromInput(
  input: string,
): { code: string; state?: string } | null {
  const trimmed = input.trim();
  // Full callback URL: http://127.0.0.1:56121/callback?code=XXX&state=YYY
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (code) return { code, ...(state === null ? {} : { state }) };
  } catch { /* not a URL */ }
  // Query fragment: ?code=XXX&state=YYY
  if (trimmed.startsWith("?")) {
    const params = new URLSearchParams(trimmed.slice(1));
    const code = params.get("code");
    const state = params.get("state");
    if (code) return { code, ...(state === null ? {} : { state }) };
  }
  // Bare code (no whitespace, no = sign typically)
  if (trimmed.length > 10 && !trimmed.includes(" ")) {
    return { code: trimmed };
  }
  return null;
}

async function promptForCode(expectedState: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.question("\n  Paste the callback URL or authorization code: ", (answer) => {
      rl.close();
      const result = extractCodeFromInput(answer);
      if (!result) {
        reject(new Error("Could not extract authorization code from input."));
      } else if (
        result.state !== undefined &&
        result.state !== expectedState
      ) {
        reject(new Error("OAuth callback state did not match."));
      } else {
        resolve(result.code);
      }
    });
  });
}

export async function loginWithPKCE(options: PKCEOptions = {}): Promise<void> {
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

  let code: string;

  if (options.manualPaste) {
    log.info("Opening browser for xAI login (manual-paste mode)...");
    log.dim(
      `Visit this URL to authorize:\n${authorizeUrl.toString()}`,
    );
    log.dim(
      `\nAfter approving, paste the callback URL or the authorization code shown on the page.`,
    );
    await openUrl(authorizeUrl.toString());
    code = await promptForCode(state);
  } else {
    log.info("Opening browser for xAI login...");
    log.dim(
      `If the browser doesn't open, visit:\n${authorizeUrl.toString()}`,
    );
    const callbackPromise = startCallbackServer(state);
    await openUrl(authorizeUrl.toString());
    const result = await callbackPromise;
    code = result.code;
  }

  log.info("Exchanging authorization code...");

  const tokens = await postXaiToken(discovery.tokenEndpoint, {
    grant_type: "authorization_code",
    client_id: XAI_OAUTH_CLIENT_ID,
    code,
    redirect_uri: XAI_OAUTH_REDIRECT_URI,
    code_verifier: pkce.verifier,
  });
  await saveTokensFromOAuthPayload(tokens, {
    tokenEndpoint: discovery.tokenEndpoint,
  });

  log.success("Logged in to xAI successfully!");
}
