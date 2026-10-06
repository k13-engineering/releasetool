import assert from "node:assert";
import { describe, it } from "mocha";
import ts from "typescript";
import { formatDiagnostics, formatPosition } from "./diagnostics.ts";

describe("diagnostics", () => {
  const sourceFile = ts.createSourceFile("file.ts", "const a = 1;\nconst b = 2;\n", ts.ScriptTarget.ESNext, true);

  describe("formatPosition", () => {
    it("should format positions as one-based line and column", () => {
      assert.strictEqual(formatPosition({ sourceFile, position: 0 }), "file.ts:1:1");
      assert.strictEqual(formatPosition({ sourceFile, position: 19 }), "file.ts:2:7");
    });
  });

  describe("formatDiagnostics", () => {
    it("should format diagnostics with and without location", () => {
      const diagnostics: ts.Diagnostic[] = [{
        category: ts.DiagnosticCategory.Error,
        code: 1,
        file: sourceFile,
        start: 19,
        length: 1,
        messageText: "located",
      }, {
        category: ts.DiagnosticCategory.Error,
        code: 2,
        file: undefined,
        start: undefined,
        length: undefined,
        messageText: {
          messageText: "outer",
          category: ts.DiagnosticCategory.Error,
          code: 3,
          next: [{ messageText: "inner", category: ts.DiagnosticCategory.Error, code: 4 }]
        },
      }];

      assert.strictEqual(formatDiagnostics({ diagnostics }), "file.ts:2:7: located\nouter\n  inner");
    });

    it("should format no diagnostics as empty string", () => {
      assert.strictEqual(formatDiagnostics({ diagnostics: [] }), "");
    });
  });
});
