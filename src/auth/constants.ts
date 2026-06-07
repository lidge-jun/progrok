import { homedir } from "node:os";
import { join } from "node:path";

// xAI shared OAuth Client (same as hermes-agent & openclaw — MIT licensed)
export const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_OAUTH_SCOPE =
  "openid profile email offline_access grok-cli:access api:access";
export const XAI_OAUTH_ISSUER = "https://auth.x.ai";
export const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;

// OAuth callback (MUST match registered redirect URI)
export const XAI_OAUTH_CALLBACK_HOST = "127.0.0.1";
export const XAI_OAUTH_CALLBACK_PORT = 56121;
export const XAI_OAUTH_CALLBACK_PATH = "/callback";
export const XAI_OAUTH_REDIRECT_URI = `http://${XAI_OAUTH_CALLBACK_HOST}:${XAI_OAUTH_CALLBACK_PORT}${XAI_OAUTH_CALLBACK_PATH}`;

// CORS origins for xAI auth
export const XAI_OAUTH_CORS_ORIGINS = ["auth.x.ai", "accounts.x.ai"];

// Timeouts
export const XAI_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
export const XAI_OAUTH_FETCH_TIMEOUT_MS = 30 * 1000;
export const XAI_DEVICE_CODE_POLL_INTERVAL_MS = 5 * 1000;

// Token refresh
export const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;

// API
export const XAI_API_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_MODEL = "grok-4.3";

/** Default model for `progrok search` (multi-agent + web/x tools). */
export const SEARCH_DEFAULT_MODEL = "grok-4.20-multi-agent-0309";

/** Default reasoning effort for search (multi-agent: high → 12 agents). */
export const SEARCH_DEFAULT_REASONING = "high";

// Proxy
export const PROXY_DEFAULT_PORT = 18645;
export const PROXY_DEFAULT_HOST = "127.0.0.1";
export const CHAT_DEFAULT_PORT = 18646;

// Paths
export const CONFIG_DIR = join(homedir(), ".progrok");
export const AUTH_FILE = join(CONFIG_DIR, "auth.json");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// GitHub
export const GITHUB_REPO = "lidge-jun/progrok";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
