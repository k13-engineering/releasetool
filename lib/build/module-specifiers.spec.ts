import assert from "node:assert";
import { describe, it } from "mocha";
import {
  findModuleSpecifiers,
  isDeclarationFile,
  isRelativeSpecifier,
  rewriteModuleSpecifiers,
  rewriteSpecifier
} from "./module-specifiers.ts";

const specifiersOf = ({ code, fileName = "file.ts" }: { code: string, fileName?: string }) => {
  return findModuleSpecifiers({ code, fileName }).map(({ specifier }) => {
    return specifier;
  });
};

describe("module specifiers", () => {
  describe("findModuleSpecifiers", () => {
    it("should find static imports", () => {
      const code = [
        "import a from \"./a.ts\";",
        "import { b } from \"./b.ts\";",
        "import * as c from \"./c.ts\";",
        "import \"./d.ts\";",
        "import type { E } from \"./e.ts\";",
        "import f from \"./f.json\" with { type: \"json\" };",
      ].join("\n");

      assert.deepStrictEqual(specifiersOf({ code }), ["./a.ts", "./b.ts", "./c.ts", "./d.ts", "./e.ts", "./f.json"]);
    });

    it("should find re-exports", () => {
      const code = [
        "export { a } from \"./a.ts\";",
        "export * from \"./b.ts\";",
        "export * as c from \"./c.ts\";",
        "export type { D } from \"./d.ts\";",
        "const e = 1;",
        "export { e };",
      ].join("\n");

      assert.deepStrictEqual(specifiersOf({ code }), ["./a.ts", "./b.ts", "./c.ts", "./d.ts"]);
    });

    it("should find dynamic imports with constant specifiers", () => {
      const code = [
        "const a = await import(\"./a.ts\");",
        "const b = () => { return import(`./b.ts`); };",
        "const c = await import(\"./c.ts\", { with: {} });",
        "const name = \"d\";",
        "const d = await import(`./${name}.ts`);",
        "const e = await import(name);",
      ].join("\n");

      assert.deepStrictEqual(specifiersOf({ code }), ["./a.ts", "./b.ts", "./c.ts"]);
    });

    it("should find import types and import assignments in declaration files", () => {
      const code = [
        "export declare const a: typeof import(\"./a.ts\");",
        "export declare const b: import(\"./b.ts\").B;",
        "import c = require(\"./c.ts\");",
        "export declare const d: typeof import(\"./d.ts\", { with: { \"resolution-mode\": \"import\" } });",
      ].join("\n");

      assert.deepStrictEqual(specifiersOf({ code, fileName: "file.d.ts" }), ["./a.ts", "./b.ts", "./c.ts", "./d.ts"]);
    });

    it("should find specifiers in JavaScript files", () => {
      const code = "import a from \"./a.js\";\nconst b = await import(\"./b.mjs\");\nexport * from \"pkg\";";

      assert.deepStrictEqual(specifiersOf({ code, fileName: "file.js" }), ["./a.js", "./b.mjs", "pkg"]);
      assert.deepStrictEqual(specifiersOf({ code, fileName: "file.mjs" }), ["./a.js", "./b.mjs", "pkg"]);
    });

    it("should not treat JSX-like syntax in JavaScript files as type assertions", () => {
      const code = "const a = <b>1</b>;\nimport c from \"./c.js\";";

      assert.deepStrictEqual(specifiersOf({ code, fileName: "file.js" }), ["./c.js"]);
    });

    it("should ignore strings that are not module specifiers", () => {
      const code = [
        "const a = \"./a.ts\";",
        "const b = require(\"./b.ts\");",
        "const c = import.meta.resolve(\"./c.ts\");",
        "// import d from \"./d.ts\";",
      ].join("\n");

      assert.deepStrictEqual(specifiersOf({ code }), []);
    });

    it("should report the range of the specifier without quotes", () => {
      const code = "import a from \"./a.ts\";\nexport * from './bb.ts';";

      const specifiers = findModuleSpecifiers({ code, fileName: "file.ts" });

      assert.deepStrictEqual(specifiers, [
        { specifier: "./a.ts", start: 15, end: 21 },
        { specifier: "./bb.ts", start: 39, end: 46 },
      ]);

      specifiers.forEach(({ specifier, start, end }) => {
        assert.strictEqual(code.slice(start, end), specifier);
      });
    });

    it("should reject specifiers with escape sequences", () => {
      assert.throws(() => {
        findModuleSpecifiers({ code: "import a from \"./a\\u002ets\";", fileName: "file.ts" });
      }, {
        message: "escape sequences in module specifiers are not supported, found \"./a\\u002ets\" in \"file.ts\""
      });
    });
  });

  describe("isRelativeSpecifier", () => {
    it("should detect relative specifiers", () => {
      assert.strictEqual(isRelativeSpecifier({ specifier: "./a.ts" }), true);
      assert.strictEqual(isRelativeSpecifier({ specifier: "../a.ts" }), true);
    });

    it("should not treat other specifiers as relative", () => {
      ["a", "node:fs", "@scope/pkg", "/abs/a.ts", "file:///a.ts", ".a.ts", "..a.ts"].forEach((specifier) => {
        assert.strictEqual(isRelativeSpecifier({ specifier }), false, specifier);
      });
    });
  });

  describe("isDeclarationFile", () => {
    it("should detect declaration files", () => {
      assert.strictEqual(isDeclarationFile({ filePath: "a.d.ts" }), true);
      assert.strictEqual(isDeclarationFile({ filePath: "dir/a.d.mts" }), true);
      assert.strictEqual(isDeclarationFile({ filePath: "a.ts" }), false);
      assert.strictEqual(isDeclarationFile({ filePath: "a.d.js" }), false);
    });
  });

  describe("rewriteSpecifier", () => {
    const cases: [string, string][] = [
      ["./a.ts", "./a.js"],
      ["../dir/a.mts", "../dir/a.mjs"],
      ["./a.d.ts.ts", "./a.d.ts.js"],
      ["./a.js", "./a.js"],
      ["./a.json", "./a.json"],
      ["./a.d.ts", "./a.d.ts"],
      ["./a.d.mts", "./a.d.mts"],
      ["./a.cts", "./a.cts"],
      ["./a.tsx", "./a.tsx"],
      ["./dir", "./dir"],
      ["pkg/a.ts", "pkg/a.ts"],
      ["/abs/a.ts", "/abs/a.ts"],
      ["node:test", "node:test"],
    ];

    cases.forEach(([specifier, expected]) => {
      it(`should rewrite "${specifier}" to "${expected}"`, () => {
        assert.strictEqual(rewriteSpecifier({ specifier }), expected);
      });
    });

    it("should preserve the length of rewritten specifiers", () => {
      cases.forEach(([specifier]) => {
        assert.strictEqual(rewriteSpecifier({ specifier }).length, specifier.length);
      });
    });
  });

  describe("rewriteModuleSpecifiers", () => {
    it("should rewrite relative TypeScript specifiers and keep everything else", () => {
      const code = [
        "import a from \"./a.ts\";",
        "import { b } from '../b.mts';",
        "import c from \"pkg\";",
        "import d from \"./d.js\";",
        "export * from \"./e.ts\";",
        "const f = await import(`./f.ts`);",
        "const g = \"./g.ts\";",
      ].join("\n");

      assert.strictEqual(rewriteModuleSpecifiers({ code, fileName: "file.ts" }), [
        "import a from \"./a.js\";",
        "import { b } from '../b.mjs';",
        "import c from \"pkg\";",
        "import d from \"./d.js\";",
        "export * from \"./e.js\";",
        "const f = await import(`./f.js`);",
        "const g = \"./g.ts\";",
      ].join("\n"));
    });

    it("should rewrite import types in declaration files", () => {
      const code = "import type { A } from \"./a.ts\";\nexport declare const b: typeof import(\"./b.ts\");\n";

      assert.strictEqual(
        rewriteModuleSpecifiers({ code, fileName: "file.d.ts" }),
        "import type { A } from \"./a.js\";\nexport declare const b: typeof import(\"./b.js\");\n"
      );
    });

    it("should rewrite multiple specifiers on the same line", () => {
      const code = "import \"./a.ts\"; import \"./bb.ts\"; import \"./ccc.ts\";";

      assert.strictEqual(
        rewriteModuleSpecifiers({ code, fileName: "file.ts" }),
        "import \"./a.js\"; import \"./bb.js\"; import \"./ccc.js\";"
      );
    });

    it("should keep code without specifiers unchanged", () => {
      assert.strictEqual(rewriteModuleSpecifiers({ code: "", fileName: "file.ts" }), "");
      assert.strictEqual(rewriteModuleSpecifiers({ code: "export const a = 1;", fileName: "file.ts" }), "export const a = 1;");
    });
  });
});
