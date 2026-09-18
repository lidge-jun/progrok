import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AdapterError, toSafeErrorDetail } from "../src/core/errors.js";

describe("core adapter errors", () => {
  it("preserves only the public fields of typed adapter errors", () => {
    const secret = new Error("private cause");
    const detail = toSafeErrorDetail(
      new AdapterError("invalid_wire_shape", "safe message", {
        status: 502,
        diagnostic: { field: "choices", valueType: "number" },
        cause: secret,
      }),
      { code: "upstream_error", message: "fallback" },
    );

    assert.deepEqual(detail, {
      code: "invalid_wire_shape",
      message: "safe message",
      status: 502,
      retryable: false,
      diagnostic: { field: "choices", valueType: "number" },
    });
    assert.equal("cause" in detail, false);
    assert.equal("stack" in detail, false);
  });

  it("redacts every untyped error behind the caller fallback", () => {
    const fallback = { code: "upstream_error" as const, message: "safe fallback" };
    for (const value of [new Error("secret"), "secret", { token: "secret" }, null]) {
      const detail = toSafeErrorDetail(value, fallback);
      assert.equal(detail.code, "upstream_error");
      assert.equal(detail.message, "safe fallback");
      assert.equal(detail.retryable, false);
      assert.equal(JSON.stringify(detail).includes("secret"), false);
    }
  });

  it("caps typed public messages at 512 characters", () => {
    const detail = toSafeErrorDetail(
      new AdapterError("stream_truncated", "x".repeat(600)),
      { code: "upstream_error", message: "fallback" },
    );
    assert.equal(detail.message, "x".repeat(512));
    assert.equal(detail.retryable, false);
  });
});
