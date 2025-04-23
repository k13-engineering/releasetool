import { mergePackageJson } from "../lib/index.ts";
import nodeFs from "node:fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const { argv } = yargs(hideBin(process.argv))
  .command("merge", "merge package.json files")
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
  })
  .strict();

const args = await argv;

const localPackageJsonPath = args["local-package-json"];
const npmPackageJsonPath = args["npm-package-json"];
const outputPackageJsonPath = args.output;

const main = async () => {

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
};

main();
