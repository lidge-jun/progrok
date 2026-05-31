import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

export async function readManualAuthorizationCode(
  expectedState: string,
): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const value = (
      await rl.question(
        "Paste the full localhost callback URL, or paste only the authorization code: ",
      )
    ).trim();

    if (!value) {
      throw new Error("No authorization code was provided");
    }

    if (/^https?:\/\//i.test(value)) {
      const parsed = new URL(value);
      const error = parsed.searchParams.get("error");
      if (error) {
        throw new Error(
          `OAuth error: ${parsed.searchParams.get("error_description") || error}`,
        );
      }

      const code = parsed.searchParams.get("code");
      if (!code) {
        throw new Error("Callback URL did not contain a code parameter");
      }

      const state = parsed.searchParams.get("state");
      if (state !== expectedState) {
        throw new Error("Callback URL state did not match this login attempt");
      }

      return code;
    }

    return value;
  } finally {
    rl.close();
  }
}
