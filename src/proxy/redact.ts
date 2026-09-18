/**
 * Error messages reach the client and the log. Anything that flows through here
 * may have picked up a credential on the way: an upstream error that echoes the
 * Authorization header, a fetch failure carrying a signed URL, a token pasted
 * into a config value. Echoing `Error.message` verbatim publishes it.
 *
 * So redact by shape rather than by trusting the source. The patterns below are
 * the credential shapes this project actually handles, plus a generic long
 * high-entropy run for the ones it does not.
 */

const PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bxai-[A-Za-z0-9._~+/-]{8,}/gi,
  /\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b[A-Za-z0-9_-]{40,}\b/g,
];

const MAX_LENGTH = 300;

/** Replace credential-shaped runs with a marker and cap the length. */
export function redactSecrets(value: string): string {
  let out = value;
  for (const pattern of PATTERNS) out = out.replace(pattern, "[redacted]");
  return out.length > MAX_LENGTH ? `${out.slice(0, MAX_LENGTH)}…` : out;
}

/** Safe message for an unknown thrown value. */
export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw);
}
