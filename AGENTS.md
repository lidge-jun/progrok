# progrok

Standalone CLI tool providing free Grok model access via OAuth proxy.

## Stack
- TypeScript (strict mode) + ESM
- Express (proxy + chat server)
- commander (CLI framework)
- tsup (build)

## Structure
- `src/auth/` — OAuth PKCE & device code, token storage
- `src/proxy/` — OpenAI-compatible credential-injecting proxy
- `src/chat/` — Web chat UI server + vanilla HTML/CSS/JS
- `src/commands/` — CLI command handlers
- `src/utils/` — Config, logger, star prompt

## Key Constants
- OAuth Client ID: `b1a00492-073a-47ea-816f-4c329264a828` (xAI shared)
- Callback port: 56121 (must match registered redirect URI)
- Proxy port: 18645
- Chat port: 18646
- Default model: `grok-4.3`
- Config dir: `~/.progrok/`
