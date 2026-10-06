import assert from "node:assert";
import { describe, it } from "mocha";
import { stripTypes } from "./strip-types.ts";

const strip = ({ code }: { code: string }) => {
  return stripTypes({ code, fileName: "file.ts" });
};

const evaluateModule = async ({ code }: { code: string }) => {
  return await import(`data:text/javascript,${encodeURIComponent(code)}`) as Record<string, unknown>;
};

const assertSamePositions = ({ code, stripped }: { code: string, stripped: string }) => {
  assert.strictEqual(stripped.length, code.length);
  assert.deepStrictEqual(stripped.split("\n").map((line) => {
    return line.length;
  }), code.split("\n").map((line) => {
    return line.length;
  }));
};

describe("stripTypes", () => {
  describe("erasable syntax", () => {
    const cases: { name: string, code: string, expected: string }[] = [
      {
        name: "variable annotations",
        code: "const a: number = 1;",
        expected: "const a         = 1;",
      },
      {
        name: "parameter and return types",
        code: "const f = (a: string, b?: number): void => {};",
        expected: "const f = (a        , b         )       => {};",
      },
      {
        name: "generics",
        code: "const f = <T extends object>(a: T): T => a;",
        expected: "const f =                   (a   )    => a;",
      },
      {
        name: "interfaces and type aliases",
        code: "interface A { a: number }\ntype B = A | string;\nconst c = 1;",
        expected: "                         \n                    \nconst c = 1;",
      },
      {
        name: "type assertions with as and satisfies",
        code: "const a = b as string;\nconst c = { d: 1 } satisfies object;",
        expected: "const a = b          ;\nconst c = { d: 1 }                 ;",
      },
      {
        name: "non-null assertions",
        code: "const a = b!.c!;",
        expected: "const a = b .c ;",
      },
      {
        name: "definite assignment assertions",
        code: "let a!: number;",
        expected: "let a         ;",
      },
      {
        name: "type-only imports and exports",
        code: "import type { A } from \"./a.ts\";\nexport type { B } from \"./b.ts\";",
        expected: "                                \n                                ",
      },
      {
        name: "type-only import specifiers",
        code: "import { type A, b } from \"./a.ts\";",
        expected: "import {         b } from \"./a.ts\";",
      },
      {
        name: "ambient declarations",
        code: "declare const a: number;\ndeclare global { var b: number }\ndeclare module \"x\" {}",
        expected: "                        \n                                \n                     ",
      },
      {
        name: "class modifiers, implements and abstract members",
        code: "abstract class A implements B { private readonly a?: number; abstract f(): void; declare b: string; }",
        expected: "         class A              {                  a         ;                                        }",
      },
      {
        name: "function overloads and this parameters",
        code: "function f(a: string): void;\nfunction f(this: object, a: unknown) {}",
        expected: "                            \nfunction f(              a         ) {}",
      },
    ];

    cases.forEach(({ name, code, expected }) => {
      it(`should strip ${name}`, () => {
        const stripped = strip({ code });

        assert.strictEqual(stripped, expected);
        assertSamePositions({ code, stripped });
      });
    });
  });

  describe("position preservation", () => {
    it("should keep every token at its original line and column", () => {
      const code = [
        "#!/usr/bin/env node",
        "// a comment",
        "import type { Options } from \"./options.ts\";",
        "",
        "interface IResult {",
        "  value: number;",
        "}",
        "",
        "/** documentation */",
        "const compute = ({ value }: Options): IResult => {",
        "  return { value: value * 2 }; // trailing comment",
        "};",
        "",
        "export { compute };",
        ""
      ].join("\n");

      const stripped = strip({ code });

      assertSamePositions({ code, stripped });
      assert.strictEqual(stripped.indexOf("value * 2"), code.indexOf("value * 2"));
      assert.strictEqual(stripped.indexOf("export { compute }"), code.indexOf("export { compute }"));
      assert.ok(stripped.startsWith("#!/usr/bin/env node\n// a comment\n"));
      assert.ok(stripped.includes("/** documentation */"));
      assert.ok(stripped.includes("// trailing comment"));
    });

    it("should leave plain JavaScript untouched", () => {
      const code = "import a from \"./a.js\";\nexport const b = (c) => {\n  return a + c;\n};\n";

      assert.strictEqual(strip({ code }), code);
    });

    it("should not rewrite module specifiers", () => {
      const code = "import { a } from \"./a.ts\";\nconst b: number = a;";

      assert.strictEqual(strip({ code }), "import { a } from \"./a.ts\";\nconst b         = a;");
    });

    it("should handle code that relies on automatic semicolon insertion", async () => {
      const code = "export const a = 1 as number\n;[2, 3].forEach((b: number) => b)\nexport const c = [a]";
      const stripped = strip({ code });

      assertSamePositions({ code, stripped });
      const module = await evaluateModule({ code: stripped });
      assert.deepStrictEqual(module.c, [1]);
    });

    it("should handle empty files", () => {
      assert.strictEqual(strip({ code: "" }), "");
    });
  });

  describe("runtime semantics", () => {
    it("should produce JavaScript that behaves like the TypeScript source", async () => {
      const code = [
        "type TPoint = { x: number, y: number };",
        "class Vector {",
        "  readonly x: number;",
        "  readonly y: number;",
        "  constructor({ x, y }: TPoint) {",
        "    this.x = x;",
        "    this.y = y;",
        "  }",
        "  private lengthSquared(): number {",
        "    return this.x * this.x + this.y * this.y;",
        "  }",
        "  length(): number {",
        "    return Math.sqrt(this.lengthSquared());",
        "  }",
        "}",
        "export const length = new Vector({ x: 3, y: 4 } satisfies TPoint).length() as number;",
        "export const generic = <T,>(value: T): T[] => [value];",
      ].join("\n");

      const module = await evaluateModule({ code: strip({ code }) });

      assert.strictEqual(module.length, 5);
      assert.deepStrictEqual((module.generic as (value: string) => string[])("a"), ["a"]);
    });
  });

  describe("unsupported syntax", () => {
    const cases: { name: string, code: string, reported: string }[] = [
      { name: "enums", code: "enum E { A }", reported: "file.ts:1:1: EnumDeclaration \"enum E { A }\"" },
      { name: "const enums", code: "const enum E { A }", reported: "file.ts:1:1: EnumDeclaration \"const enum E { A }\"" },
      {
        name: "namespaces with values",
        code: "namespace N {\n  export const a = 1;\n}",
        reported: "file.ts:1:1: ModuleDeclaration \"namespace N {\""
      },
      {
        name: "parameter properties",
        code: "class A {\n  constructor(private a: number) {}\n}",
        reported: "file.ts:2:15: PrivateKeyword \"private\""
      },
      {
        name: "import assignments",
        code: "import fs = require(\"node:fs\");",
        reported: "file.ts:1:1: ImportEqualsDeclaration \"import fs = require(\"node:fs\");\""
      },
      { name: "export assignments", code: "export = 1;", reported: "file.ts:1:1: ExportAssignment \"export = 1;\"" },
      {
        name: "angle bracket type assertions",
        code: "const a = 1;\nconst b = <number>a;",
        reported: "file.ts:2:11: TypeAssertionExpression \"<number>a\""
      },
    ];

    cases.forEach(({ name, code, reported }) => {
      it(`should reject ${name}`, () => {
        assert.throws(() => {
          strip({ code });
        }, {
          message: `unsupported TypeScript syntax in "file.ts", only erasable syntax can be stripped:\n${reported}`
        });
      });
    });

    it("should report all unsupported syntax at once", () => {
      assert.throws(() => {
        strip({ code: "enum A { X }\nenum B { Y }" });
      }, {
        message: [
          "unsupported TypeScript syntax in \"file.ts\", only erasable syntax can be stripped:",
          "file.ts:1:1: EnumDeclaration \"enum A { X }\"",
          "file.ts:2:1: EnumDeclaration \"enum B { Y }\""
        ].join("\n")
      });
    });
  });

  describe("syntax errors", () => {
    it("should reject code with syntax errors", () => {
      assert.throws(() => {
        stripTypes({ code: "const a = 1;\nconst b = ;", fileName: "broken.ts" });
      }, {
        message: "syntax error in \"broken.ts\":\nbroken.ts:2:11: Expression expected."
      });
    });

    it("should report all syntax errors", () => {
      assert.throws(() => {
        stripTypes({ code: "let a: = 1;\nlet b: = 2;", fileName: "broken.ts" });
      }, {
        message: "syntax error in \"broken.ts\":\nbroken.ts:1:8: Type expected.\nbroken.ts:2:8: Type expected."
      });
    });
  });
});
