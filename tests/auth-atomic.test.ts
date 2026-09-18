import { after, mock, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalHome = process.env.HOME;
const testHome = fs.mkdtempSync(join(tmpdir(), "progrok-auth-atomic-test-"));
process.env.HOME = testHome;

const originalRenameSync = fs.renameSync;
let blockAuthPublish = false;
const fsMock = mock.module("node:fs", {
  exports: {
    chmodSync: fs.chmodSync,
    existsSync: fs.existsSync,
    mkdirSync: fs.mkdirSync,
    readFileSync: fs.readFileSync,
    rmSync: fs.rmSync,
    writeFileSync: fs.writeFileSync,
    renameSync(from: fs.PathLike, to: fs.PathLike): void {
      if (blockAuthPublish && String(to).endsWith("/.progrok/auth.json")) {
        throw Object.assign(new Error("injected rename failure"), {
          code: "EACCES",
        });
      }
      originalRenameSync(from, to);
    },
  },
});

const tokenStore = await import("../src/auth/token-store.js");
const authDir = join(testHome, ".progrok");
const authFile = join(authDir, "auth.json");

after(() => {
  fsMock.restore();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(testHome, { recursive: true, force: true });
});

test("atomic auth publish preserves the previous credential when rename fails", async () => {
  fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
  const previous = Buffer.from(JSON.stringify({
    accessToken: "previous-access",
    refreshToken: "previous-refresh",
    tokenEndpoint: "https://auth.x.ai/oauth2/token",
  }));
  fs.writeFileSync(authFile, previous, { mode: 0o600 });

  blockAuthPublish = true;
  try {
    await assert.rejects(
      tokenStore.saveTokens({ accessToken: "replacement" }),
      /injected rename failure/,
    );
  } finally {
    blockAuthPublish = false;
  }

  assert.deepEqual(fs.readFileSync(authFile), previous);
  assert.deepEqual(
    fs.readdirSync(authDir).filter((name) => name.startsWith("auth.json.tmp-")),
    [],
  );
});
