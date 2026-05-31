/**
 * Unit tests for progrok auth and utility modules.
 *
 * Run with:
 *   npm test
 */

import { after, it, mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";

const tempBase = mkdtempSync(join(os.tmpdir(), "progrok-test-"));
const configDir = join(tempBase, ".progrok");
const authFile = join(configDir, "auth.json");
const configFile = join(configDir, "config.json");

mock.module("node:os", {
  namedExports: {
    ...os,
    homedir: () => tempBase,
  },
});

const noop = () => {};
mock.module("../src/utils/logger.js", {
  namedExports: {
    log: { info: noop, success: noop, error: noop, dim: noop, bold: noop },
  },
});

function removeAuthFile(): void {
  rmSync(authFile, { force: true });
}

function removeConfigFile(): void {
  rmSync(configFile, { force: true });
}

function removeConfigDir(): void {
  rmSync(configDir, { recursive: true, force: true });
}

function makeJwt(payloadData: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify(payloadData)).toString(
    "base64url",
  );
  return `${header}.${payload}.fakesig`;
}

it("validates auth constants and stateful auth utilities sequentially", async () => {
  const constants = await import("../src/auth/constants.js");

  assert.equal(
    constants.XAI_OAUTH_CLIENT_ID,
    "b1a00492-073a-47ea-816f-4c329264a828",
  );
  assert.equal(constants.XAI_OAUTH_CALLBACK_PORT, 56121);
  assert.equal(constants.PROXY_DEFAULT_PORT, 18645);
  assert.equal(constants.CHAT_DEFAULT_PORT, 18646);
  assert.equal(constants.DEFAULT_MODEL, "grok-4.3");
  assert.equal(
    constants.XAI_OAUTH_REDIRECT_URI,
    `http://${constants.XAI_OAUTH_CALLBACK_HOST}:${constants.XAI_OAUTH_CALLBACK_PORT}${constants.XAI_OAUTH_CALLBACK_PATH}`,
  );
  assert.ok(constants.CONFIG_DIR.endsWith(".progrok"));
  assert.ok(constants.AUTH_FILE.startsWith(constants.CONFIG_DIR));
  assert.ok(constants.AUTH_FILE.endsWith("auth.json"));
  assert.ok(constants.CONFIG_FILE.startsWith(constants.CONFIG_DIR));
  assert.ok(constants.CONFIG_FILE.endsWith("config.json"));

  const { saveTokens, loadTokens, deleteTokens } = await import(
    "../src/auth/token-store.js"
  );

  removeAuthFile();
  assert.equal(loadTokens(), null);

  await saveTokens({ accessToken: "test-access-token-123" });
  assert.equal(loadTokens()?.accessToken, "test-access-token-123");

  removeAuthFile();
  await saveTokens({ accessToken: "at", refreshToken: "rt-456" });
  assert.equal(loadTokens()?.refreshToken, "rt-456");

  removeAuthFile();
  const before = Date.now();
  await saveTokens({ accessToken: "at", expiresIn: 3600 });
  const afterSave = Date.now();
  const expiring = loadTokens();
  assert.ok(expiring?.expiresAt);
  assert.ok(expiring.expiresAt >= before + 3600 * 1000);
  assert.ok(expiring.expiresAt <= afterSave + 3600 * 1000);

  removeAuthFile();
  await saveTokens({
    accessToken: "at",
    tokenEndpoint: "https://auth.x.ai/oauth/token",
  });
  assert.equal(loadTokens()?.tokenEndpoint, "https://auth.x.ai/oauth/token");

  removeAuthFile();
  const emailJwt = makeJwt({ email: "user@example.com", sub: "123" });
  await saveTokens({ accessToken: "at", idToken: emailJwt });
  const emailTokens = loadTokens();
  assert.equal(emailTokens?.email, "user@example.com");
  assert.equal(emailTokens?.idToken, emailJwt);

  removeAuthFile();
  await saveTokens({ accessToken: "at", idToken: makeJwt({ sub: "123" }) });
  assert.equal(loadTokens()?.email, undefined);

  removeAuthFile();
  await saveTokens({ accessToken: "at", idToken: "not-a-valid-jwt" });
  const malformed = loadTokens();
  assert.equal(malformed?.email, undefined);
  assert.equal(malformed?.idToken, "not-a-valid-jwt");

  removeAuthFile();
  await saveTokens({ accessToken: "to-be-deleted" });
  assert.ok(loadTokens());
  deleteTokens();
  assert.equal(loadTokens(), null);
  assert.doesNotThrow(() => deleteTokens());

  removeAuthFile();
  await saveTokens({ accessToken: "json-check" });
  assert.equal(JSON.parse(readFileSync(authFile, "utf8")).accessToken, "json-check");

  const { readConfig, writeConfig } = await import("../src/utils/config.js");

  removeConfigFile();
  assert.deepStrictEqual(readConfig(), {});

  writeConfig({ onboarding: { starPrompted: true } });
  assert.deepStrictEqual(readConfig(), {
    onboarding: { starPrompted: true },
  });

  writeConfig({ onboarding: { starPrompted: false } });
  writeConfig({ onboarding: { starPrompted: true } });
  assert.equal(readConfig().onboarding?.starPrompted, true);

  removeConfigDir();
  assert.equal(existsSync(configDir), false);
  writeConfig({ onboarding: { starPrompted: true } });
  assert.equal(existsSync(configDir), true);
  assert.equal(existsSync(configFile), true);

  writeConfig({ onboarding: { starPrompted: true } });
  assert.deepStrictEqual(JSON.parse(readFileSync(configFile, "utf8")), {
    onboarding: { starPrompted: true },
  });

  const { showStarPrompt } = await import("../src/utils/star-prompt.js");

  removeConfigFile();
  assert.equal(readConfig().onboarding?.starPrompted, undefined);
  await showStarPrompt();
  assert.equal(readConfig().onboarding?.starPrompted, true);

  await showStarPrompt();
  assert.equal(readConfig().onboarding?.starPrompted, true);

  writeConfig({ onboarding: { starPrompted: false } });
  await showStarPrompt();
  assert.equal(readConfig().onboarding?.starPrompted, true);
});

after(() => {
  rmSync(tempBase, { recursive: true, force: true });
});
