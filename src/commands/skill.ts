import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { readPackageVersion } from "../utils/version.js";
import { log } from "../utils/logger.js";

// tsup bundles to dist/index.js → one level up is the project root
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_PATH = join(ROOT, "skills", "progrok", "SKILL.md");



function readSkill(): string {
  if (!existsSync(SKILL_PATH)) {
    log.error(`packaged skill not found: ${SKILL_PATH}`);
    process.exit(5);
  }
  return readFileSync(SKILL_PATH, "utf-8");
}

export function skillCommand(): Command {
  return new Command("skill")
    .description(
      `Print the packaged progrok Markdown skill for agents.
  Designed to be piped into agent context or read programmatically.`,
    )
    .argument("[subcommand]", '"path" to print the resolved skill file path')
    .option("--json", "Output as JSON wrapper around the Markdown skill")
    .action((subcommand: string | undefined, opts: { json?: boolean }) => {
      if (subcommand === "path") {
        console.log(SKILL_PATH);
        return;
      }

      const content = readSkill();

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              name: "progrok",
              format: "markdown-skill",
              formatVersion: "1",
              packageVersion: readPackageVersion(),
              path: relative(ROOT, SKILL_PATH),
              source: "package",
              content,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(content.replace(/\n$/, ""));
    });
}
