import assert from "node:assert";
import nodeFs from "node:fs";
import nodePath from "node:path";
import nodeUrl from "node:url";
import { afterEach, describe, it } from "mocha";
import ts from "typescript";
import { build } from "./builder.ts";
import { createTempProject, listFiles, removeTempProject } from "../test-util.ts";

// setting up a TypeScript program takes a moment
const timeout = 30_000;

describe("build", () => {
  let directories: string[] = [];

  const project = ({ files }: { files: Record<string, string> }) => {
    const directory = createTempProject({ files });
    directories = [...directories, directory];
    return directory;
  };

  afterEach(() => {
    directories.forEach((directory) => {
      removeTempProject({ directory });
    });
    directories = [];
  });

  const buildProject = async ({ files, entryPoints }: { files: Record<string, string>, entryPoints: string[] }) => {
    const rootDirectory = project({ files });
    const outputDirectory = nodePath.join(rootDirectory, "dist");

    const result = await build({ rootDirectory, outputDirectory, entryPoints });

    const read = ({ filePath }: { filePath: string }) => {
      return nodeFs.readFileSync(nodePath.join(outputDirectory, filePath), "utf-8");
    };

    return { rootDirectory, outputDirectory, result, read };
  };

  const lineLengths = ({ code }: { code: string }) => {
    return code.split("\n").map((line) => {
      return line.length;
    });
  };

  describe("output", () => {
    describe("typescript", () => {
      it("should build TypeScript files to JavaScript and declaration files", async () => {
        const source = [
          "#!/usr/bin/env node",
          "import { double } from \"./math.ts\";",
          "",
          "export const quadruple = (value: number): number => {",
          "  return double(double(value));",
          "};",
          ""
        ].join("\n");

        const { result, read } = await buildProject({
          files: {
            "lib/index.ts": source,
            "lib/math.ts": "export const double = (value: number) => {\n  return value * 2;\n};\n",
          },
          entryPoints: ["lib/index.ts"]
        });

        assert.deepStrictEqual(result.files, ["lib/index.d.ts", "lib/index.js", "lib/math.d.ts", "lib/math.js"]);
        assert.strictEqual(read({ filePath: "lib/index.js" }), [
          "#!/usr/bin/env node",
          "import { double } from \"./math.js\";",
          "",
          "export const quadruple = (value        )         => {",
          "  return double(double(value));",
          "};",
          ""
        ].join("\n"));
        assert.deepStrictEqual(lineLengths({ code: read({ filePath: "lib/index.js" }) }), lineLengths({ code: source }));
        assert.strictEqual(
          read({ filePath: "lib/index.d.ts" }),
          "#!/usr/bin/env node\nexport declare const quadruple: (value: number) => number;\n"
        );
        assert.strictEqual(read({ filePath: "lib/math.d.ts" }), "export declare const double: (value: number) => number;\n");
      });

      it("should produce JavaScript that runs in node", async () => {
        const { outputDirectory } = await buildProject({
          files: {
            "index.ts": [
              "import { describe } from \"./util/describe.ts\";",
              "import type { IPerson } from \"./types.ts\";",
              "import data from \"./data.json\" with { type: \"json\" };",
              "const person: IPerson = data;",
              "export const description = describe({ person });",
              "export const lazy = async () => {",
              "  const { describe: lazyDescribe } = await import(\"./util/describe.ts\");",
              "  return lazyDescribe({ person });",
              "};",
            ].join("\n"),
            "types.ts": "export interface IPerson { name: string; age: number }\n",
            "util/describe.ts": "import type { IPerson } from \"../types.ts\";\n"
              + "export const describe = ({ person }: { person: IPerson }): string => {\n"
              + "  return `${person.name} (${person.age})`;\n"
              + "};\n",
            "data.json": "{ \"name\": \"Ada\", \"age\": 36 }\n",
          },
          entryPoints: ["index.ts"]
        });

        const module = await import(nodeUrl.pathToFileURL(nodePath.join(outputDirectory, "index.js")).href);

        assert.strictEqual(module.description, "Ada (36)");
        assert.strictEqual(await module.lazy(), "Ada (36)");
      });

      it("should keep stack trace positions of the TypeScript source", async () => {
        const source = [
          "type TOptions = { message: string };",
          "export const fail = ({ message }: TOptions): never => {",
          "  throw Error(message);",
          "};",
        ].join("\n");

        const { outputDirectory } = await buildProject({ files: { "fail.ts": source }, entryPoints: ["fail.ts"] });

        const outputFile = nodePath.join(outputDirectory, "fail.js");
        const module = await import(nodeUrl.pathToFileURL(outputFile).href);

        assert.throws(() => {
          module.fail({ message: "boom" });
        }, (error: Error) => {
          assert.ok(error.stack?.includes(`${nodeUrl.pathToFileURL(outputFile).href}:3:9`), error.stack ?? "");
          return true;
        });
      });

      it("should generate declarations usable by consumers", async () => {
        const { rootDirectory } = await buildProject({
          files: {
            "lib/index.ts": "export { origin } from \"./point.ts\";\nexport type { IPoint } from \"./point.ts\";\n",
            "lib/point.ts": "export interface IPoint { x: number; y: number }\n"
              + "export const origin = (): IPoint => {\n  return { x: 0, y: 0 };\n};\n",
          },
          entryPoints: ["lib/index.ts"]
        });

        const consumerFile = nodePath.join(rootDirectory, "consumer.ts");
        nodeFs.writeFileSync(consumerFile, [
          "import { origin } from \"./dist/lib/index.js\";",
          "import type { IPoint } from \"./dist/lib/index.js\";",
          "const point: IPoint = origin();",
          "const x: number = point.x;",
          "// @ts-expect-error z does not exist",
          "const z = point.z;",
          "export { x, z };",
        ].join("\n"));

        const program = ts.createProgram({
          rootNames: [consumerFile],
          options: { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true }
        });

        assert.deepStrictEqual(ts.getPreEmitDiagnostics(program).map((diagnostic) => {
          return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
        }), []);
      });

      it("should rewrite TypeScript specifiers in declaration files", async () => {
        const { read } = await buildProject({
          files: {
            "a.ts": "import { b } from \"./b.ts\";\nexport const a = b;\nexport const lazy = () => {\n  return import(\"./b.ts\");\n};\n",
            "b.ts": "export interface IB { value: number }\nexport const b: IB = { value: 1 };\n",
          },
          entryPoints: ["a.ts"]
        });

        assert.strictEqual(read({ filePath: "a.d.ts" }), [
          "export declare const a: import(\"./b.js\").IB;",
          "export declare const lazy: () => Promise<{",
          "    default: typeof import(\"./b.js\");",
          "    b: import(\"./b.js\").IB;",
          "}>;",
          ""
        ].join("\n"));
      });

      it("should build files that are only imported for their types", async () => {
        const { result, read } = await buildProject({
          files: {
            "index.ts": "import type { TId } from \"./types.ts\";\nexport const id: TId = \"a\";\n",
            "types.ts": "export type TId = string;\n",
          },
          entryPoints: ["index.ts"]
        });

        assert.deepStrictEqual(result.files, ["index.d.ts", "index.js", "types.d.ts", "types.js"]);
        assert.strictEqual(read({ filePath: "index.d.ts" }), "import type { TId } from \"./types.js\";\nexport declare const id: TId;\n");
        assert.strictEqual(read({ filePath: "types.js" }), "                         \n");
      });

      it("should build .mts files to .mjs files", async () => {
        const { result, read } = await buildProject({
          files: {
            "index.mts": "import { a } from \"./a.mts\";\nexport const b: number = a;\n",
            "a.mts": "export const a = 1;\n",
          },
          entryPoints: ["index.mts"]
        });

        assert.deepStrictEqual(result.files, ["a.d.mts", "a.mjs", "index.d.mts", "index.mjs"]);
        assert.strictEqual(read({ filePath: "index.mjs" }), "import { a } from \"./a.mjs\";\nexport const b         = a;\n");
      });
    });

    describe("other file types", () => {
      it("should copy JavaScript files and rewrite their imports", async () => {
        const { result, read } = await buildProject({
          files: {
            "index.ts": "export { helper } from \"./helper.js\";\n",
            "helper.js": "import { value } from \"./value.ts\";\nexport const helper = () => {\n  return value;\n};\n",
            "value.ts": "export const value: number = 42;\n",
          },
          entryPoints: ["index.ts"]
        });

        assert.deepStrictEqual(result.files, ["helper.js", "index.d.ts", "index.js", "value.d.ts", "value.js"]);
        assert.strictEqual(
          read({ filePath: "helper.js" }),
          "import { value } from \"./value.js\";\nexport const helper = () => {\n  return value;\n};\n"
        );
      });

      it("should build JavaScript-only projects without declarations", async () => {
        const { result, read } = await buildProject({
          files: {
            "index.mjs": "import { a } from \"./a.js\";\nexport default a;\n",
            "a.js": "export const a = 1;\n",
          },
          entryPoints: ["index.mjs"]
        });

        assert.deepStrictEqual(result.files, ["a.js", "index.mjs"]);
        assert.strictEqual(read({ filePath: "index.mjs" }), "import { a } from \"./a.js\";\nexport default a;\n");
      });

      it("should copy hand-written declaration files", async () => {
        const { result, read } = await buildProject({
          files: {
            "index.ts": "import type { IConfig } from \"./config.d.ts\";\nexport const config: IConfig = { debug: false };\n",
            "config.d.ts": "import type { TLevel } from \"./level.ts\";\nexport interface IConfig { debug: boolean; level?: TLevel }\n",
            "level.ts": "export type TLevel = \"info\" | \"debug\";\n",
          },
          entryPoints: ["index.ts"]
        });

        assert.deepStrictEqual(result.files, ["config.d.ts", "index.d.ts", "index.js", "level.d.ts", "level.js"]);
        assert.strictEqual(
          read({ filePath: "config.d.ts" }),
          "import type { TLevel } from \"./level.js\";\nexport interface IConfig { debug: boolean; level?: TLevel }\n"
        );
        assert.strictEqual(
          read({ filePath: "index.d.ts" }),
          "import type { IConfig } from \"./config.d.ts\";\nexport declare const config: IConfig;\n"
        );
      });

      it("should copy JSON files unchanged", async () => {
        const json = "{\n  \"a\": \"./b.ts\"\n}\n";

        const { read } = await buildProject({
          files: {
            "index.js": "import data from \"./data.json\" with { type: \"json\" };\nexport { data };\n",
            "data.json": json,
          },
          entryPoints: ["index.js"]
        });

        assert.strictEqual(read({ filePath: "data.json" }), json);
      });
    });

    describe("module graph", () => {
      it("should leave package and builtin imports untouched", async () => {
        const code = [
          "import nodeFs from \"node:fs\";",
          "import ts from \"typescript\";",
          "import { a } from \"@scope/package/a.ts\";",
          "export const exists = nodeFs.existsSync;",
          "export { a, ts };",
          ""
        ].join("\n");

        const { read } = await buildProject({ files: { "index.js": code }, entryPoints: ["index.js"] });

        assert.strictEqual(read({ filePath: "index.js" }), code);
      });

      it("should build every file once, even with circular imports", async () => {
        const { result } = await buildProject({
          files: {
            "a.ts": "import { b } from \"./b.ts\";\nexport const a = () => {\n  return b;\n};\n",
            "b.ts": "import { a } from \"./a.ts\";\nexport const b = () => {\n  return a;\n};\n",
          },
          entryPoints: ["a.ts", "b.ts", "./a.ts"]
        });

        assert.deepStrictEqual(result.files, ["a.d.ts", "a.js", "b.d.ts", "b.js"]);
      });

      it("should support imports across directories", async () => {
        const { result, read } = await buildProject({
          files: {
            "bin/cli.ts": "import { run } from \"../lib/run.ts\";\nrun();\n",
            "lib/run.ts": "import { log } from \"./util/log.ts\";\nexport const run = () => {\n  log();\n};\n",
            "lib/util/log.ts": "export const log = () => {\n  return \"log\";\n};\n",
          },
          entryPoints: ["bin/cli.ts"]
        });

        assert.deepStrictEqual(result.files, [
          "bin/cli.d.ts",
          "bin/cli.js",
          "lib/run.d.ts",
          "lib/run.js",
          "lib/util/log.d.ts",
          "lib/util/log.js"
        ]);
        assert.strictEqual(read({ filePath: "bin/cli.js" }), "import { run } from \"../lib/run.js\";\nrun();\n");
      });
    });

    describe("options", () => {
      it("should accept absolute entry points inside of the root directory", async () => {
        const rootDirectory = project({ files: { "src/index.ts": "export const a = 1;\n" } });
        const outputDirectory = nodePath.join(rootDirectory, "dist");

        const result = await build({ rootDirectory, outputDirectory, entryPoints: [nodePath.join(rootDirectory, "src/index.ts")] });

        assert.deepStrictEqual(result.files, ["src/index.d.ts", "src/index.js"]);
      });

      it("should support output directories outside of the root directory", async () => {
        const rootDirectory = project({ files: { "index.ts": "export const a = 1;\n" } });
        const outputDirectory = project({ files: {} });

        await build({ rootDirectory, outputDirectory, entryPoints: ["index.ts"] });

        assert.deepStrictEqual(listFiles({ directory: outputDirectory }), ["index.d.ts", "index.js"]);
        assert.deepStrictEqual(listFiles({ directory: rootDirectory }), ["index.ts"]);
      });

      it("should honor the given tsconfig", async () => {
        const rootDirectory = project({
          files: {
            "tsconfig.json": JSON.stringify({ compilerOptions: { module: "NodeNext", strict: true } }),
            "tsconfig.loose.json": JSON.stringify({ compilerOptions: { module: "NodeNext", strict: false } }),
            "index.ts": "export const f = (a?: string) => {\n  return a;\n};\n",
          }
        });
        const outputDirectory = nodePath.join(rootDirectory, "dist");

        await build({ rootDirectory, outputDirectory, entryPoints: ["index.ts"], tsconfigPath: "tsconfig.loose.json" });

        assert.strictEqual(
          nodeFs.readFileSync(nodePath.join(outputDirectory, "index.d.ts"), "utf-8"),
          "export declare const f: (a?: string) => string;\n"
        );
      });
    });
  });

  describe("errors", () => {
    const assertBuildFails = async ({
      files,
      entryPoints,
      error
    }: {
      files: Record<string, string>,
      entryPoints: string[],
      error: RegExp | { message: string }
    }) => {
      const rootDirectory = project({ files });
      const outputDirectory = nodePath.join(rootDirectory, "dist");

      await assert.rejects(build({ rootDirectory, outputDirectory, entryPoints }), error);

      assert.strictEqual(nodeFs.existsSync(outputDirectory), false, "no output must be written");
    };

    it("should reject entry points outside of the root directory", async () => {
      await assertBuildFails({
        files: { "a.ts": "" },
        entryPoints: ["../a.ts"],
        error: { message: "entry point \"../a.ts\" is outside of the root directory" }
      });
    });

    it("should reject imports outside of the root directory", async () => {
      await assertBuildFails({
        files: { "src/a.ts": "import \"../../b.ts\";\n" },
        entryPoints: ["src/a.ts"],
        error: { message: "\"src/a.ts\" imports \"../../b.ts\", which is outside of the root directory" }
      });
    });

    it("should report missing entry points", async () => {
      await assertBuildFails({
        files: {},
        entryPoints: ["missing.ts"],
        error: (/^Error: failed to read ".*missing\.ts"$/)
      });
    });

    it("should report missing imports with the importing file", async () => {
      await assertBuildFails({
        files: { "a.ts": "import { b } from \"./b.ts\";\nexport { b };\n" },
        entryPoints: ["a.ts"],
        error: (/^Error: failed to read ".*b\.ts" imported by "a\.ts"$/)
      });
    });

    it("should reject unsupported file types", async () => {
      await assertBuildFails({
        files: { "a.ts": "import \"./style.css\";\n", "style.css": "" },
        entryPoints: ["a.ts"],
        error: {
          message: "unsupported file type of \"style.css\" imported by \"a.ts\", "
            + "supported extensions are .d.ts, .d.mts, .ts, .mts, .js, .mjs, .json"
        }
      });
    });

    it("should reject imports without file extension", async () => {
      await assertBuildFails({
        files: { "a.ts": "import \"./b\";\n", "b.ts": "" },
        entryPoints: ["a.ts"],
        error: /^Error: unsupported file type of "b" imported by "a\.ts"/
      });
    });

    it("should reject unsupported entry points", async () => {
      await assertBuildFails({
        files: { "a.tsx": "" },
        entryPoints: ["a.tsx"],
        error: /^Error: unsupported file type of "a\.tsx", supported extensions are/
      });
    });

    it("should reject builds where files would overwrite each other", async () => {
      await assertBuildFails({
        files: { "a.ts": "import \"./b.ts\";\nimport \"./b.js\";\n", "b.ts": "", "b.js": "" },
        entryPoints: ["a.ts"],
        error: { message: "multiple source files would be written to the same output file: b.js" }
      });
    });

    it("should reject the root directory as output directory", async () => {
      const rootDirectory = project({ files: { "a.ts": "" } });

      await assert.rejects(build({ rootDirectory, outputDirectory: `${rootDirectory}/.`, entryPoints: ["a.ts"] }), {
        message: "output directory must not be the root directory, as source files would be overwritten"
      });
    });

    it("should report unsupported TypeScript syntax", async () => {
      await assertBuildFails({
        files: { "a.ts": "import \"./b.ts\";\n", "b.ts": "export enum E { A }\n" },
        entryPoints: ["a.ts"],
        error: /^Error: unsupported TypeScript syntax in "b\.ts"/
      });
    });

    it("should report declaration errors", async () => {
      await assertBuildFails({
        files: { "a.ts": "export const A = class {\n  private x = 1;\n};\n" },
        entryPoints: ["a.ts"],
        error: /^Error: failed to generate declarations:\n.*a\.ts:1:14: Property 'x' of exported anonymous class type/
      });
    });
  });
}).timeout(timeout);
