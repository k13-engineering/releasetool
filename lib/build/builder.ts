import nodeFs from "node:fs";
import nodePath from "node:path";
import { generateDeclarations } from "./declarations.ts";
import {
  findModuleSpecifiers,
  isRelativeSpecifier,
  rewriteModuleSpecifiers,
  rewriteSpecifier
} from "./module-specifiers.ts";
import { stripTypes } from "./strip-types.ts";

interface IFileType {
  extensions: string[];

  // whether imports of the file are followed and rewritten
  hasImports: boolean;

  // whether the file is TypeScript, i.e. its types are stripped and
  // declarations are generated
  isTypeScript: boolean;
};

interface IModule {
  // paths are relative to the root directory
  filePath: string;
  outputFilePath: string;
  fileType: IFileType;
  code: string;
  dependencies: string[];
};

interface IOutputFile {
  filePath: string;
  content: string;
};

interface IBuildResult {
  // paths of all written files, relative to the output directory
  files: string[];
};

// order matters, declaration files must be detected before TypeScript files
const fileTypes: IFileType[] = [
  { extensions: [".d.ts", ".d.mts"], hasImports: true, isTypeScript: false },
  { extensions: [".ts", ".mts"], hasImports: true, isTypeScript: true },
  { extensions: [".js", ".mjs"], hasImports: true, isTypeScript: false },
  { extensions: [".json"], hasImports: false, isTypeScript: false },
];

const fileTypeOf = ({ filePath, importedBy }: { filePath: string, importedBy: string | undefined }): IFileType => {
  const fileType = fileTypes.find(({ extensions }) => {
    return extensions.some((extension) => {
      return filePath.endsWith(extension);
    });
  });

  if (fileType === undefined) {
    const via = importedBy === undefined ? "" : ` imported by "${importedBy}"`;
    throw Error(`unsupported file type of "${filePath}"${via}, supported extensions are ${fileTypes.flatMap(({ extensions }) => {
      return extensions;
    }).join(", ")}`);
  }

  return fileType;
};

const isOutsideOfRoot = ({ filePath }: { filePath: string }) => {
  return filePath === ".." || filePath.startsWith(`..${nodePath.sep}`);
};

const resolveDependencies = ({ filePath, code }: { filePath: string, code: string }): string[] => {
  return findModuleSpecifiers({ code, fileName: filePath }).filter(({ specifier }) => {
    return isRelativeSpecifier({ specifier });
  }).map(({ specifier }) => {
    const dependency = nodePath.join(nodePath.dirname(filePath), specifier);

    if (isOutsideOfRoot({ filePath: dependency })) {
      throw Error(`"${filePath}" imports "${specifier}", which is outside of the root directory`);
    }

    return dependency;
  });
};

const readSourceFile = async ({ absoluteFilePath, importedBy }: { absoluteFilePath: string, importedBy: string | undefined }) => {
  try {
    return await nodeFs.promises.readFile(absoluteFilePath, { encoding: "utf-8" });
  } catch (ex) {
    const via = importedBy === undefined ? "" : ` imported by "${importedBy}"`;
    throw Error(`failed to read "${absoluteFilePath}"${via}`, { cause: ex });
  }
};

const loadModule = async ({
  rootDirectory,
  filePath,
  importedBy
}: {
  rootDirectory: string,
  filePath: string,
  importedBy: string | undefined
}): Promise<IModule> => {

  const fileType = fileTypeOf({ filePath, importedBy });
  const code = await readSourceFile({ absoluteFilePath: nodePath.join(rootDirectory, filePath), importedBy });
  const dependencies = fileType.hasImports ? resolveDependencies({ filePath, code }) : [];

  return {
    filePath,
    outputFilePath: rewriteSpecifier({ specifier: `./${filePath}` }).slice(2),
    fileType,
    code,
    dependencies
  };
};

// Loads all modules reachable from the entry points. Imports are taken from
// the TypeScript source, so also files that are only imported for their
// types are part of the build, as their declarations are needed.
const collectModules = async ({ rootDirectory, entryPoints }: { rootDirectory: string, entryPoints: string[] }) => {
  let modules = new Map<string, IModule>();

  const visit = async ({ filePath, importedBy }: { filePath: string, importedBy: string | undefined }) => {
    if (modules.has(filePath)) {
      return;
    }

    const module = await loadModule({ rootDirectory, filePath, importedBy });
    modules = new Map([...modules, [filePath, module]]);

    for (const dependency of module.dependencies) {
      await visit({ filePath: dependency, importedBy: filePath });
    }
  };

  for (const entryPoint of entryPoints) {
    await visit({ filePath: entryPoint, importedBy: undefined });
  }

  return [...modules.values()];
};

const transformModule = ({ module }: { module: IModule }): IOutputFile => {
  const { filePath, fileType, code, outputFilePath } = module;

  const strippedCode = fileType.isTypeScript ? stripTypes({ code, fileName: filePath }) : code;
  const content = fileType.hasImports ? rewriteModuleSpecifiers({ code: strippedCode, fileName: filePath }) : strippedCode;

  return { filePath: outputFilePath, content };
};

const declarationFilesOf = ({
  rootDirectory,
  modules,
  tsconfigPath
}: {
  rootDirectory: string,
  modules: IModule[],
  tsconfigPath: string | undefined
}): IOutputFile[] => {

  const filePaths = modules.filter(({ fileType }) => {
    return fileType.isTypeScript;
  }).map(({ filePath }) => {
    return filePath;
  });

  if (filePaths.length === 0) {
    return [];
  }

  return generateDeclarations({ rootDirectory, filePaths, tsconfigPath }).map(({ declarationFilePath, content }) => {
    return {
      filePath: declarationFilePath,
      content: rewriteModuleSpecifiers({ code: content, fileName: declarationFilePath })
    };
  });
};

const assertUniqueOutputFiles = ({ outputFiles }: { outputFiles: IOutputFile[] }) => {
  const filePaths = outputFiles.map(({ filePath }) => {
    return filePath;
  });

  const duplicates = filePaths.filter((filePath, index) => {
    return filePaths.indexOf(filePath) !== index;
  });

  if (duplicates.length > 0) {
    throw Error(`multiple source files would be written to the same output file: ${[...new Set(duplicates)].join(", ")}`);
  }
};

const writeOutputFiles = async ({ outputDirectory, outputFiles }: { outputDirectory: string, outputFiles: IOutputFile[] }) => {
  for (const { filePath, content } of outputFiles) {
    const absoluteFilePath = nodePath.join(outputDirectory, filePath);
    await nodeFs.promises.mkdir(nodePath.dirname(absoluteFilePath), { recursive: true });
    await nodeFs.promises.writeFile(absoluteFilePath, content);
  }
};

const normalizeEntryPoint = ({ rootDirectory, entryPoint }: { rootDirectory: string, entryPoint: string }) => {
  const normalized = nodePath.relative(rootDirectory, nodePath.resolve(rootDirectory, entryPoint));

  if (isOutsideOfRoot({ filePath: normalized })) {
    throw Error(`entry point "${entryPoint}" is outside of the root directory`);
  }

  return normalized;
};

const resolveDirectories = ({ rootDirectory, outputDirectory }: { rootDirectory: string, outputDirectory: string }) => {
  const absoluteRootDirectory = nodePath.resolve(rootDirectory);
  const absoluteOutputDirectory = nodePath.resolve(outputDirectory);

  if (absoluteRootDirectory === absoluteOutputDirectory) {
    throw Error(`output directory must not be the root directory, as source files would be overwritten`);
  }

  return { absoluteRootDirectory, absoluteOutputDirectory };
};

// Builds all files reachable from the given entry points into the output
// directory, keeping the directory structure. TypeScript files are
// converted to JavaScript by replacing types with whitespace, so line and
// column of all code stay the same. For every TypeScript file a declaration
// file is generated. Relative imports of TypeScript files are rewritten to
// the generated JavaScript files. Nothing is written if any file fails.
const build = async ({
  rootDirectory,
  outputDirectory,
  entryPoints,
  tsconfigPath
}: {
  rootDirectory: string,
  outputDirectory: string,
  // paths relative to the root directory (or absolute paths inside of it)
  entryPoints: string[],
  // path relative to the root directory, defaults to tsconfig.json if present
  tsconfigPath?: string
}): Promise<IBuildResult> => {

  const { absoluteRootDirectory, absoluteOutputDirectory } = resolveDirectories({ rootDirectory, outputDirectory });

  const normalizedEntryPoints = entryPoints.map((entryPoint) => {
    return normalizeEntryPoint({ rootDirectory: absoluteRootDirectory, entryPoint });
  });

  const modules = await collectModules({ rootDirectory: absoluteRootDirectory, entryPoints: normalizedEntryPoints });

  const outputFiles = [
    ...modules.map((module) => {
      return transformModule({ module });
    }),
    ...declarationFilesOf({ rootDirectory: absoluteRootDirectory, modules, tsconfigPath })
  ];

  assertUniqueOutputFiles({ outputFiles });

  await writeOutputFiles({ outputDirectory: absoluteOutputDirectory, outputFiles });

  return {
    files: outputFiles.map(({ filePath }) => {
      return filePath;
    }).toSorted()
  };
};

export {
  build
};

export type {
  IBuildResult
};
