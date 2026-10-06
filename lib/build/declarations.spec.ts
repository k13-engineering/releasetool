import assert from "node:assert";
import nodeFs from "node:fs";
import nodePath from "node:path";
import { afterEach, describe, it } from "mocha";
import { generateDeclarations } from "./declarations.ts";
import { createTempProject, listFiles, removeTempProject } from "../test-util.ts";

// setting up a TypeScript program takes a moment
const timeout = 30_000;

describe("generateDeclarations", () => {
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

  const declarationsOf = ({ rootDirectory, filePaths, tsconfigPath }: {
    rootDirectory: string,
    filePaths: string[],
    tsconfigPath?: string
  }) => {
    return Object.fromEntries(generateDeclarations({ rootDirectory, filePaths, tsconfigPath }).map((declaration) => {
      return [declaration.declarationFilePath, declaration.content];
    }));
  };

  describe("generation", () => {
    it("should generate a declaration file with inferred types", () => {
      const rootDirectory = project({
        files: {
          "index.ts": "export const add = ({ a, b }: { a: number, b: number }) => {\n  return a + b;\n};\n"
        }
      });

      const declarations = generateDeclarations({ rootDirectory, filePaths: ["index.ts"] });

      assert.deepStrictEqual(declarations, [{
        sourceFilePath: "index.ts",
        declarationFilePath: "index.d.ts",
        content: "export declare const add: ({ a, b }: {\n    a: number;\n    b: number;\n}) => number;\n"
      }]);
    });

    it("should resolve types inferred from other modules", () => {
      const rootDirectory = project({
        files: {
          "lib/point.ts": "export interface IPoint { x: number; y: number }\n"
            + "export const origin = (): IPoint => {\n  return { x: 0, y: 0 };\n};\n",
          "lib/index.ts": "import { origin } from \"./point.ts\";\nexport const start = origin();\n",
        }
      });

      const declarations = declarationsOf({ rootDirectory, filePaths: ["lib/index.ts", "lib/point.ts"] });

      assert.deepStrictEqual(Object.keys(declarations), ["lib/index.d.ts", "lib/point.d.ts"]);
      assert.strictEqual(declarations["lib/index.d.ts"], "export declare const start: import(\"./point.ts\").IPoint;\n");
      assert.match(declarations["lib/point.d.ts"], /export interface IPoint {/);
    });

    it("should keep type-only imports and re-exports", () => {
      const rootDirectory = project({
        files: {
          "types.ts": "export type TName = string;\n",
          "index.ts": "import type { TName } from \"./types.ts\";\nexport type { TName } from \"./types.ts\";\n"
            + "export const greet = (name: TName) => {\n  return `hello ${name}`;\n};\n",
        }
      });

      const declarations = declarationsOf({ rootDirectory, filePaths: ["index.ts", "types.ts"] });

      assert.strictEqual(declarations["index.d.ts"], [
        "import type { TName } from \"./types.ts\";",
        "export type { TName } from \"./types.ts\";",
        "export declare const greet: (name: TName) => string;",
        ""
      ].join("\n"));
      assert.strictEqual(declarations["types.d.ts"], "export type TName = string;\n");
    });

    it("should name declaration files of .mts files .d.mts", () => {
      const rootDirectory = project({ files: { "dir/module.mts": "export const a = 1;\n" } });

      assert.deepStrictEqual(declarationsOf({ rootDirectory, filePaths: ["dir/module.mts"] }), {
        "dir/module.d.mts": "export declare const a = 1;\n"
      });
    });

    it("should only generate declarations for the given files", () => {
      const rootDirectory = project({
        files: {
          "a.ts": "import { b } from \"./b.ts\";\nexport const a = b;\n",
          "b.ts": "export const b = \"b\";\n",
        }
      });

      assert.deepStrictEqual(Object.keys(declarationsOf({ rootDirectory, filePaths: ["a.ts"] })), ["a.d.ts"]);
    });

    it("should not write any files", () => {
      const rootDirectory = project({ files: { "a.ts": "export const a = 1;\n" } });

      generateDeclarations({ rootDirectory, filePaths: ["a.ts"] });

      assert.deepStrictEqual(listFiles({ directory: rootDirectory }), ["a.ts"]);
    });

    it("should accept a relative root directory", () => {
      const rootDirectory = project({ files: { "a.ts": "export const a = 1;\n" } });
      const relativeRootDirectory = nodePath.relative(process.cwd(), rootDirectory);

      assert.deepStrictEqual(declarationsOf({ rootDirectory: relativeRootDirectory, filePaths: ["a.ts"] }), {
        "a.d.ts": "export declare const a = 1;\n"
      });
    });

    it("should accept file paths that are not normalized", () => {
      const rootDirectory = project({ files: { "dir/a.ts": "export const a = 1;\n" } });

      const declarations = generateDeclarations({ rootDirectory, filePaths: ["./dir/../dir/a.ts"] });

      assert.deepStrictEqual(declarations, [{
        sourceFilePath: "dir/a.ts",
        declarationFilePath: "dir/a.d.ts",
        content: "export declare const a = 1;\n"
      }]);
    });

    it("should not fail on type errors", () => {
      const rootDirectory = project({ files: { "a.ts": "export const a: number = \"text\";\n" } });

      assert.deepStrictEqual(declarationsOf({ rootDirectory, filePaths: ["a.ts"] }), {
        "a.d.ts": "export declare const a: number;\n"
      });
    });
  });

  describe("compiler options", () => {
    const optionalParameter = "export const f = (a?: string) => {\n  return a;\n};\n";

    it("should use strict mode by default", () => {
      const rootDirectory = project({ files: { "a.ts": optionalParameter } });

      assert.deepStrictEqual(declarationsOf({ rootDirectory, filePaths: ["a.ts"] }), {
        "a.d.ts": "export declare const f: (a?: string) => string | undefined;\n"
      });
    });

    it("should honor tsconfig.json in the root directory", () => {
      const rootDirectory = project({
        files: {
          "tsconfig.json": JSON.stringify({ compilerOptions: { module: "NodeNext", strict: false } }),
          "a.ts": optionalParameter,
        }
      });

      assert.deepStrictEqual(declarationsOf({ rootDirectory, filePaths: ["a.ts"] }), {
        "a.d.ts": "export declare const f: (a?: string) => string;\n"
      });
    });

    it("should honor an explicitly given tsconfig relative to the root directory", () => {
      const rootDirectory = project({
        files: {
          "tsconfig.json": JSON.stringify({ compilerOptions: { module: "NodeNext", strict: true } }),
          "config/tsconfig.build.json": JSON.stringify({ compilerOptions: { module: "NodeNext", strict: false } }),
          "a.ts": optionalParameter,
        }
      });

      assert.deepStrictEqual(declarationsOf({ rootDirectory, filePaths: ["a.ts"], tsconfigPath: "config/tsconfig.build.json" }), {
        "a.d.ts": "export declare const f: (a?: string) => string;\n"
      });
    });

    it("should ignore options that conflict with generating declarations", () => {
      const rootDirectory = project({
        files: {
          "tsconfig.json": JSON.stringify({
            compilerOptions: {
              module: "NodeNext",
              noEmit: true,
              composite: true,
              incremental: true,
              outDir: "build",
              declarationDir: "types",
              declarationMap: true,
              sourceMap: true,
            },
            include: ["nothing/*.ts"],
          }),
          "a.ts": "export const a = 1;\n",
        }
      });

      assert.deepStrictEqual(declarationsOf({ rootDirectory, filePaths: ["a.ts"] }), {
        "a.d.ts": "export declare const a = 1;\n"
      });
      assert.deepStrictEqual(listFiles({ directory: rootDirectory }), ["a.ts", "tsconfig.json"]);
    });

    it("should support tsconfig files extending others", () => {
      const rootDirectory = project({
        files: {
          "tsconfig.base.json": JSON.stringify({ compilerOptions: { module: "NodeNext", strict: false } }),
          "tsconfig.json": JSON.stringify({ extends: "./tsconfig.base.json" }),
          "a.ts": optionalParameter,
        }
      });

      assert.deepStrictEqual(declarationsOf({ rootDirectory, filePaths: ["a.ts"] }), {
        "a.d.ts": "export declare const f: (a?: string) => string;\n"
      });
    });
  });

  describe("errors", () => {
    it("should fail if an explicitly given tsconfig does not exist", () => {
      const rootDirectory = project({ files: { "a.ts": "export const a = 1;\n" } });

      assert.throws(() => {
        generateDeclarations({ rootDirectory, filePaths: ["a.ts"], tsconfigPath: "missing.json" });
      }, (error: Error) => {
        assert.match(error.message, /^failed to read ".*missing\.json":\n.*missing\.json/);
        return true;
      });
    });

    it("should fail on tsconfig files with invalid JSON", () => {
      const rootDirectory = project({ files: { "tsconfig.json": "{ \"compilerOptions\": ", "a.ts": "" } });

      assert.throws(() => {
        generateDeclarations({ rootDirectory, filePaths: ["a.ts"] });
      }, /^Error: failed to read ".*tsconfig\.json":\n.*tsconfig\.json:1:/);
    });

    it("should fail on invalid compiler options", () => {
      const rootDirectory = project({
        files: { "tsconfig.json": JSON.stringify({ compilerOptions: { unknownOption: true } }), "a.ts": "" }
      });

      assert.throws(() => {
        generateDeclarations({ rootDirectory, filePaths: ["a.ts"] });
      }, /^Error: invalid TypeScript configuration ".*tsconfig\.json":\n.*Unknown compiler option 'unknownOption'/);
    });

    it("should fail on conflicting compiler options", () => {
      const rootDirectory = project({
        files: {
          "tsconfig.json": JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "NodeNext" } }),
          "a.ts": ""
        }
      });

      assert.throws(() => {
        generateDeclarations({ rootDirectory, filePaths: ["a.ts"] });
      }, /^Error: failed to create TypeScript program:\n.*'module' must be set to 'NodeNext'/);
    });

    it("should fail if declarations cannot be generated", () => {
      const rootDirectory = project({ files: { "a.ts": "export const A = class {\n  private x = 1;\n};\n" } });

      assert.throws(() => {
        generateDeclarations({ rootDirectory, filePaths: ["a.ts"] });
      }, (error: Error) => {
        assert.strictEqual(error.message, [
          "failed to generate declarations:",
          `${nodePath.join(nodeFs.realpathSync(rootDirectory), "a.ts")}:1:14: `
            + "Property 'x' of exported anonymous class type may not be private or protected."
        ].join("\n"));
        return true;
      });
    });

    it("should fail on files that do not exist", () => {
      const rootDirectory = project({ files: {} });

      assert.throws(() => {
        generateDeclarations({ rootDirectory, filePaths: ["missing.ts"] });
      }, /^Error: failed to create TypeScript program:\nFile '.*missing\.ts' not found\./);
    });

    it("should fail on files that do not produce declarations", () => {
      const rootDirectory = project({ files: { "types.d.ts": "export type A = string;\n" } });

      assert.throws(() => {
        generateDeclarations({ rootDirectory, filePaths: ["types.d.ts"] });
      }, {
        message: "no declarations generated for \"types.d.ts\""
      });
    });
  });
}).timeout(timeout);
