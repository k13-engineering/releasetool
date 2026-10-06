import nodeFs from "node:fs";
import nodePath from "node:path";
import ts from "typescript";
import { formatDiagnostics } from "./diagnostics.ts";

interface IDeclarationFile {
  // path of the TypeScript source file, relative to the root directory
  sourceFilePath: string;

  // path of the generated declaration file, relative to the root directory
  declarationFilePath: string;

  content: string;
};

const defaultCompilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ESNext,
  strict: true,
  skipLibCheck: true,
};

// "No inputs were found in config file", irrelevant as we pass the files
// to compile explicitly
const noInputsFoundDiagnosticCode = 18_003;

// declarations are captured in memory, nothing is ever written there
const virtualOutputDirectoryName = ".releasetool-declarations";

const throwOnDiagnostics = ({ diagnostics, message }: { diagnostics: readonly ts.Diagnostic[], message: string }) => {
  if (diagnostics.length > 0) {
    throw Error(`${message}:\n${formatDiagnostics({ diagnostics })}`);
  }
};

const loadTsconfig = ({ tsconfigPath }: { tsconfigPath: string }): ts.CompilerOptions => {
  const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

  throwOnDiagnostics({ diagnostics: error === undefined ? [] : [error], message: `failed to read "${tsconfigPath}"` });

  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, nodePath.dirname(tsconfigPath), undefined, tsconfigPath);

  const relevantErrors = parsed.errors.filter((diagnostic) => {
    return diagnostic.code !== noInputsFoundDiagnosticCode;
  });

  throwOnDiagnostics({ diagnostics: relevantErrors, message: `invalid TypeScript configuration "${tsconfigPath}"` });

  return parsed.options;
};

const loadCompilerOptions = ({
  rootDirectory,
  tsconfigPath
}: {
  rootDirectory: string,
  tsconfigPath: string | undefined
}): ts.CompilerOptions => {

  if (tsconfigPath !== undefined) {
    return loadTsconfig({ tsconfigPath: nodePath.resolve(rootDirectory, tsconfigPath) });
  }

  const defaultTsconfigPath = nodePath.join(rootDirectory, "tsconfig.json");

  if (nodeFs.existsSync(defaultTsconfigPath)) {
    return loadTsconfig({ tsconfigPath: defaultTsconfigPath });
  }

  return defaultCompilerOptions;
};

const declarationCompilerOptions = ({
  baseOptions,
  rootDirectory
}: {
  baseOptions: ts.CompilerOptions,
  rootDirectory: string
}): ts.CompilerOptions => {
  return {
    ...baseOptions,
    noEmit: false,
    noEmitOnError: false,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    sourceMap: false,
    inlineSourceMap: false,
    composite: false,
    incremental: false,
    tsBuildInfoFile: undefined,
    outFile: undefined,
    declarationDir: undefined,
    allowImportingTsExtensions: true,
    rootDir: rootDirectory,
    outDir: nodePath.join(rootDirectory, virtualOutputDirectoryName),
  };
};

const declarationFilePathFor = ({ sourceFilePath }: { sourceFilePath: string }) => {
  return sourceFilePath.replace(/\.(m?)ts$/, ".d.$1ts");
};

// Emits declarations of all files in the program, returns them by path
// relative to the root directory.
const emitDeclarations = ({ program, options }: { program: ts.Program, options: ts.CompilerOptions }) => {
  let emitted = new Map<string, string>();

  // signature is defined by TypeScript
  // eslint-disable-next-line k13-engineering/prefer-single-object-parameters
  const { diagnostics } = program.emit(undefined, (outputFileName, content) => {
    const declarationFilePath = nodePath.relative(options.outDir as string, outputFileName);
    emitted = new Map([...emitted, [declarationFilePath, content]]);
  }, undefined, true);

  throwOnDiagnostics({ diagnostics, message: "failed to generate declarations" });

  return emitted;
};

// Generates one declaration file per given TypeScript file. All files are
// compiled as one program, so types inferred from other modules and
// packages are resolved correctly. The project's tsconfig.json is honored,
// except for the options controlling what and where to emit.
const generateDeclarations = ({
  rootDirectory,
  filePaths,
  tsconfigPath
}: {
  rootDirectory: string,
  filePaths: string[],
  tsconfigPath?: string
}): IDeclarationFile[] => {

  const absoluteRootDirectory = nodePath.resolve(rootDirectory);
  const baseOptions = loadCompilerOptions({ rootDirectory: absoluteRootDirectory, tsconfigPath });
  const options = declarationCompilerOptions({ baseOptions, rootDirectory: absoluteRootDirectory });

  const rootNames = filePaths.map((filePath) => {
    return nodePath.resolve(absoluteRootDirectory, filePath);
  });

  const program = ts.createProgram({ rootNames, options });

  throwOnDiagnostics({ diagnostics: program.getOptionsDiagnostics(), message: "failed to create TypeScript program" });

  const emitted = emitDeclarations({ program, options });

  return rootNames.map((rootName) => {
    const sourceFilePath = nodePath.relative(absoluteRootDirectory, rootName);
    const declarationFilePath = declarationFilePathFor({ sourceFilePath });
    const content = emitted.get(declarationFilePath);

    if (content === undefined) {
      throw Error(`no declarations generated for "${sourceFilePath}"`);
    }

    return { sourceFilePath, declarationFilePath, content };
  });
};

export {
  generateDeclarations
};

export type {
  IDeclarationFile
};
