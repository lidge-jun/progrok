import { Command } from "commander";
import {
  createRegisteredCommands,
  isCommandName,
} from "./commands/command-registry.js";
import { showStarPrompt } from "./utils/star-prompt.js";
import { readPackageVersion } from "./utils/version.js";



const program = new Command();
program.enablePositionalOptions();

program
  .name("progrok")
  .description(
    `Activate your xAI OAuth session as a local Grok API proxy and CLI tool surface.

  SuperGrok OAuth → native xAI clients + local OpenAI-compatible proxy.

  Quick start:
    $ progrok login
    $ progrok proxy
    $ progrok tts "Hello" --output hello.mp3
    $ progrok stt meeting.wav --json
    $ progrok live --event '{"type":"session.update","session":{}}' --once

  The proxy keeps forwarding every HTTP /v1/* path. WebSocket commands connect
  directly to api.x.ai and never expose your OAuth token through the local proxy.`,
  )
  .version(readPackageVersion());

for (const command of createRegisteredCommands()) {
  program.addCommand(command);
}

const subcommand = process.argv[2];
const reservesStdout = process.argv.includes("--json") ||
  (subcommand === "tts" && process.argv.includes("--stdout")) ||
  subcommand === "live";
if (subcommand && isCommandName(subcommand) && !reservesStdout) {
  await showStarPrompt();
}

process.on("unhandledRejection", (err) => {
  console.error(`\x1b[31m${(err as Error)?.message ?? err}\x1b[0m`);
  process.exit(1);
});

program.parse();
