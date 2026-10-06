import assert from "node:assert";
import nodeFs from "node:fs";
import nodeOs from "node:os";
import nodePath from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import { runCli } from "./cli.ts";

const run = async ({ args }: { args: string[] }) => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const { exitCode } = await runCli({
    args,
    stdout: (text) => {
      // eslint-disable-next-line fp/no-mutating-methods
      stdout.push(text);
    },
    stderr: (text) => {
      // eslint-disable-next-line fp/no-mutating-methods
      stderr.push(text);
    }
  });

  return {
    exitCode,
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n")
  };
};

describe("cli", () => {
  let tempDir = "";

  const writeJson = ({ name, content }: { name: string, content: unknown }) => {
    const filePath = nodePath.join(tempDir, name);
    nodeFs.writeFileSync(filePath, JSON.stringify(content));
    return filePath;
  };

  const readRaw = ({ filePath }: { filePath: string }) => {
    return nodeFs.readFileSync(filePath, "utf-8");
  };

  beforeEach(() => {
    tempDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "releasetool-cli-"));
  });

  afterEach(() => {
    nodeFs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("general", () => {
    it("should fail without a command", async () => {
      const result = await run({ args: [] });

      assert.strictEqual(result.exitCode, 1);
      assert.strictEqual(result.stderr, "error: You must specify a command");
    });

    it("should fail on unknown commands", async () => {
      const result = await run({ args: ["unknown"] });

      assert.strictEqual(result.exitCode, 1);
      assert.match(result.stderr, /Unknown argument: unknown/);
    });

    it("should print help", async () => {
      const result = await run({ args: ["--help"] });

      assert.strictEqual(result.exitCode, 0);
      assert.match(result.stdout, /releasetool merge/);
      assert.match(result.stdout, /releasetool patch-version/);
      assert.strictEqual(result.stderr, "");
    });

    it("should print nothing on success", async () => {
      const packageJson = writeJson({ name: "package.json", content: {} });

      const result = await run({ args: ["patch-version", "--package-json", packageJson, "--package-version", "v1.0.0"] });

      assert.deepStrictEqual(result, { exitCode: 0, stdout: "", stderr: "" });
    });
  });

  describe("merge", () => {
    it("should merge package.json files", async () => {
      const local = writeJson({ name: "package.json", content: { type: "module", main: "lib/index.ts" } });
      const npm = writeJson({ name: "package.npm.json", content: { name: "my-package", main: "dist/lib/index.js" } });
      const output = nodePath.join(tempDir, "merged.json");

      const result = await run({ args: ["merge", "--local-package-json", local, "--npm-package-json", npm, "--output", output] });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(readRaw({ filePath: output }), `${JSON.stringify({
        name: "my-package",
        type: "module",
        main: "dist/lib/index.js"
      }, null, 2)}\n`);
    });

    it("should fail on missing arguments", async () => {
      const result = await run({ args: ["merge", "--local-package-json", "a.json"] });

      assert.strictEqual(result.exitCode, 1);
      assert.match(result.stderr, /Missing required arguments: npm-package-json, output/);
    });

    it("should report unreadable input files", async () => {
      const missing = nodePath.join(tempDir, "missing.json");
      const output = nodePath.join(tempDir, "merged.json");

      const result = await run({ args: ["merge", "--local-package-json", missing, "--npm-package-json", missing, "--output", output] });

      assert.strictEqual(result.exitCode, 1);
      assert.match(result.stderr, /^error: ENOENT/);
      assert.strictEqual(nodeFs.existsSync(output), false);
    });

    it("should report invalid JSON", async () => {
      const invalid = nodePath.join(tempDir, "invalid.json");
      nodeFs.writeFileSync(invalid, "{");
      const output = nodePath.join(tempDir, "merged.json");

      const result = await run({ args: ["merge", "--local-package-json", invalid, "--npm-package-json", invalid, "--output", output] });

      assert.strictEqual(result.exitCode, 1);
      assert.match(result.stderr, /JSON/);
    });
  });

  describe("patch-version", () => {
    it("should patch the version in place", async () => {
      const packageJson = writeJson({ name: "package.json", content: { name: "my-package", version: "0.0.0" } });

      const result = await run({ args: ["patch-version", "--package-json", packageJson, "--package-version", "v1.2.3"] });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(readRaw({ filePath: packageJson }), `${JSON.stringify({
        version: "1.2.3",
        name: "my-package"
      }, null, 2)}\n`);
    });

    it("should reject versions without v prefix", async () => {
      const packageJson = writeJson({ name: "package.json", content: { name: "my-package" } });

      const result = await run({ args: ["patch-version", "--package-json", packageJson, "--package-version", "1.2.3"] });

      assert.strictEqual(result.exitCode, 1);
      assert.strictEqual(result.stderr, `error: version string must start with 'v', got "1.2.3"`);
      assert.strictEqual(readRaw({ filePath: packageJson }), JSON.stringify({ name: "my-package" }));
    });
  });
});
