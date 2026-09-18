import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The source layout puts this file two levels below the manifest, the bundle
 * puts it one. A fixed "../.." is right for exactly one of them, and the bundle
 * is the one users run — which is why `progrok --version` printed "?".
 *
 * Walk up instead, and only accept this package's own manifest so a parent
 * project's package.json cannot answer for us.
 */
export function findPackageRoot(start: string): string | undefined {
  let dir = start;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as { name?: string };
        if (parsed.name === "progrok") return dir;
      } catch {
        // keep walking; an unreadable manifest is not ours
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export function readPackageVersion(): string {
  try {
    const root = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
    if (!root) return "?";
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version || "?";
  } catch {
    return "?";
  }
}
