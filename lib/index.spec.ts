import assert from "node:assert";
import { describe, it } from "mocha";
import { mergePackageJson } from "./index.ts";

describe("mergePackageJson", () => {
  it("should merge fields of both package.json files", () => {
    const merged = mergePackageJson({
      localPackageJson: { type: "module", scripts: { test: "mocha" } },
      npmPackageJson: { name: "my-package", license: "MIT" }
    });

    assert.deepStrictEqual(merged, {
      name: "my-package",
      type: "module",
      version: undefined,
      description: undefined,
      files: undefined,
      main: undefined,
      scripts: { test: "mocha" },
      license: "MIT"
    });
  });

  it("should prefer fields of the npm package.json", () => {
    const merged = mergePackageJson({
      localPackageJson: { main: "lib/index.ts", scripts: { test: "mocha" } },
      npmPackageJson: { main: "dist/lib/index.js", scripts: {} }
    });

    assert.strictEqual(merged.main, "dist/lib/index.js");
    assert.deepStrictEqual(merged.scripts, {});
  });

  it("should put well-known fields first", () => {
    const merged = mergePackageJson({
      localPackageJson: { dependencies: {}, main: "lib/index.ts", type: "module" },
      npmPackageJson: { license: "MIT", files: ["dist"], name: "my-package", description: "desc", version: "1.0.0" }
    });

    assert.deepStrictEqual(Object.keys(merged), [
      "name",
      "type",
      "version",
      "description",
      "files",
      "main",
      "dependencies",
      "license"
    ]);
  });
});
