import { Command } from "commander";
import { loginWithPKCE } from "../auth/pkce.js";
import { loginWithDeviceCode } from "../auth/device-code.js";
import { log } from "../utils/logger.js";

export function loginCommand(): Command {
  const cmd = new Command("login")
    .description(
      `Log in to xAI via OAuth (SuperGrok subscription required).
  Default: device-code flow — displays URL + code for manual entry.
  Browser: --browser — opens browser, callback on 127.0.0.1:56121.
  Manual:  --manual-paste — PKCE flow but paste the callback code manually.
  Tokens saved to ~/.progrok/auth.json, auto-refreshed before expiry.`,
    )
    .option(
      "--device-code",
      "Use device code flow (default)",
    )
    .option(
      "--browser",
      "Use PKCE browser flow with loopback callback",
    )
    .option(
      "--manual-paste",
      "Use PKCE flow but paste the authorization code manually",
    )
    .action(async (opts: { deviceCode?: boolean; browser?: boolean; manualPaste?: boolean }) => {
      try {
        if (opts.browser) {
          await loginWithPKCE();
        } else if (opts.manualPaste) {
          await loginWithPKCE({ manualPaste: true });
        } else {
          await loginWithDeviceCode();
        }
      } catch (err) {
        log.error((err as Error).message);
        process.exit(1);
      }
    });
  return cmd;
}
