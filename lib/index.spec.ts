import assert from "node:assert";
import { describe, it } from "mocha";
import * as releasetool from "./index.ts";

describe("index", () => {
  it("should export the public interface", () => {
    assert.deepStrictEqual(Object.keys(releasetool).toSorted(), [
      "mergePackageJson",
      "patchPackageJsonVersion",
      "runCli"
    ]);
  });
});
