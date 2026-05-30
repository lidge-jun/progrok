import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { proxyCommand } from "./commands/proxy.js";
import { chatCommand } from "./commands/chat.js";
import { modelsCommand } from "./commands/models.js";
import { statusCommand } from "./commands/status.js";
import { skillCommand } from "./commands/skill.js";
import { capabilitiesCommand } from "./commands/capabilities.js";
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
  .description(
    `Use Grok models for free via OAuth proxy. No API key needed.

  SuperGrok OAuth → local proxy → OpenAI-compatible API for any client.
  All xAI endpoints forwarded: responses, chat, images, video, tts, stt.

  Quick start:
    $ progrok login          # OAuth via browser (or --device-code for SSH)
    $ progrok proxy          # Start proxy on 127.0.0.1:18645
    $ curl localhost:18645/v1/chat/completions -d '{"model":"grok-4.3",...}'

  Proxy forwards ALL /v1/* paths to api.x.ai — no whitelist.
  Supported xAI surfaces:
    /v1/responses            Responses API (streaming, tools, reasoning)
    /v1/chat/completions     OpenAI-compatible chat
    /v1/models               Model list
    /v1/language-models      Detailed models (pricing, aliases, modalities)
    /v1/images/generations   Image generation (grok-imagine-image)
    /v1/videos/generations   Video generation (async, poll /v1/videos/{id})
    /v1/tts                  Text-to-speech
    /v1/stt                  Speech-to-text
    /v1/batch/completions    Batch processing
    /v1/embeddings           Embeddings`,
  )
  .version(getVersion());

program.addCommand(loginCommand());
program.addCommand(logoutCommand());
program.addCommand(proxyCommand());
program.addCommand(chatCommand());
program.addCommand(modelsCommand());
program.addCommand(statusCommand());
program.addCommand(skillCommand());
program.addCommand(capabilitiesCommand());

const REAL_COMMANDS = new Set(["login", "logout", "proxy", "chat", "models", "status", "skill", "capabilities"]);
const subcommand = process.argv[2];
if (subcommand && REAL_COMMANDS.has(subcommand)) {
  await showStarPrompt();
}

program.parse();
