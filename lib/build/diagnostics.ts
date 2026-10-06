import ts from "typescript";

const formatPosition = ({ sourceFile, position }: { sourceFile: ts.SourceFile, position: number }) => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
  return `${sourceFile.fileName}:${line + 1}:${character + 1}`;
};

const formatDiagnostic = ({ diagnostic }: { diagnostic: ts.Diagnostic }) => {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return message;
  }

  return `${formatPosition({ sourceFile: diagnostic.file, position: diagnostic.start })}: ${message}`;
};

const formatDiagnostics = ({ diagnostics }: { diagnostics: readonly ts.Diagnostic[] }) => {
  return diagnostics.map((diagnostic) => {
    return formatDiagnostic({ diagnostic });
  }).join("\n");
};

export {
  formatDiagnostics,
  formatPosition
};
