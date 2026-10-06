import assert from "node:assert";
import { describe, it } from "mocha";
import { formatError } from "./format-error.ts";

describe("formatError", () => {
  it("should format an error by its message", () => {
    assert.strictEqual(formatError({ error: Error("failed") }), "failed");
  });

  it("should include the chain of causes", () => {
    const error = Error("outer", { cause: Error("middle", { cause: Error("inner") }) });

    assert.strictEqual(formatError({ error }), [
      "outer",
      "  caused by: middle",
      "  caused by: inner"
    ].join("\n"));
  });

  it("should format non-error values", () => {
    assert.strictEqual(formatError({ error: "a string" }), "a string");
    assert.strictEqual(formatError({ error: Error("outer", { cause: 42 }) }), "outer\n  caused by: 42");
  });
});
