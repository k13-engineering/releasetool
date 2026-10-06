import nodeFs from "node:fs";
import yargs from "yargs";
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

  const parser = addPatchVersionCommand({ parser: addMergeCommand({ parser: baseParser }) })
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
