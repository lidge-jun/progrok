# progrok API Reference

progrok runs a local proxy on `http://127.0.0.1:18645` that forwards requests to the xAI API (`https://api.x.ai/v1`), injecting your OAuth token automatically.

**Key behavior:** The proxy strips any `Authorization` header you send and replaces it with the stored OAuth bearer token. You can pass any value (or omit it entirely) -- the proxy handles auth.

---

## Proxy Endpoints

### GET /health

Health check. Returns proxy status.

```bash
curl http://127.0.0.1:18645/health
```

**Response:**

```json
{"status": "ok", "upstream": "xAI Grok", "proxy": "progrok"}
```

---

### POST /v1/responses

xAI Responses API passthrough. Sends the request body directly to `https://api.x.ai/v1/responses`.

```bash
curl http://127.0.0.1:18645/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-4.3",
    "input": "Explain OAuth PKCE in one sentence."
  }'
```

Supports streaming when the upstream response uses `text/event-stream`.

---

### POST /v1/chat/completions

OpenAI-compatible chat completions. This is the primary endpoint for most clients (Cursor, Continue, aider, etc.).

```bash
curl http://127.0.0.1:18645/v1/chat/completions \
  -H "Authorization: Bearer anything" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-4.3",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

The `Authorization` header value is ignored. The proxy injects the OAuth token.

---

### POST /v1/completions

Legacy completions endpoint.

```bash
curl http://127.0.0.1:18645/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-4.3",
    "prompt": "The meaning of life is",
    "max_tokens": 100
  }'
```

---

### POST /v1/embeddings

Text embeddings endpoint.

```bash
curl http://127.0.0.1:18645/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "v1",
    "input": "progrok is an OAuth proxy for xAI"
  }'
```

---

### GET /v1/models

List available models.

```bash
curl http://127.0.0.1:18645/v1/models
```

Returns the model list from the xAI API.

---

### Disallowed Paths

Any `/v1/*` path not listed above returns `404`:

```json
{
  "error": {
    "message": "Path /v1/foo is not proxied. Allowed: /responses, /chat/completions, /completions, /embeddings, /models",
    "type": "path_not_allowed"
  }
}
```

---

### Error Responses

| Status | Type | Cause |
|--------|------|-------|
| 401 | `auth_error` | Not logged in or token expired and refresh failed |
| 404 | `path_not_allowed` | Requested path is not in the allowed set |
| 502 | `upstream_error` | xAI API unreachable or returned a network error |

---

## Authentication

progrok uses xAI's OAuth 2.0 endpoints discovered via OIDC at `https://auth.x.ai/.well-known/openid-configuration`. Two flows are supported.

### PKCE Flow (default)

Used by `progrok login`. Requires a browser on the same machine.

```
  CLI                       Browser                   xAI Auth
   |                           |                         |
   |-- generate verifier+challenge (SHA-256/base64url) --|
   |-- generate random state --|                         |
   |                           |                         |
   |-- open authorize URL ---->|                         |
   |                           |---- user logs in ------>|
   |                           |                         |
   |<--- redirect to 127.0.0.1:56121/callback?code=...&state=... ---|
   |                           |                         |
   |-- POST token endpoint (code + verifier) ----------->|
   |<-- access_token, refresh_token, id_token -----------|
   |                           |                         |
   |-- save to ~/.progrok/auth.json                      |
```

Parameters sent to the authorization endpoint:

| Parameter | Value |
|-----------|-------|
| client_id | `b1a00492-073a-47ea-816f-4c329264a828` |
| redirect_uri | `http://127.0.0.1:56121/callback` |
| response_type | `code` |
| scope | `openid profile email offline_access grok-cli:access api:access` |
| code_challenge_method | `S256` |

The callback server listens on `127.0.0.1:56121` and times out after 5 minutes.

---

### Device Code Flow

Used by `progrok login --device-code`. For headless/SSH environments where a browser is not available locally.

1. CLI requests a device code from the device authorization endpoint.
2. CLI prints a verification URL and user code.
3. User opens the URL on any device, enters the code, and authorizes.
4. CLI polls the token endpoint every 5 seconds until authorized.
5. Tokens are saved to `~/.progrok/auth.json`.

```bash
progrok login --device-code
# Output:
# Open this URL in your browser:
#   https://auth.x.ai/device?user_code=ABCD-EFGH
#
# Enter code: ABCD-EFGH
```

---

### Token Refresh

The proxy automatically refreshes expired tokens before forwarding requests:

- A token is considered expired when the current time is within **2 minutes** of `expiresAt`.
- The proxy sends a `refresh_token` grant to the stored token endpoint.
- The refreshed tokens are written back to `~/.progrok/auth.json`.
- If refresh fails (no refresh token, endpoint unreachable, or grant rejected), the proxy returns `401` and the user must run `progrok login` again.

---

## Configuration

### ~/.progrok/auth.json

Stored with mode `0600`. Written automatically by `progrok login`.

```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "dGhpcyBpcyBh...",
  "expiresAt": 1717100000000,
  "tokenEndpoint": "https://auth.x.ai/oauth2/token",
  "email": "user@example.com",
  "idToken": "eyJhbG..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| accessToken | string | Bearer token injected into upstream requests |
| refreshToken | string? | Used to obtain a new access token when expired |
| expiresAt | number? | Unix timestamp (ms) when the access token expires |
| tokenEndpoint | string? | URL used for token exchange and refresh |
| email | string? | Extracted from the id_token JWT payload |
| idToken | string? | OIDC id_token from the authorization server |

---

### ~/.progrok/config.json

Stored with mode `0600`. Application preferences.

```json
{
  "onboarding": {
    "starPrompted": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| onboarding.starPrompted | boolean? | Whether the GitHub star prompt has been shown |

---

### Environment Variables

No environment variables are required. All configuration is file-based under `~/.progrok/`.

---

### Proxy Options

| Flag | Default | Description |
|------|---------|-------------|
| `-p, --port <port>` | `18645` | Port for the proxy server |
| `--host <host>` | `127.0.0.1` | Host/interface to bind |
