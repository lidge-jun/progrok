import { after, afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  SaveTokenInput,
  TokenData,
} from "../src/auth/token-store.js";
import type { TokenManagerDependencies } from "../src/auth/token-manager.js";

const originalHome = process.env.HOME;
const tempHome = mkdtempSync(join(tmpdir(), "progrok-auth-test-"));
process.env.HOME = tempHome;

const constants = await import("../src/auth/constants.js");
const tokenStore = await import("../src/auth/token-store.js");
const tokenClient = await import("../src/auth/token-client.js");
const tokenManager = await import("../src/auth/token-manager.js");
const { fetchOIDCDiscovery } = await import("../src/auth/discovery.js");

const authFile = join(tempHome, ".progrok", "auth.json");
const configFile = join(tempHome, ".progrok", "config.json");
const tokenEndpoint = "https://auth.x.ai/oauth2/token";

function removeAuthFile(): void {
  rmSync(authFile, { force: true });
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

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function applySaveInput(
  current: TokenData,
  input: SaveTokenInput,
  now: number,
): TokenData {
  if (
    input.expectedCredential !== undefined &&
    (current.accessToken !== input.expectedCredential.accessToken ||
      current.refreshToken !== input.expectedCredential.refreshToken ||
      current.expiresAt !== input.expectedCredential.expiresAt ||
      current.tokenEndpoint !== input.expectedCredential.tokenEndpoint)
  ) {
    return current;
  }
  const next: TokenData = { ...current, accessToken: input.accessToken };
  for (const key of [
    "refreshToken",
    "tokenEndpoint",
    "idToken",
    "email",
    "accountId",
  ] as const) {
    if (!hasOwn(input, key)) continue;
    const value = input[key];
    if (typeof value === "string" && value.length > 0) next[key] = value;
    else delete next[key];
  }
  if (typeof input.expiresAt === "number") {
    next.expiresAt = input.expiresAt;
  } else if (typeof input.expiresIn === "number") {
    next.expiresAt = now + input.expiresIn * 1000;
  } else {
    delete next.expiresAt;
  }
  return next;
}

function createMemoryDependencies(options: {
  initial: TokenData;
  now?: () => number;
  fetch: TokenManagerDependencies["fetch"];
}): {
  deps: TokenManagerDependencies;
  getState(): TokenData;
  setState(next: TokenData): void;
  getSaveCount(): number;
} {
  let state = { ...options.initial };
  let saveCount = 0;
  const now = options.now ?? Date.now;
  return {
    deps: {
      now,
      fetch: options.fetch,
      load: () => ({ ...state }),
      save: async (input) => {
        saveCount += 1;
        state = applySaveInput(state, input, now());
      },
    },
    getState: () => ({ ...state }),
    setState: (next) => {
      state = { ...next };
    },
    getSaveCount: () => saveCount,
  };
}

afterEach(() => {
  removeAuthFile();
});

after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tempHome, { recursive: true, force: true });
});

describe("auth public compatibility", () => {
  it("keeps constants and login/logout/status command names and options", async () => {
    assert.equal(
      constants.XAI_OAUTH_CLIENT_ID,
      "b1a00492-073a-47ea-816f-4c329264a828",
    );
    assert.equal(constants.XAI_OAUTH_CALLBACK_PORT, 56121);
    assert.equal(constants.PROXY_DEFAULT_PORT, 18645);
    assert.equal(constants.CHAT_DEFAULT_PORT, 18646);
    assert.equal(constants.DEFAULT_MODEL, "grok-4.3");
    assert.equal(constants.TOKEN_REFRESH_SKEW_MS, 120_000);
    assert.equal(constants.XAI_TOKEN_MAX_ATTEMPTS, 3);
    assert.equal(constants.XAI_TOKEN_RETRY_AFTER_CAP_MS, 60_000);
    assert.equal(constants.XAI_REFRESH_FLIGHT_STALE_MS, 120_000);
    assert.equal(constants.XAI_TERMINAL_FAILURE_TTL_MS, 30_000);

    const [{ loginCommand }, { logoutCommand }, { statusCommand }] =
      await Promise.all([
        import("../src/commands/login.js"),
        import("../src/commands/logout.js"),
        import("../src/commands/status.js"),
      ]);
    const login = loginCommand();
    assert.equal(login.name(), "login");
    assert.deepEqual(
      login.options.map((option) => option.long).sort(),
      ["--browser", "--device-code", "--manual-paste"],
    );
    assert.equal(logoutCommand().name(), "logout");
    assert.equal(statusCommand().name(), "status");
  });

  it("reads the existing camelCase auth.json schema", () => {
    mkdirSync(join(tempHome, ".progrok"), { recursive: true });
    const fixture = {
      accessToken: "legacy-access",
      refreshToken: "legacy-refresh",
      expiresAt: 1_900_000_000_000,
      tokenEndpoint,
      email: "legacy@example.com",
      idToken: "legacy-id",
      accountId: "legacy-account",
    };
    writeFileSync(authFile, JSON.stringify(fixture));
    assert.deepEqual(tokenStore.loadTokens(), fixture);
  });

  it("preserves accountId and unknown fields through an atomic 0600 save", async () => {
    mkdirSync(join(tempHome, ".progrok"), { recursive: true });
    writeFileSync(
      authFile,
      JSON.stringify({
        accessToken: "old-access",
        refreshToken: "old-refresh",
        expiresAt: 1,
        tokenEndpoint,
        accountId: "shared-account",
        futureField: { version: 2 },
      }),
    );

    const before = Date.now();
    const previousInode = statSync(authFile).ino;
    await tokenStore.saveTokens({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 3600,
      tokenEndpoint,
    });
    const saved = tokenStore.loadTokens();
    assert.equal(saved?.accessToken, "new-access");
    assert.equal(saved?.accountId, "shared-account");
    assert.deepEqual(saved?.futureField, { version: 2 });
    assert.ok((saved?.expiresAt ?? 0) >= before + 3_600_000);
    assert.ok((saved?.expiresAt ?? Infinity) <= Date.now() + 3_600_000);
    if (process.platform !== "win32") {
      assert.notEqual(statSync(authFile).ino, previousInode);
      assert.equal(statSync(authFile).mode & 0o777, 0o600);
      assert.equal(statSync(join(tempHome, ".progrok")).mode & 0o777, 0o700);
    }
  });

  it("does not invent or inherit expiry when OAuth omits expires_in", async () => {
    await tokenStore.saveTokens({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: Date.now() + 60_000,
      tokenEndpoint,
    });
    await tokenStore.saveTokensFromOAuthPayload(
      { access_token: "new-access", refresh_token: "new-refresh" },
      { tokenEndpoint },
    );
    const saved = tokenStore.loadTokens();
    assert.equal(saved?.accessToken, "new-access");
    assert.equal(saved?.refreshToken, "new-refresh");
    assert.equal(saved?.expiresAt, undefined);
  });

  it("refuses to publish refresh output over a newer credential generation", async () => {
    const generationA = {
      accessToken: "access-a",
      refreshToken: "refresh-a",
      expiresAt: 10,
      tokenEndpoint,
    };
    await tokenStore.saveTokens(generationA);
    await tokenStore.saveTokens({
      accessToken: "access-b",
      refreshToken: "refresh-b",
      expiresAt: 20,
      tokenEndpoint,
    });
    await tokenStore.saveTokens({
      accessToken: "late-access-a",
      refreshToken: "late-refresh-a",
      expiresAt: 30,
      tokenEndpoint,
      expectedCredential: generationA,
    });
    assert.equal(tokenStore.loadTokens()?.accessToken, "access-b");
    assert.equal(tokenStore.loadTokens()?.refreshToken, "refresh-b");
  });

  it("keeps display identity extraction compatible with malformed JWTs", async () => {
    const idToken = makeJwt({ sub: "account-1", email: "USER@EXAMPLE.COM" });
    await tokenStore.saveTokens({ accessToken: "access", idToken });
    assert.equal(tokenStore.loadTokens()?.accountId, "account-1");
    assert.equal(tokenStore.loadTokens()?.email, "user@example.com");

    await tokenStore.saveTokens({
      accessToken: "next-access",
      idToken: "not-a-jwt",
    });
    assert.equal(tokenStore.loadTokens()?.accountId, undefined);
    assert.equal(tokenStore.loadTokens()?.email, undefined);
  });

  it("keeps explicit logout idempotent", async () => {
    await tokenStore.saveTokens({ accessToken: "delete-me" });
    assert.ok(tokenStore.loadTokens());
    tokenStore.deleteTokens();
    assert.equal(tokenStore.loadTokens(), null);
    assert.doesNotThrow(() => tokenStore.deleteTokens());
  });
});

describe("token endpoint client", () => {
  it("retries Retry-After 0.01 and rejects 61 seconds without sleeping", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const payload = await tokenClient.postXaiToken(
      tokenEndpoint,
      { grant_type: "test" },
      {
        deps: {
          fetch: async () => {
            calls += 1;
            return calls === 1
              ? jsonResponse({ error: "temporarily_unavailable" }, 429, {
                  "Retry-After": "0.01",
                })
              : jsonResponse({ access_token: "fresh" });
          },
          sleep: async (ms) => {
            sleeps.push(ms);
          },
          now: () => 0,
        },
      },
    );
    assert.equal(payload.access_token, "fresh");
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [10]);

    calls = 0;
    sleeps.length = 0;
    await assert.rejects(
      tokenClient.postXaiToken(
        tokenEndpoint,
        { grant_type: "test" },
        {
          deps: {
            fetch: async () => {
              calls += 1;
              return jsonResponse({ error: "server_busy" }, 429, {
                "Retry-After": "61",
              });
            },
            sleep: async (ms) => {
              sleeps.push(ms);
            },
            now: () => 0,
          },
        },
      ),
      (error: unknown) =>
        error instanceof tokenClient.OAuthTokenRequestError &&
        error.retryAfterMs === 61_000,
    );
    assert.equal(calls, 1);
    assert.deepEqual(sleeps, []);
  });

  it("limits 500 and network failures to three attempts", async () => {
    let httpCalls = 0;
    await assert.rejects(
      tokenClient.postXaiToken(tokenEndpoint, {}, {
        deps: {
          fetch: async () => {
            httpCalls += 1;
            return jsonResponse({ error: "server_error" }, 500);
          },
          sleep: async () => {},
        },
      }),
      tokenClient.OAuthTokenRequestError,
    );
    assert.equal(httpCalls, 3);

    let networkCalls = 0;
    await assert.rejects(
      tokenClient.postXaiToken(tokenEndpoint, {}, {
        deps: {
          fetch: async () => {
            networkCalls += 1;
            throw new Error("socket unavailable");
          },
          sleep: async () => {},
        },
      }),
      tokenClient.OAuthTokenRequestError,
    );
    assert.equal(networkCalls, 3);
  });

  it("does not retry timeout or caller abort", async () => {
    let timeoutCalls = 0;
    await assert.rejects(
      tokenClient.postXaiToken(tokenEndpoint, {}, {
        deps: {
          fetch: async () => {
            timeoutCalls += 1;
            const error = new Error("timed out");
            error.name = "TimeoutError";
            throw error;
          },
          sleep: async () => {},
        },
      }),
      /timed out/,
    );
    assert.equal(timeoutCalls, 1);

    const controller = new AbortController();
    const reason = new Error("caller stopped");
    controller.abort(reason);
    let abortCalls = 0;
    await assert.rejects(
      tokenClient.postXaiToken(tokenEndpoint, {}, {
        signal: controller.signal,
        deps: {
          fetch: async () => {
            abortCalls += 1;
            throw new Error("fetch aborted");
          },
          sleep: async () => {},
        },
      }),
      (error: unknown) => error === reason,
    );
    assert.equal(abortCalls, 1);
  });
});

describe("OIDC discovery boundary", () => {
  it("accepts only exact trusted HTTPS hosts without userinfo or ports", async () => {
    let payload: Record<string, unknown> = {
      authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
      token_endpoint: "https://accounts.x.ai/oauth2/token",
      device_authorization_endpoint: "https://auth.x.ai/oauth2/device",
    };
    const fetchMock = mock.method(globalThis, "fetch", async () =>
      jsonResponse(payload),
    );
    try {
      const trusted = await fetchOIDCDiscovery();
      assert.equal(trusted.tokenEndpoint, "https://accounts.x.ai/oauth2/token");

      for (const untrusted of [
        "https://evil.x.ai.example/oauth2/token",
        "https://sub.auth.x.ai/oauth2/token",
        "https://user@auth.x.ai/oauth2/token",
        "https://auth.x.ai:444/oauth2/token",
        "http://auth.x.ai/oauth2/token",
      ]) {
        payload = { ...payload, token_endpoint: untrusted };
        await assert.rejects(fetchOIDCDiscovery(), /untrusted token_endpoint/);
      }
    } finally {
      fetchMock.mock.restore();
    }
  });
});

describe("token manager", () => {
  it("uses raw expiry with a 120-second comparison-time skew", async () => {
    const now = 1_000_000;
    let fetchCalls = 0;
    const memory = createMemoryDependencies({
      initial: {
        accessToken: "access-a",
        refreshToken: "refresh-a",
        expiresAt: now + 121_000,
        tokenEndpoint,
        accountId: "account-a",
      },
      now: () => now,
      fetch: async () => {
        fetchCalls += 1;
        return jsonResponse({ access_token: "access-b", expires_in: 3600 });
      },
    });
    const manager = tokenManager.createTokenManager(memory.deps);
    assert.equal(await manager.getValidBearer(), "access-a");
    assert.equal(fetchCalls, 0);

    memory.setState({
      ...memory.getState(),
      expiresAt: now + 119_000,
    });
    assert.equal(await manager.getValidBearer(), "access-b");
    assert.equal(fetchCalls, 1);
    assert.equal(memory.getState().refreshToken, "refresh-a");
    assert.equal(memory.getState().expiresAt, now + 3_600_000);
  });

  it("singleflights twenty concurrent refreshes for one account and generation", async () => {
    let fetchCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const memory = createMemoryDependencies({
      initial: {
        accessToken: "old-access",
        refreshToken: "shared-refresh",
        expiresAt: 0,
        tokenEndpoint,
        accountId: "shared-account",
      },
      now: () => 10_000,
      fetch: async () => {
        fetchCalls += 1;
        await gate;
        return jsonResponse({ access_token: "fresh-access", expires_in: 60 });
      },
    });
    const manager = tokenManager.createTokenManager(memory.deps);
    const requests = Array.from({ length: 20 }, () => manager.getValidBearer());
    await Promise.resolve();
    assert.equal(fetchCalls, 1);
    release();
    assert.deepEqual(await Promise.all(requests), Array(20).fill("fresh-access"));
    assert.equal(fetchCalls, 1);
    assert.equal(memory.getSaveCount(), 1);
  });

  it("does not join flights after the disk account key changes", async () => {
    let state: TokenData = {
      accessToken: "access-a",
      refreshToken: "refresh-a",
      expiresAt: 0,
      tokenEndpoint,
      accountId: "account-a",
    };
    const releases = new Map<string, () => void>();
    const gates = new Map<string, Promise<void>>();
    for (const refresh of ["refresh-a", "refresh-b"]) {
      gates.set(
        refresh,
        new Promise<void>((resolve) => releases.set(refresh, resolve)),
      );
    }
    let fetchCalls = 0;
    const deps: TokenManagerDependencies = {
      now: () => 20_000,
      load: () => ({ ...state }),
      save: async (input) => {
        state = applySaveInput(state, input, 20_000);
      },
      fetch: async (_input, init) => {
        fetchCalls += 1;
        const refresh = new URLSearchParams(String(init?.body)).get(
          "refresh_token",
        ) as string;
        await gates.get(refresh);
        return jsonResponse({
          access_token: refresh === "refresh-a" ? "fresh-a" : "fresh-b",
          expires_in: 60,
        });
      },
    };
    const manager = tokenManager.createTokenManager(deps);
    const first = manager.getValidBearer();
    await Promise.resolve();
    state = {
      accessToken: "access-b",
      refreshToken: "refresh-b",
      expiresAt: 0,
      tokenEndpoint,
      accountId: "account-b",
    };
    const second = manager.getValidBearer();
    await Promise.resolve();
    assert.equal(fetchCalls, 2);

    releases.get("refresh-b")?.();
    assert.equal(await second, "fresh-b");
    releases.get("refresh-a")?.();
    assert.equal(await first, "fresh-b");
    assert.equal(state.accessToken, "fresh-b");
  });

  it("does not overwrite a newer disk generation with a late refresh", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const memory = createMemoryDependencies({
      initial: {
        accessToken: "access-a",
        refreshToken: "refresh-a",
        expiresAt: 0,
        tokenEndpoint,
        accountId: "account-a",
      },
      now: () => 30_000,
      fetch: async () => {
        await gate;
        return jsonResponse({ access_token: "late-access", expires_in: 60 });
      },
    });
    const manager = tokenManager.createTokenManager(memory.deps);
    const pending = manager.getValidBearer();
    await Promise.resolve();
    memory.setState({
      accessToken: "external-access",
      refreshToken: "external-refresh",
      expiresAt: 999_999,
      tokenEndpoint,
      accountId: "account-a",
    });
    release();
    assert.equal(await pending, "external-access");
    assert.equal(memory.getState().accessToken, "external-access");
    assert.equal(memory.getSaveCount(), 0);
  });

  it("ignores a late terminal result after the disk generation advances", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const memory = createMemoryDependencies({
      initial: {
        accessToken: "access-a",
        refreshToken: "refresh-a",
        expiresAt: 0,
        tokenEndpoint,
        accountId: "account-a",
      },
      now: () => 32_000,
      fetch: async () => {
        await gate;
        return jsonResponse({ error: "invalid_grant" }, 400);
      },
    });
    const manager = tokenManager.createTokenManager(memory.deps);
    const pending = manager.getValidBearer();
    await Promise.resolve();
    memory.setState({
      accessToken: "external-access",
      refreshToken: "external-refresh",
      expiresAt: 999_999,
      tokenEndpoint,
      accountId: "account-a",
    });
    release();
    assert.equal(await pending, "external-access");
    assert.equal(await manager.getValidBearer(), "external-access");
  });

  it("keeps the generation fence inside the final save boundary", async () => {
    let state: TokenData = {
      accessToken: "access-a",
      refreshToken: "refresh-a",
      expiresAt: 0,
      tokenEndpoint,
      accountId: "account-a",
    };
    const deps: TokenManagerDependencies = {
      now: () => 35_000,
      load: () => ({ ...state }),
      fetch: async () =>
        jsonResponse({ access_token: "late-access", expires_in: 60 }),
      save: async (input) => {
        state = {
          accessToken: "external-access",
          refreshToken: "external-refresh",
          expiresAt: 90_000,
          tokenEndpoint,
          accountId: "account-a",
        };
        state = applySaveInput(state, input, 35_000);
      },
    };
    const manager = tokenManager.createTokenManager(deps);
    assert.equal(await manager.getValidBearer(), "external-access");
    assert.equal(state.accessToken, "external-access");
  });

  it("negative-caches only the three terminal OAuth errors for 30 seconds", async () => {
    for (const oauthError of [
      "invalid_grant",
      "refresh_token_reused",
      "revoked_token",
    ]) {
      const responseSentinel = `credential-response-${oauthError}`;
      let now = 40_000;
      let fetchCalls = 0;
      const memory = createMemoryDependencies({
        initial: {
          accessToken: `access-${oauthError}`,
          refreshToken: `refresh-${oauthError}`,
          expiresAt: 0,
          tokenEndpoint,
          accountId: `account-${oauthError}`,
        },
        now: () => now,
        fetch: async () => {
          fetchCalls += 1;
          return jsonResponse({
            error: oauthError,
            error_description: responseSentinel,
          }, 400);
        },
      });
      const manager = tokenManager.createTokenManager(memory.deps);
      await assert.rejects(
        manager.getValidBearer(),
        (error) =>
          error instanceof Error &&
          /no longer valid/.test(error.message) &&
          !error.message.includes(responseSentinel),
      );
      await assert.rejects(manager.getValidBearer(), /no longer valid/);
      assert.equal(fetchCalls, 1);
      assert.ok(memory.getState().accessToken);

      now += 30_001;
      await assert.rejects(manager.getValidBearer(), /no longer valid/);
      assert.equal(fetchCalls, 2);
      assert.ok(memory.getState().accessToken);
    }
  });

  it("does not negative-cache a non-terminal OAuth error", async () => {
    let fetchCalls = 0;
    const memory = createMemoryDependencies({
      initial: {
        accessToken: "access-a",
        refreshToken: "refresh-a",
        expiresAt: 0,
        tokenEndpoint,
        accountId: "non-terminal-account",
      },
      now: () => 80_000,
      fetch: async () => {
        fetchCalls += 1;
        return jsonResponse({ error: "invalid_client" }, 400);
      },
    });
    const manager = tokenManager.createTokenManager(memory.deps);
    await assert.rejects(manager.getValidBearer(), /refresh failed/);
    await assert.rejects(manager.getValidBearer(), /refresh failed/);
    assert.equal(fetchCalls, 2);
  });

  it("increments public generation only when the credential fingerprint changes", async () => {
    const memory = createMemoryDependencies({
      initial: { accessToken: "access-a", accountId: "account-a" },
      fetch: async () => {
        throw new Error("unexpected fetch");
      },
    });
    const manager = tokenManager.createTokenManager(memory.deps);
    const first = await manager.getValidBearerSnapshot();
    const same = await manager.getValidBearerSnapshot();
    assert.equal(first.generation, same.generation);
    assert.equal(first.expiresAt, Number.POSITIVE_INFINITY);

    memory.setState({ accessToken: "access-b", accountId: "account-a" });
    const changed = await manager.getValidBearerSnapshot();
    assert.equal(changed.generation, first.generation + 1);
  });
});

describe("401 one-shot replay", () => {
  it("cancels only the first 401 body, refreshes once, and returns the second 401", async () => {
    await tokenStore.saveTokens({
      accessToken: "access-a",
      refreshToken: "refresh-a",
      expiresAt: Date.now() + 3_600_000,
      tokenEndpoint,
      accountId: "replay-account",
    });
    let refreshCalls = 0;
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      refreshCalls += 1;
      return jsonResponse({ access_token: "access-b", expires_in: 3600 });
    });
    let cancelled = 0;
    let runCalls = 0;
    const firstBody = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled += 1;
      },
    });
    try {
      const result = await tokenManager.withBearer401Replay(async (bearer) => {
        runCalls += 1;
        assert.equal(bearer, runCalls === 1 ? "access-a" : "access-b");
        return runCalls === 1
          ? new Response(firstBody, { status: 401 })
          : new Response("still unauthorized", { status: 401 });
      });
      assert.equal(result.status, 401);
      assert.equal(runCalls, 2);
      assert.equal(refreshCalls, 1);
      assert.equal(cancelled, 1);
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("replays with a newer disk token without refreshing rejected token A", async () => {
    await tokenStore.saveTokens({
      accessToken: "access-a",
      refreshToken: "refresh-a",
      expiresAt: Date.now() + 3_600_000,
      tokenEndpoint,
      accountId: "advanced-account",
    });
    let fetchCalls = 0;
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      fetchCalls += 1;
      throw new Error("refresh must not run");
    });
    const bearers: string[] = [];
    try {
      const result = await tokenManager.withBearer401Replay(async (bearer) => {
        bearers.push(bearer);
        if (bearers.length === 1) {
          await tokenStore.saveTokens({
            accessToken: "access-b",
            refreshToken: "refresh-b",
            expiresAt: Date.now() + 3_600_000,
            tokenEndpoint,
            accountId: "advanced-account",
          });
          return new Response(null, { status: 401 });
        }
        return new Response(null, { status: 200 });
      });
      assert.equal(result.status, 200);
      assert.deepEqual(bearers, ["access-a", "access-b"]);
      assert.equal(fetchCalls, 0);
    } finally {
      fetchMock.mock.restore();
    }
  });
});

it("wires PKCE and device-code login through the shared OAuth save path", () => {
  for (const file of ["src/auth/pkce.ts", "src/auth/device-code.ts"]) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert.match(source, /import \{ saveTokensFromOAuthPayload \}/);
    assert.match(source, /await saveTokensFromOAuthPayload\(tokens,/);
    assert.doesNotMatch(source, /await saveTokens\(/);
  }
});

it("preserves config and onboarding utilities beside the auth changes", async () => {
  const { readConfig, writeConfig } = await import("../src/utils/config.js");
  const { showStarPrompt } = await import("../src/utils/star-prompt.js");
  rmSync(configFile, { force: true });
  assert.deepEqual(readConfig(), {});
  writeConfig({ onboarding: { starPrompted: true } });
  assert.deepEqual(readConfig(), { onboarding: { starPrompted: true } });
  rmSync(configFile, { force: true });
  await showStarPrompt();
  assert.equal(readConfig().onboarding?.starPrompted, true);
  assert.equal(existsSync(configFile), true);
});
