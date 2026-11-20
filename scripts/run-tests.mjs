// Cross-platform test runner.
//
// Why this exists instead of `node --test tests/*.test.ts` in the npm script:
//   - Node's built-in test runner only learned to expand glob patterns itself
//     in Node 21. On Node 20 the glob must be expanded by the shell.
//   - npm runs package scripts through cmd.exe on Windows, which does NOT
//     expand globs. So on Windows + Node 20 the runner received the literal
//     `tests/*.test.ts` and failed with "Could not find ...".
//
// Expanding the glob here in JS makes test discovery independent of both the
// shell and the Node version, so the full OS x Node matrix stays green.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const TEST_DIR = 'tests';

let files;
try {
  files = readdirSync(TEST_DIR)
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => join(TEST_DIR, name))
    .sort();
} catch (err) {
  console.error(`Failed to read test directory "${TEST_DIR}/": ${err.message}`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`No *.test.ts files found in "${TEST_DIR}/".`);
  process.exit(1);
}

const nodeArgs = [
  '--test-concurrency=1',
  '--import',
  'tsx',
  '--experimental-test-module-mocks',
  '--test',
  ...files,
];

// Every test file runs against a throwaway home. Several suites write and
// delete ~/.progrok/auth.json; against the real home that wipes the user's
// OAuth session. HOME covers POSIX, USERPROFILE covers os.homedir() on Windows.
// tests/test-isolation.test.ts fails if this ever stops being true.
const realHome = homedir();
const testHome = mkdtempSync(join(tmpdir(), 'progrok-test-home-'));
const env = {
  ...process.env,
  HOME: testHome,
  USERPROFILE: testHome,
  PROGROK_TEST_HOME: testHome,
  PROGROK_REAL_HOME: realHome,
};

let result;
try {
  result = spawnSync(process.execPath, nodeArgs, { stdio: 'inherit', env });
} finally {
  rmSync(testHome, { recursive: true, force: true });
}

if (result.error) {
  console.error(`Failed to launch the test runner: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
