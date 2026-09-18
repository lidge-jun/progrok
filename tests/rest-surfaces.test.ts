import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  XaiFetchInput,
  XaiTransport,
} from "../src/transport/fetch.js";
import {
  BatchesClient,
  CollectionsSearchClient,
  EmbeddingsClient,
  FilesClient,
  ImagesClient,
  MiscClient,
  ModelsClient,
  SkillsClient,
  VideosClient,
  connectResponsesWebSocket,
} from "../src/surfaces/index.js";
import { XaiSurfaceError } from "../src/surfaces/client.js";
import { SURFACE_REGISTRY } from "../src/surfaces/registry.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recorder(
  reply: (input: XaiFetchInput) => Response | Promise<Response>,
): { transport: XaiTransport; requests: XaiFetchInput[] } {
  const requests: XaiFetchInput[] = [];
  return {
    requests,
    transport: {
      async fetch(input) {
        requests.push(input);
        return reply(input);
      },
    },
  };
}

describe("REST surface public boundary", () => {
  it("exports the nine clients and Responses WebSocket connector", () => {
    for (const value of [
      BatchesClient,
      CollectionsSearchClient,
      EmbeddingsClient,
      FilesClient,
      ImagesClient,
      MiscClient,
      ModelsClient,
      SkillsClient,
      VideosClient,
      connectResponsesWebSocket,
    ]) {
      assert.equal(typeof value, "function");
    }
  });

  it("keeps OpenAPI-only and official-guide evidence explicit", () => {
    const expectedOpenApi = [
      "/v1/responses/{response_id}/input_items",
      "/v1/embeddings",
      "/v1/embedding-models",
      "/v1/embedding-models/{model_id}",
      "/v1/skills",
      "/v1/skills/{skill_id}",
      "/v1/skills/{skill_id}/content",
      "/v1/me",
      "/v1/files/{file_id}/content",
      "/v1/files/{file_id}/public-url",
      "/v1/files/{file_id}/public-url/revoke",
    ];
    for (const path of expectedOpenApi) {
      const matches = SURFACE_REGISTRY.filter((entry) => entry.path === path);
      assert(matches.length > 0, path);
      assert(matches.every((entry) => entry.evidence === "openapi-only"), path);
    }
    assert(
      SURFACE_REGISTRY.filter((entry) => entry.family === "batches").every(
        (entry) => entry.evidence === "official-guide",
      ),
    );
  });
});

describe("REST surface request contracts", () => {
  it("encodes batch paths, pagination, methods, and request bodies", async () => {
    const recorded = recorder((input) => {
      if (input.pathWithQuery.endsWith("/requests") && input.method === "POST") {
        return new Response(null, { status: 204 });
      }
      return json({
        batch_id: "batch_1",
        name: "nightly",
        state: { status: "pending" },
      });
    });
    const client = new BatchesClient(recorded.transport);
    await client.create("nightly");
    await client.get("../bad/?id");
    await client.list({ limit: 2, paginationToken: "next/token" });
    await client.addRequests("../bad/?id", [
      { batch_request_id: "r1", batch_request: { method: "POST" } },
    ]);
    await client.cancel("../bad/?id");

    assert.equal(recorded.requests[0]?.method, "POST");
    assert.deepEqual(JSON.parse(String(recorded.requests[0]?.body)), {
      name: "nightly",
    });
    assert.equal(
      recorded.requests[1]?.pathWithQuery,
      "/batches/..%2Fbad%2F%3Fid",
    );
    assert.equal(
      recorded.requests[2]?.pathWithQuery,
      "/batches?limit=2&pagination_token=next%2Ftoken",
    );
    assert.equal(
      recorded.requests[3]?.pathWithQuery,
      "/batches/..%2Fbad%2F%3Fid/requests",
    );
    assert.equal(recorded.requests[3]?.method, "POST");
    assert.equal(
      recorded.requests[4]?.pathWithQuery,
      "/batches/..%2Fbad%2F%3Fid:cancel",
    );
  });

  it("validates unknown JSON and preserves bounded upstream errors", async () => {
    const missing = new BatchesClient(
      recorder(() => json({ name: "missing id", state: {} })).transport,
    );
    await assert.rejects(missing.get("x"), /batch\.batch_id/);

    const structured = new MiscClient(
      recorder(() =>
        json(
          { error: { code: "conflict", message: "already exists" } },
          409,
        ),
      ).transport,
    );
    await assert.rejects(
      structured.me(),
      (error) =>
        error instanceof XaiSurfaceError &&
        error.status === 409 &&
        error.code === "conflict" &&
        error.message === "already exists",
    );

    const bounded = new MiscClient(
      recorder(() => new Response("x".repeat(8_192), { status: 502 })).transport,
    );
    await assert.rejects(
      bounded.me(),
      (error) =>
        error instanceof XaiSurfaceError &&
        error.status === 502 &&
        error.message.length === 4_096,
    );
  });

  it("keeps file and skill multipart boundaries browser-generated", async () => {
    const fileRecorded = recorder((input) => {
      assert(input.body instanceof FormData);
      assert.equal(input.headers.has("content-type"), false);
      assert.deepEqual([...input.body.keys()], ["purpose", "expires_after", "file"]);
      return json({
        id: "file_1",
        filename: "a.txt",
        bytes: 1,
        created_at: 1,
      });
    });
    await new FilesClient(fileRecorded.transport).upload({
      file: new Blob(["a"]),
      filename: "a.txt",
      purpose: "assistants",
      expiresAfterSeconds: 60,
    });

    const skillRecorded = recorder((input) => {
      assert(input.body instanceof FormData);
      assert.equal(input.headers.has("content-type"), false);
      assert.deepEqual([...input.body.keys()], ["files", "files"]);
      return json({
        id: "skill_1",
        name: "skill",
        description: "desc",
        default_version: "1",
        latest_version: "1",
        created_at: 1,
      });
    });
    await new SkillsClient(skillRecorded.transport).upload([
      { path: "SKILL.md", data: new Blob(["one"]) },
      { path: "references/a.md", data: new Blob(["two"]) },
    ]);
  });

  it("exposes only document search for collections", async () => {
    const recorded = recorder(() => json({ matches: [{ id: "doc_1" }] }));
    const client = new CollectionsSearchClient(recorded.transport);
    assert.deepEqual(
      await client.search({ query: "needle", source: { collection_ids: ["c1"] } }),
      { matches: [{ id: "doc_1" }] },
    );
    assert.equal(recorded.requests[0]?.pathWithQuery, "/documents/search");
    assert.deepEqual(
      Object.getOwnPropertyNames(CollectionsSearchClient.prototype).sort(),
      ["constructor", "search"],
    );
  });

  it("covers embeddings, models, tokenize, me, and encoded detail paths", async () => {
    const recorded = recorder((input) => {
      if (input.pathWithQuery === "/embeddings") {
        return json({ object: "list", model: "embed", data: [[]] });
      }
      if (input.pathWithQuery === "/tokenize-text") {
        return json({ token_ids: [1, 2] });
      }
      if (input.pathWithQuery === "/me") {
        return json({
          user_id: "u1",
          team_id: "t1",
          zdr_status: "disabled",
          team_blocked: false,
        });
      }
      if (/^\/(?:models|language-models|image-generation-models|video-generation-models)$/.test(input.pathWithQuery)) {
        return input.pathWithQuery === "/models"
          ? json({ data: [{ id: "m1" }] })
          : json({ models: [{ id: "m1" }] });
      }
      return json({ id: "m1" });
    });
    const embeddings = new EmbeddingsClient(recorded.transport);
    assert.equal(
      (await embeddings.create({ model: "embed", input: "hello" })).model,
      "embed",
    );
    await embeddings.getModel("../embed/?x");

    const models = new ModelsClient(recorded.transport);
    for (const family of [
      "models",
      "language-models",
      "image-generation-models",
      "video-generation-models",
    ] as const) {
      assert.equal((await models.list(family))[0]?.id, "m1");
    }
    await models.get("models", "../model/?x");

    const misc = new MiscClient(recorded.transport);
    assert.deepEqual(await misc.tokenize({ model: "m1", text: "hello" }), [1, 2]);
    assert.equal((await misc.me()).team_id, "t1");

    assert(
      recorded.requests.some(
        (request) =>
          request.pathWithQuery === "/embedding-models/..%2Fembed%2F%3Fx",
      ),
    );
    assert(
      recorded.requests.some(
        (request) => request.pathWithQuery === "/models/..%2Fmodel%2F%3Fx",
      ),
    );
  });

  it("encodes file and skill identifiers for every detail operation", async () => {
    const recorded = recorder((input) => {
      if (input.pathWithQuery.endsWith("/content")) {
        return new Response(new Uint8Array([1]), {
          headers: { "Content-Type": "application/octet-stream" },
        });
      }
      if (input.pathWithQuery.endsWith("/public-url")) {
        return json({ public_url: "https://assets.example/f" });
      }
      if (input.pathWithQuery.endsWith("/public-url/revoke")) {
        return json({ id: "file_1", revoked: true });
      }
      if (input.method === "DELETE") {
        return json({ id: "resource_1", deleted: true });
      }
      if (input.pathWithQuery.startsWith("/skills/")) {
        return json({
          id: "skill_1",
          name: "skill",
          description: "desc",
          default_version: "1",
          latest_version: "1",
          created_at: 1,
        });
      }
      return json({
        id: "file_1",
        filename: "a.txt",
        bytes: 1,
        created_at: 1,
      });
    });
    const attack = "../resource/?x";
    const files = new FilesClient(recorded.transport);
    await files.get(attack);
    await files.delete(attack);
    await files.download(attack);
    await files.createPublicUrl(attack);
    await files.revokePublicUrl(attack);
    const skills = new SkillsClient(recorded.transport);
    await skills.get(attack);
    await skills.delete(attack);
    await skills.downloadContent(attack);

    for (const request of recorded.requests) {
      assert.equal(request.pathWithQuery.includes("../resource/?x"), false);
      assert.match(request.pathWithQuery, /\.\.%2Fresource%2F%3Fx/);
    }
  });
});
