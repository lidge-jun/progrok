import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { proxyCommand } from "./commands/proxy.js";
import { chatCommand } from "./commands/chat.js";
import { modelsCommand } from "./commands/models.js";
import { statusCommand } from "./commands/status.js";
import { showStarPrompt } from "./utils/star-prompt.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf8"),
    ) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program
  .name("progrok")
  .description("Use Grok models for free via OAuth proxy. No API key needed.")
  .version(getVersion());

program.addCommand(loginCommand());
program.addCommand(logoutCommand());
program.addCommand(proxyCommand());
program.addCommand(chatCommand());
program.addCommand(modelsCommand());
program.addCommand(statusCommand());

const REAL_COMMANDS = new Set(["login", "logout", "proxy", "chat", "models", "status"]);
const subcommand = process.argv[2];
if (subcommand && REAL_COMMANDS.has(subcommand)) {
  await showStarPrompt();
}

program.parse();
