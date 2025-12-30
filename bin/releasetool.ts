import { mergePackageJson } from "../lib/index.ts";
import nodeFs from "node:fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const parser = yargs(hideBin(process.argv))
  .command("merge", "merge package.json files", (y) => {
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
    const localPackageJsonPath = args["local-package-json"];
    const npmPackageJsonPath = args["npm-package-json"];
    const outputPackageJsonPath = args.output;

    const rawLocalPackageJson = await nodeFs.promises.readFile(localPackageJsonPath, { encoding: "utf-8" });
    const localPackageJson = JSON.parse(rawLocalPackageJson);

    const rawNpmPackageJson = await nodeFs.promises.readFile(npmPackageJsonPath, { encoding: "utf-8" });
    const npmPackageJson = JSON.parse(rawNpmPackageJson);

    const mergedPackageJson = mergePackageJson({
      localPackageJson,
      npmPackageJson
    });

    const rawMergedPackageJson = JSON.stringify(mergedPackageJson, null, 2);
    await nodeFs.promises.writeFile(outputPackageJsonPath, `${rawMergedPackageJson}\n`);
  })
  .command("patch-version", "patch version field in package.json", (y) => {
    return y
      .option("package-json", {
        describe: "path to package.json file",
        requiresArg: true,
        demandOption: true,
        type: "string",
      })
      .option("version", {
        describe: "version string in the form v0.0.1",
        requiresArg: true,
        demandOption: true,
        type: "string",
      });
  }, async (args) => {
    const packageJsonPath = args["package-json"];
    const versionString = args.version;

    if (!versionString.startsWith("v")) {
      throw new Error(`version string must start with 'v', got "${versionString}"`);
    }

    // Remove 'v' prefix if present
    const version = versionString.slice(1);

    // Read and parse the package.json
    const rawPackageJson = await nodeFs.promises.readFile(packageJsonPath, { encoding: "utf-8" });
    const packageJson = JSON.parse(rawPackageJson);

    const { version: oldVersion, ...rest } = packageJson;

    const newPackageJson = {
      version,
      ...rest
    };

    // Write back to file
    const updatedPackageJson = JSON.stringify(newPackageJson, null, 2);
    await nodeFs.promises.writeFile(packageJsonPath, `${updatedPackageJson}\n`);
  })
  .demandCommand(1, "You must specify a command")
  .strict();

parser.parse();
