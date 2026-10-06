import nodeFs from "node:fs";
import nodePath from "node:path";
import yargs from "yargs";
import { build } from "./build/builder.ts";
import { formatError } from "./format-error.ts";
import { mergePackageJson, patchPackageJsonVersion } from "./package-json.ts";

import type { Argv } from "yargs";
import type { TPackageJson } from "./package-json.ts";

type TOutputFunction = (text: string) => void;

const readJsonFile = async ({ filePath }: { filePath: string }): Promise<TPackageJson> => {
  const rawJson = await nodeFs.promises.readFile(filePath, { encoding: "utf-8" });
  return JSON.parse(rawJson) as TPackageJson;
};

const writeJsonFile = async ({ filePath, content }: { filePath: string, content: TPackageJson }) => {
  const rawJson = JSON.stringify(content, null, 2);
  await nodeFs.promises.writeFile(filePath, `${rawJson}\n`);
};

const addMergeCommand = ({ parser }: { parser: Argv }) => {
  return parser.command("merge", "merge package.json files", (y) => {
    return y
      .option("local-package-json", {
        describe: "path of local package.json to merge",
        requiresArg: true,
        demandOption: true,
        type: "string",
      })
      .option("npm-package-json", {
        describe: "path of npm package.json to merge",
        requiresArg: true,
        demandOption: true,
        type: "string",
      })
      .option("output", {
        describe: "path of output package.json",
        requiresArg: true,
        demandOption: true,
        type: "string",
      });
  }, async (args) => {
    const localPackageJson = await readJsonFile({ filePath: args["local-package-json"] });
    const npmPackageJson = await readJsonFile({ filePath: args["npm-package-json"] });

    const mergedPackageJson = mergePackageJson({
      localPackageJson,
      npmPackageJson
    });

    await writeJsonFile({ filePath: args.output, content: mergedPackageJson });
  });
};

const addPatchVersionCommand = ({ parser }: { parser: Argv }) => {
  return parser.command("patch-version", "patch version field in package.json", (y) => {
    return y
      .option("package-json", {
        describe: "path to package.json file",
        requiresArg: true,
        demandOption: true,
        type: "string",
      })
      .option("package-version", {
        describe: "version string in the form v0.0.1",
        requiresArg: true,
        demandOption: true,
        type: "string",
      });
  }, async (args) => {
    const packageJsonPath = args["package-json"];

    const packageJson = await readJsonFile({ filePath: packageJsonPath });

    const patchedPackageJson = patchPackageJsonVersion({
      packageJson,
      versionTag: args["package-version"]
    });

    await writeJsonFile({ filePath: packageJsonPath, content: patchedPackageJson });
  });
};

const singleValueBuildOptions = ["root", "out", "tsconfig"];

const assertSingleValues = ({ args }: { args: Record<string, unknown> }) => {
  const repeated = singleValueBuildOptions.filter((option) => {
    return Array.isArray(args[option]);
  });

  if (repeated.length > 0) {
    throw Error(`option --${repeated[0]} must only be given once`);
  }

  return true;
};

const addBuildCommand = ({ parser, stdout }: { parser: Argv, stdout: TOutputFunction }) => {
  return parser.command("build", "build TypeScript project, preserving positions of code", (y) => {
    return y
      .option("root", {
        describe: "root directory of the project, the directory structure below is kept in the output",
        requiresArg: true,
        default: ".",
        type: "string",
      })
      .option("out", {
        describe: "output directory",
        requiresArg: true,
        demandOption: true,
        type: "string",
      })
      .option("entry", {
        describe: "entry file, can be given multiple times",
        requiresArg: true,
        demandOption: true,
        array: true,
        type: "string",
      })
      .option("tsconfig", {
        describe: "tsconfig used for generating declarations, defaults to tsconfig.json in the root directory",
        requiresArg: true,
        type: "string",
      })
      .check((args) => {
        return assertSingleValues({ args });
      });
  }, async (args) => {
    const { files } = await build({
      rootDirectory: args.root,
      outputDirectory: args.out,
      entryPoints: args.entry.map((entry) => {
        return nodePath.resolve(entry);
      }),
      tsconfigPath: args.tsconfig === undefined ? undefined : nodePath.resolve(args.tsconfig),
    });

    stdout(`built ${files.length} file${files.length === 1 ? "" : "s"} into "${args.out}"`);
  });
};

const runCli = async ({
  args,
  stdout,
  stderr
}: {
  args: string[],
  stdout: TOutputFunction,
  stderr: TOutputFunction
}): Promise<{ exitCode: number }> => {

  const baseParser = yargs(args)
    .scriptName("releasetool")
    .exitProcess(false)
    // signature is defined by yargs
    // eslint-disable-next-line k13-engineering/prefer-single-object-parameters
    .fail((message, error) => {
      throw error ?? Error(message);
    });

  const parser = addBuildCommand({
    parser: addPatchVersionCommand({ parser: addMergeCommand({ parser: baseParser }) }),
    stdout
  })
    .demandCommand(1, "You must specify a command")
    .strict();

  try {
    // signature is defined by yargs
    // eslint-disable-next-line k13-engineering/prefer-single-object-parameters
    await parser.parseAsync(args, {}, (error, argv, output) => {
      if (output !== "") {
        stdout(output);
      }
    });

    return { exitCode: 0 };
  } catch (ex) {
    stderr(`error: ${formatError({ error: ex })}`);
    return { exitCode: 1 };
  }
};

export {
  runCli
};
