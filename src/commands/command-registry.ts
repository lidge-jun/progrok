import type { Command } from "commander";
import type { CommandName } from "./command-manifest.js";
import { loginCommand } from "./login.js";
import { logoutCommand } from "./logout.js";
import { proxyCommand } from "./proxy.js";
import { chatCommand } from "./chat.js";
import { modelsCommand } from "./models.js";
import { statusCommand } from "./status.js";
import { skillCommand } from "./skill.js";
import { capabilitiesCommand } from "./capabilities.js";
import { searchCommand } from "./search.js";
import { videoCommand } from "./video.js";
import { imageCommand } from "./image.js";
import { billingCommand } from "./billing.js";
import { ttsCommand } from "./tts.js";
import { sttCommand } from "./stt.js";
import { liveCommand } from "./live.js";

export type CommandFactory = () => Command;

export const COMMAND_FACTORIES = {
  login: loginCommand,
  logout: logoutCommand,
  proxy: proxyCommand,
  chat: chatCommand,
  models: modelsCommand,
  status: statusCommand,
  skill: skillCommand,
  capabilities: capabilitiesCommand,
  search: searchCommand,
  video: videoCommand,
  image: imageCommand,
  billing: billingCommand,
  tts: ttsCommand,
  stt: sttCommand,
  live: liveCommand,
} satisfies Record<CommandName, CommandFactory>;

export const REAL_COMMANDS = new Set<CommandName>(
  Object.keys(COMMAND_FACTORIES) as CommandName[],
);

export function isCommandName(value: string): value is CommandName {
  return REAL_COMMANDS.has(value as CommandName);
}

export function createRegisteredCommands(): Command[] {
  return Object.values(COMMAND_FACTORIES).map((factory) => factory());
}
