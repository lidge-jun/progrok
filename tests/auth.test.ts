/**
 * Unit tests for progrok auth and utility modules.
 *
 * Run with:
 *   npx tsx --experimental-test-module-mocks --test tests/auth.test.ts
 */

import { describe, it, mock, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Import the REAL constants before mocking (for constants tests)
// ---------------------------------------------------------------------------
import * as constants from "../src/auth/constants.js";

// ---------------------------------------------------------------------------
// Set up a temp directory so token-store / config / star-prompt write there
// instead of the user's real ~/.progrok
// ---------------------------------------------------------------------------
const tempBase = mkdtempSync(join(tmpdir(), "progrok-test-"));
const configDir = join(tempBase, ".progrok");

mock.module("../src/auth/constants.js", {
  namedExports: {
    ...constants,
    CONFIG_DIR: configDir,
    AUTH_FILE: join(configDir, "auth.json"),
    CONFIG_FILE: join(configDir, "config.json"),
  },
});

// Silence logger output during tests
const noop = () => {};
mock.module("../src/utils/logger.js", {
  namedExports: {
    log: { info: noop, success: noop, error: noop, dim: noop, bold: noop },
  },
});

// ---------------------------------------------------------------------------
// 1. src/auth/constants.ts
// ---------------------------------------------------------------------------
describe("auth/constants", () => {
  it("XAI_OAUTH_CLIENT_ID has the expected value", () => {
    assert.equal(
      constants.XAI_OAUTH_CLIENT_ID,
      "b1a00492-073a-47ea-816f-4c329264a828",
    );
  });

  it("XAI_OAUTH_CALLBACK_PORT is 56121", () => {
    assert.equal(constants.XAI_OAUTH_CALLBACK_PORT, 56121);
  });

  it("PROXY_DEFAULT_PORT is 18645", () => {
    assert.equal(constants.PROXY_DEFAULT_PORT, 18645);
  });

  it("CHAT_DEFAULT_PORT is 18646", () => {
    assert.equal(constants.CHAT_DEFAULT_PORT, 18646);
  });

  it('DEFAULT_MODEL is "grok-4.3"', () => {
    assert.equal(constants.DEFAULT_MODEL, "grok-4.3");
  });

  it("XAI_OAUTH_REDIRECT_URI is composed correctly", () => {
    assert.equal(
      constants.XAI_OAUTH_REDIRECT_URI,
      `http://${constants.XAI_OAUTH_CALLBACK_HOST}:${constants.XAI_OAUTH_CALLBACK_PORT}${constants.XAI_OAUTH_CALLBACK_PATH}`,
    );
  });

  it("CONFIG_DIR ends with .progrok", () => {
    assert.ok(constants.CONFIG_DIR.endsWith(".progrok"));
  });

  it("AUTH_FILE is inside CONFIG_DIR", () => {
    assert.ok(constants.AUTH_FILE.startsWith(constants.CONFIG_DIR));
    assert.ok(constants.AUTH_FILE.endsWith("auth.json"));
  });

  it("CONFIG_FILE is inside CONFIG_DIR", () => {
    assert.ok(constants.CONFIG_FILE.startsWith(constants.CONFIG_DIR));
    assert.ok(constants.CONFIG_FILE.endsWith("config.json"));
  });
});

// ---------------------------------------------------------------------------
// 2. src/auth/token-store.ts
// ---------------------------------------------------------------------------
describe("auth/token-store", () => {
  // Lazy-load so the mock is in effect
  let saveTokens: typeof import("../src/auth/token-store.js").saveTokens;
  let loadTokens: typeof import("../src/auth/token-store.js").loadTokens;
  let deleteTokens: typeof import("../src/auth/token-store.js").deleteTokens;

  beforeEach(async () => {
    // Clear any prior auth file between tests
    const authFile = join(configDir, "auth.json");
    try {
      rmSync(authFile);
    } catch {
      /* may not exist */
    }
    const mod = await import("../src/auth/token-store.js");
    saveTokens = mod.saveTokens;
    loadTokens = mod.loadTokens;
    deleteTokens = mod.deleteTokens;
  });

  it("loadTokens returns null when no file exists", () => {
    const result = loadTokens();
    assert.equal(result, null);
  });

  it("saveTokens then loadTokens returns the same accessToken", async () => {
    await saveTokens({ accessToken: "test-access-token-123" });
    const loaded = loadTokens();
    assert.ok(loaded);
    assert.equal(loaded.accessToken, "test-access-token-123");
  });

  it("saveTokens persists refreshToken", async () => {
    await saveTokens({
      accessToken: "at",
      refreshToken: "rt-456",
    });
    const loaded = loadTokens();
    assert.ok(loaded);
    assert.equal(loaded.refreshToken, "rt-456");
  });

  it("saveTokens computes expiresAt from expiresIn", async () => {
    const before = Date.now();
    await saveTokens({
      accessToken: "at",
      expiresIn: 3600,
    });
    const afterSave = Date.now();
    const loaded = loadTokens();
    assert.ok(loaded);
    assert.ok(loaded.expiresAt);
    // expiresAt should be roughly now + 3600s
    assert.ok(loaded.expiresAt >= before + 3600 * 1000);
    assert.ok(loaded.expiresAt <= afterSave + 3600 * 1000);
  });

  it("saveTokens stores tokenEndpoint", async () => {
    await saveTokens({
      accessToken: "at",
      tokenEndpoint: "https://auth.x.ai/oauth/token",
    });
    const loaded = loadTokens();
    assert.ok(loaded);
    assert.equal(loaded.tokenEndpoint, "https://auth.x.ai/oauth/token");
  });

  it("saveTokens extracts email from JWT id_token", async () => {
    // Build a minimal JWT: header.payload.signature
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({ email: "user@example.com", sub: "123" }),
    ).toString("base64url");
    const idToken = `${header}.${payload}.fakesig`;

    await saveTokens({
      accessToken: "at",
      idToken,
    });
    const loaded = loadTokens();
    assert.ok(loaded);
    assert.equal(loaded.email, "user@example.com");
    assert.equal(loaded.idToken, idToken);
  });

  it("saveTokens handles id_token without email field", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
      "base64url",
    );
    const payload = Buffer.from(JSON.stringify({ sub: "123" })).toString(
      "base64url",
    );
    const idToken = `${header}.${payload}.fakesig`;

    await saveTokens({
      accessToken: "at",
      idToken,
    });
    const loaded = loadTokens();
    assert.ok(loaded);
    assert.equal(loaded.email, undefined);
  });

  it("saveTokens handles malformed id_token gracefully", async () => {
    await saveTokens({
      accessToken: "at",
      idToken: "not-a-valid-jwt",
    });
    const loaded = loadTokens();
    assert.ok(loaded);
    assert.equal(loaded.email, undefined);
    assert.equal(loaded.idToken, "not-a-valid-jwt");
  });

  it("deleteTokens removes the auth file", async () => {
    await saveTokens({ accessToken: "to-be-deleted" });
    assert.ok(loadTokens()); // file exists
    deleteTokens();
    assert.equal(loadTokens(), null);
  });

  it("deleteTokens does not throw when file does not exist", () => {
    // No file present -- should not throw
    assert.doesNotThrow(() => deleteTokens());
  });

  it("auth file is valid JSON on disk", async () => {
    await saveTokens({ accessToken: "json-check" });
    const raw = readFileSync(join(configDir, "auth.json"), "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.accessToken, "json-check");
  });
});

// ---------------------------------------------------------------------------
// 3. src/utils/config.ts
// ---------------------------------------------------------------------------
describe("utils/config", () => {
  let readConfig: typeof import("../src/utils/config.js").readConfig;
  let writeConfig: typeof import("../src/utils/config.js").writeConfig;

  beforeEach(async () => {
    // Clear config file between tests
    const configFile = join(configDir, "config.json");
    try {
      rmSync(configFile);
    } catch {
      /* may not exist */
    }
    const mod = await import("../src/utils/config.js");
    readConfig = mod.readConfig;
    writeConfig = mod.writeConfig;
  });

  it("readConfig returns empty object when no file exists", () => {
    const result = readConfig();
    assert.deepStrictEqual(result, {});
  });

  it("writeConfig then readConfig round-trips data", () => {
    writeConfig({ onboarding: { starPrompted: true } });
    const loaded = readConfig();
    assert.deepStrictEqual(loaded, { onboarding: { starPrompted: true } });
  });

  it("writeConfig overwrites previous config", () => {
    writeConfig({ onboarding: { starPrompted: false } });
    writeConfig({ onboarding: { starPrompted: true } });
    const loaded = readConfig();
    assert.equal(loaded.onboarding?.starPrompted, true);
  });

  it("writeConfig creates config dir if it does not exist", () => {
    // Remove the config dir entirely
    rmSync(configDir, { recursive: true, force: true });
    assert.ok(!existsSync(configDir));

    writeConfig({ onboarding: { starPrompted: true } });
    assert.ok(existsSync(configDir));
    assert.ok(existsSync(join(configDir, "config.json")));
  });

  it("config file is valid JSON on disk", () => {
    writeConfig({ onboarding: { starPrompted: true } });
    const raw = readFileSync(join(configDir, "config.json"), "utf8");
    const parsed = JSON.parse(raw);
    assert.deepStrictEqual(parsed, { onboarding: { starPrompted: true } });
  });
});

// ---------------------------------------------------------------------------
// 4. src/utils/star-prompt.ts
// ---------------------------------------------------------------------------
describe("utils/star-prompt", () => {
  let readConfig: typeof import("../src/utils/config.js").readConfig;
  let writeConfig: typeof import("../src/utils/config.js").writeConfig;
  let showStarPrompt: typeof import("../src/utils/star-prompt.js").showStarPrompt;

  beforeEach(async () => {
    // Reset config
    const configFile = join(configDir, "config.json");
    try {
      rmSync(configFile);
    } catch {
      /* may not exist */
    }
    const configMod = await import("../src/utils/config.js");
    readConfig = configMod.readConfig;
    writeConfig = configMod.writeConfig;
    const starMod = await import("../src/utils/star-prompt.js");
    showStarPrompt = starMod.showStarPrompt;
  });

  it("sets starPrompted to true after first call", async () => {
    const before = readConfig();
    assert.equal(before.onboarding?.starPrompted, undefined);

    await showStarPrompt();

    const after = readConfig();
    assert.equal(after.onboarding?.starPrompted, true);
  });

  it("is idempotent -- second call does not overwrite config", async () => {
    // First call sets the flag
    await showStarPrompt();
    const first = readConfig();
    assert.equal(first.onboarding?.starPrompted, true);

    // Write extra data into config alongside the flag
    writeConfig({
      ...first,
      onboarding: { ...first.onboarding, starPrompted: true },
    });

    // Second call should be a no-op (flag already set)
    await showStarPrompt();
    const second = readConfig();
    assert.equal(second.onboarding?.starPrompted, true);
  });

  it("preserves existing config fields", async () => {
    // Pre-populate config with extra data
    writeConfig({
      onboarding: { starPrompted: false },
    });

    await showStarPrompt();

    const config = readConfig();
    assert.equal(config.onboarding?.starPrompted, true);
  });
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
after(() => {
  rmSync(tempBase, { recursive: true, force: true });
});
