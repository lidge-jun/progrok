import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(PKG_ROOT, "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version || "?";
  } catch {
    return "?";
  }
}
