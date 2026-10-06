import ts from "typescript";

interface IModuleSpecifier {
  // the module specifier as seen by the module resolution
  specifier: string;

  // range of the specifier inside the code, excluding the quotes
  start: number;
  end: number;
};

const declarationFileExtensions = [".d.ts", ".d.mts"];

const javaScriptExtensionByTypeScriptExtension: Record<string, string> = {
  ".ts": ".js",
  ".mts": ".mjs",
};

const scriptKindForFile = ({ fileName }: { fileName: string }) => {
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs")) {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
};

type TSpecifierLiteral = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;

const isStringLiteral = (node: ts.Node | undefined): node is TSpecifierLiteral => {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
};

const dynamicImportArgument = ({ node }: { node: ts.Node }) => {
  if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) {
    return undefined;
  }

  return node.arguments[0];
};

const importTypeArgument = ({ node }: { node: ts.Node }) => {
  if (!ts.isImportTypeNode(node) || !ts.isLiteralTypeNode(node.argument)) {
    return undefined;
  }

  return node.argument.literal;
};

const externalModuleReference = ({ node }: { node: ts.Node }) => {
  if (!ts.isImportEqualsDeclaration(node) || !ts.isExternalModuleReference(node.moduleReference)) {
    return undefined;
  }

  return node.moduleReference.expression;
};

const declarationModuleSpecifier = ({ node }: { node: ts.Node }) => {
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) {
    return undefined;
  }

  return node.moduleSpecifier;
};

const candidateExtractors = [
  declarationModuleSpecifier,
  dynamicImportArgument,
  importTypeArgument,
  externalModuleReference,
];

const moduleSpecifierCandidate = ({ node }: { node: ts.Node }): ts.Node | undefined => {
  return candidateExtractors.map((extract) => {
    return extract({ node });
  }).find((candidate) => {
    return candidate !== undefined;
  });
};

const toModuleSpecifier = ({ literal, sourceFile }: { literal: TSpecifierLiteral, sourceFile: ts.SourceFile }) => {
  const start = literal.getStart(sourceFile) + 1;
  const end = literal.getEnd() - 1;
  const raw = sourceFile.text.slice(start, end);

  if (raw !== literal.text) {
    throw Error(`escape sequences in module specifiers are not supported, found "${raw}" in "${sourceFile.fileName}"`);
  }

  return { specifier: literal.text, start, end };
};

// Finds all static module specifiers in the given code. This includes
// imports, re-exports, dynamic imports with a constant specifier and import
// types as they are used in declaration files.
const findModuleSpecifiers = ({ code, fileName }: { code: string, fileName: string }): IModuleSpecifier[] => {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.ESNext, true, scriptKindForFile({ fileName }));

  let specifiers: IModuleSpecifier[] = [];

  const visit = (node: ts.Node) => {
    const candidate = moduleSpecifierCandidate({ node });

    if (isStringLiteral(candidate)) {
      specifiers = [...specifiers, toModuleSpecifier({ literal: candidate, sourceFile })];
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return specifiers;
};

const isRelativeSpecifier = ({ specifier }: { specifier: string }) => {
  return specifier.startsWith("./") || specifier.startsWith("../");
};

const isDeclarationFile = ({ filePath }: { filePath: string }) => {
  return declarationFileExtensions.some((extension) => {
    return filePath.endsWith(extension);
  });
};

// Maps a relative specifier to a TypeScript file to the JavaScript file the
// build emits for it, e.g. "./foo.ts" -> "./foo.js". The replacement has the
// same length as the original, so positions in the code are preserved.
const rewriteSpecifier = ({ specifier }: { specifier: string }): string => {
  if (!isRelativeSpecifier({ specifier }) || isDeclarationFile({ filePath: specifier })) {
    return specifier;
  }

  const extension = Object.keys(javaScriptExtensionByTypeScriptExtension).find((ext) => {
    return specifier.endsWith(ext);
  });

  if (extension === undefined) {
    return specifier;
  }

  return `${specifier.slice(0, -extension.length)}${javaScriptExtensionByTypeScriptExtension[extension]}`;
};

const rewriteModuleSpecifiers = ({ code, fileName }: { code: string, fileName: string }): string => {
  const specifiers = findModuleSpecifiers({ code, fileName });

  return specifiers.reduceRight((result, { specifier, start, end }) => {
    return `${result.slice(0, start)}${rewriteSpecifier({ specifier })}${result.slice(end)}`;
  }, code);
};

export {
  findModuleSpecifiers,
  isDeclarationFile,
  isRelativeSpecifier,
  rewriteModuleSpecifiers,
  rewriteSpecifier
};

export type {
  IModuleSpecifier
};
