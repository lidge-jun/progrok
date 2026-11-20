import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { AUTH_FILE, CONFIG_DIR, CONFIG_FILE } from "../src/auth/constants.js";

// The suite writes and deletes ~/.progrok/auth.json while it exercises the token
// store and the voice clients. Against a real home that destroys the user's OAuth
// session, so the runner gives the whole run a throwaway home and records which
// home it replaced.

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

describe("test isolation", () => {
  it("runs with a throwaway home supplied by the test runner", () => {
    const testHome = process.env.PROGROK_TEST_HOME;
    assert.ok(testHome, "PROGROK_TEST_HOME is unset: run the suite through scripts/run-tests.mjs (npm test)");
    assert.equal(homedir(), testHome);
  });

  it("keeps every progrok path out of the real home", () => {
    const realHome = process.env.PROGROK_REAL_HOME;
    const testHome = process.env.PROGROK_TEST_HOME;
    assert.ok(realHome, "PROGROK_REAL_HOME is unset: the runner must record the home it replaced");
    assert.ok(testHome);
    assert.notEqual(realHome, testHome);
    const realConfig = join(realHome, ".progrok");
    for (const path of [CONFIG_DIR, AUTH_FILE, CONFIG_FILE]) {
      assert.equal(inside(realConfig, path), false, `${path} is inside the real ${realConfig}`);
      assert.equal(inside(testHome, path), true, `${path} is outside the test home`);
    }
  });
});

