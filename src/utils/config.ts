import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { CONFIG_DIR, CONFIG_FILE } from "../auth/constants.js";

interface AppConfig {
  onboarding?: {
    starPrompted?: boolean;
  };
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function readConfig(): AppConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as AppConfig;
  } catch {
    return {};
  }
}

export function writeConfig(config: AppConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}
