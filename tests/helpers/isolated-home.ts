import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Imported FIRST by test files that write progrok credentials. ES modules
// evaluate imports in order, so this runs before src/auth/constants.ts captures
// homedir() into CONFIG_DIR. npm test already supplies a throwaway home through
// scripts/run-tests.mjs; this covers a file run on its own with node --test.
if (!process.env.PROGROK_TEST_HOME) {
  const realHome = homedir();
  const testHome = mkdtempSync(join(tmpdir(), "progrok-test-home-"));
  process.env.PROGROK_REAL_HOME = realHome;
  process.env.PROGROK_TEST_HOME = testHome;
  process.env.HOME = testHome;
  process.env.USERPROFILE = testHome;
  process.once("exit", () => rmSync(testHome, { recursive: true, force: true }));
}

