import ts from "typescript";
import { blankSourceFile } from "ts-blank-space";
import { formatDiagnostics, formatPosition } from "./diagnostics.ts";

const assertValidSyntax = ({ code, fileName }: { code: string, fileName: string }) => {
  const { diagnostics } = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  });

  if (diagnostics !== undefined && diagnostics.length > 0) {
    throw Error(`syntax error in "${fileName}":\n${formatDiagnostics({ diagnostics })}`);
  }
};

// Replaces all TypeScript type annotations with whitespace, so that every
// remaining token of the code keeps its position (line and column). Only
// erasable syntax is supported, everything that would require generating
// JavaScript code (enums, namespaces, parameter properties, ...) is rejected.
const stripTypes = ({ code, fileName }: { code: string, fileName: string }): string => {
  assertValidSyntax({ code, fileName });

  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);

  let unsupported: string[] = [];

  const stripped = blankSourceFile(sourceFile, (node) => {
    const position = formatPosition({ sourceFile, position: node.getStart(sourceFile) });
    unsupported = [
      ...unsupported,
      `${position}: ${ts.SyntaxKind[node.kind]} "${node.getText(sourceFile).split("\n")[0]}"`
    ];
  });

  if (unsupported.length > 0) {
    throw Error([
      `unsupported TypeScript syntax in "${fileName}", only erasable syntax can be stripped:`,
      ...unsupported
    ].join("\n"));
  }

  return stripped;
};

export {
  stripTypes
};
