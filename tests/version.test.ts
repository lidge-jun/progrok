import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { findPackageRoot, readPackageVersion } from "../src/utils/version.js";

function layout(depth: number, name = "progrok"): { root: string; moduleDir: string } {
  const root = mkdtempSync(join(tmpdir(), "progrok-version-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, version: "9.9.9" }));
  let moduleDir = root;
  for (let i = 0; i < depth; i += 1) {
    moduleDir = join(moduleDir, "level" + String(i));
    mkdirSync(moduleDir);
  }
  return { root, moduleDir };
}

describe("package version resolution", () => {
  it("finds the manifest one level up, which is the bundled layout", () => {
    // dist/index.js: the old fixed "../.." overshot the package entirely and
    // made `progrok --version` print "?".
    const { root, moduleDir } = layout(1);
    assert.equal(findPackageRoot(moduleDir), root);
  });

  it("finds the manifest two levels up, which is the source layout", () => {
    const { root, moduleDir } = layout(2);
    assert.equal(findPackageRoot(moduleDir), root);
  });

  it("ignores a manifest that belongs to someone else", () => {
    const { moduleDir } = layout(1, "some-host-project");
    assert.equal(findPackageRoot(moduleDir), undefined);
  });

  it("reports a real version rather than a placeholder", () => {
    const version = readPackageVersion();
    assert.notEqual(version, "?");
    assert.match(version, /^\d+\.\d+\.\d+/);
  });
});
