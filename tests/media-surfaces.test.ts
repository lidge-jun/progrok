import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  XaiFetchInput,
  XaiTransport,
} from "../src/transport/fetch.js";
import { ImagesClient } from "../src/surfaces/images.js";
import { VideosClient } from "../src/surfaces/videos.js";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

function mediaTransport(
  reply: (input: XaiFetchInput) => Response,
): { transport: XaiTransport; requests: XaiFetchInput[] } {
  const requests: XaiFetchInput[] = [];
  return {
    requests,
    transport: {
      fetch(input) {
        requests.push(input);
        return Promise.resolve(reply(input));
      },
    },
  };
}

describe("image and video surfaces", () => {
  it("routes image generations and edits by reference presence", async () => {
    const recorded = mediaTransport(() => json({ data: [{ url: "x" }] }));
    const client = new ImagesClient(recorded.transport);
    await client.create({ model: "image", prompt: "new" });
    await client.create({ model: "image", prompt: "edit", image: "ref" });
    await client.create({ model: "image", prompt: "edit-many", images: [] });
    assert.deepEqual(
      recorded.requests.map((request) => request.pathWithQuery),
      ["/images/generations", "/images/edits", "/images/edits"],
    );
    assert(recorded.requests.every((request) => request.method === "POST"));
  });

  it("submits every video operation as a non-keyed POST", async () => {
    const recorded = mediaTransport(() => json({ request_id: "video_1" }));
    const client = new VideosClient(recorded.transport);
    for (const operation of ["generations", "edits", "extensions"] as const) {
      assert.equal((await client.start(operation, { prompt: operation })).requestId, "video_1");
    }
    assert.deepEqual(
      recorded.requests.map((request) => request.pathWithQuery),
      ["/videos/generations", "/videos/edits", "/videos/extensions"],
    );
    for (const request of recorded.requests) {
      assert.equal(request.method, "POST");
      assert.equal(request.headers.has("idempotency-key"), false);
    }
  });

  it("rejects video starts without request_id", async () => {
    const client = new VideosClient(mediaTransport(() => json({})).transport);
    await assert.rejects(client.start("generations", {}), /request_id/);
  });

  it("normalizes nonterminal states and preserves terminal states", async () => {
    const statuses = [
      ["queued", "pending"],
      ["processing", "pending"],
      ["unknown", "pending"],
      ["done", "done"],
      ["failed", "failed"],
      ["expired", "expired"],
    ] as const;
    for (const [wire, expected] of statuses) {
      const client = new VideosClient(
        mediaTransport(() =>
          json({
            status: wire,
            progress: 0.5,
            ...(wire === "done"
              ? { video: { url: "https://assets.example/video.mp4", duration: 4 } }
              : {}),
          }),
        ).transport,
      );
      const result = await client.poll("../job/?x");
      assert.equal(result.status, expected);
      if (wire === "done") {
        assert.equal(result.video?.duration, 4);
      }
    }
  });
});
