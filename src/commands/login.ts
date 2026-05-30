import { Command } from "commander";
import { loginWithPKCE } from "../auth/pkce.js";
import { loginWithDeviceCode } from "../auth/device-code.js";
import { log } from "../utils/logger.js";

export function loginCommand(): Command {
  const cmd = new Command("login")
    .description("Log in to xAI via OAuth")
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
