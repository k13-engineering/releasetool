import assert from "node:assert";
import nodeFs from "node:fs";
import nodeOs from "node:os";
import nodePath from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import { runCli } from "./cli.ts";
import { listFiles } from "./test-util.ts";

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
      assert.match(result.stdout, /releasetool build/);
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

  describe("build", () => {
    const writeSource = ({ name, content }: { name: string, content: string }) => {
      const filePath = nodePath.join(tempDir, name);
      nodeFs.mkdirSync(nodePath.dirname(filePath), { recursive: true });
      nodeFs.writeFileSync(filePath, content);
      return filePath;
    };

    it("should build the given entry points", async () => {
      const index = writeSource({ name: "src/lib/index.ts", content: "import { a } from \"./a.ts\";\nexport const b: string = a;\n" });
      writeSource({ name: "src/lib/a.ts", content: "export const a = \"a\";\n" });
      const cliTs = writeSource({ name: "src/bin/cli.ts", content: "import { b } from \"../lib/index.ts\";\nconsole.log(b);\n" });
      const out = nodePath.join(tempDir, "dist");

      const result = await run({
        args: ["build", "--root", nodePath.join(tempDir, "src"), "--out", out, "--entry", index, "--entry", cliTs]
      });

      assert.deepStrictEqual(result, { exitCode: 0, stdout: `built 6 files into "${out}"`, stderr: "" });
      assert.deepStrictEqual(listFiles({ directory: out }), [
        "bin/cli.d.ts",
        "bin/cli.js",
        "lib/a.d.ts",
        "lib/a.js",
        "lib/index.d.ts",
        "lib/index.js"
      ]);
      assert.strictEqual(
        nodeFs.readFileSync(nodePath.join(out, "lib/index.js"), "utf-8"),
        "import { a } from \"./a.js\";\nexport const b         = a;\n"
      );
    }).timeout(30_000);

    it("should resolve paths relative to the working directory", async () => {
      writeSource({ name: "index.js", content: "export const a = 1;\n" });
      const previousWorkingDirectory = process.cwd();
      process.chdir(tempDir);

      try {
        const result = await run({ args: ["build", "--out", "dist", "--entry", "./index.js"] });

        assert.deepStrictEqual(result, { exitCode: 0, stdout: "built 1 file into \"dist\"", stderr: "" });
        assert.deepStrictEqual(listFiles({ directory: nodePath.join(tempDir, "dist") }), ["index.js"]);
      } finally {
        process.chdir(previousWorkingDirectory);
      }
    });

    it("should use the given tsconfig", async () => {
      const index = writeSource({ name: "index.ts", content: "export const f = (a?: string) => {\n  return a;\n};\n" });
      const tsconfig = writeSource({
        name: "config/tsconfig.json",
        content: JSON.stringify({ compilerOptions: { module: "NodeNext", strict: false } })
      });
      const out = nodePath.join(tempDir, "dist");

      const result = await run({ args: ["build", "--root", tempDir, "--out", out, "--entry", index, "--tsconfig", tsconfig] });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(
        nodeFs.readFileSync(nodePath.join(out, "index.d.ts"), "utf-8"),
        "export declare const f: (a?: string) => string;\n"
      );
    }).timeout(30_000);

    it("should fail on missing arguments", async () => {
      const result = await run({ args: ["build"] });

      assert.strictEqual(result.exitCode, 1);
      assert.match(result.stderr, /Missing required arguments: out, entry/);
    });

    ["root", "out", "tsconfig"].forEach((option) => {
      it(`should reject repeated --${option} options`, async () => {
        const result = await run({ args: ["build", "--out", "dist", "--entry", "a.ts", `--${option}`, "a", `--${option}`, "b"] });

        assert.deepStrictEqual(result, { exitCode: 1, stdout: "", stderr: `error: option --${option} must only be given once` });
      });
    });

    it("should report build errors", async () => {
      const index = writeSource({ name: "index.ts", content: "import \"./missing.ts\";\n" });

      const result = await run({ args: ["build", "--root", tempDir, "--out", nodePath.join(tempDir, "dist"), "--entry", index] });

      assert.strictEqual(result.exitCode, 1);
      assert.match(result.stderr, /^error: failed to read ".*missing\.ts" imported by "index\.ts"\n {2}caused by: ENOENT/);
      assert.strictEqual(nodeFs.existsSync(nodePath.join(tempDir, "dist")), false);
    });
  });
});
