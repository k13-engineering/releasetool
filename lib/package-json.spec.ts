import assert from "node:assert";
import { describe, it } from "mocha";
import { mergePackageJson, patchPackageJsonVersion } from "./package-json.ts";

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

describe("patchPackageJsonVersion", () => {
  it("should set the version without the v prefix", () => {
    const patched = patchPackageJsonVersion({
      packageJson: { name: "my-package" },
      versionTag: "v1.2.3"
    });

    assert.deepStrictEqual(patched, { version: "1.2.3", name: "my-package" });
  });

  it("should replace an existing version and put it first", () => {
    const patched = patchPackageJsonVersion({
      packageJson: { name: "my-package", version: "0.0.1" },
      versionTag: "v0.0.2"
    });

    assert.deepStrictEqual(Object.entries(patched), [
      ["version", "0.0.2"],
      ["name", "my-package"]
    ]);
  });

  it("should not modify the given package.json", () => {
    const packageJson = { name: "my-package", version: "0.0.1" };

    patchPackageJsonVersion({ packageJson, versionTag: "v0.0.2" });

    assert.deepStrictEqual(packageJson, { name: "my-package", version: "0.0.1" });
  });

  it("should reject version tags without v prefix", () => {
    assert.throws(() => {
      patchPackageJsonVersion({ packageJson: {}, versionTag: "1.2.3" });
    }, {
      message: `version string must start with 'v', got "1.2.3"`
    });
  });
});
