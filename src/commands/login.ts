import { Command } from "commander";
import { loginWithPKCE } from "../auth/pkce.js";
import { loginWithDeviceCode } from "../auth/device-code.js";
import { log } from "../utils/logger.js";

export function loginCommand(): Command {
  const cmd = new Command("login")
    .description(
      `Log in to xAI via OAuth (SuperGrok subscription required).
  Default: PKCE flow — opens browser, callback on 127.0.0.1:56121.
  Remote:  --device-code — displays URL + code for manual entry.
  Tokens saved to ~/.progrok/auth.json, auto-refreshed before expiry.`,
    )
    .option(
      "--device-code",
      "Use device code flow (for SSH/remote environments)",
    )
    .action(async (opts: { deviceCode?: boolean }) => {
      try {
        if (opts.deviceCode) {
          await loginWithDeviceCode();
        } else {
          await loginWithPKCE();
        }
      } catch (err) {
        log.error((err as Error).message);
        process.exit(1);
      }
    });
  return cmd;
}
