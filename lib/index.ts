import { mergePackageJson, patchPackageJsonVersion } from "./package-json.ts";
import { runCli } from "./cli.ts";

import type { TPackageJson } from "./package-json.ts";

export {
  mergePackageJson,
  patchPackageJsonVersion,
  runCli
};

export type {
  TPackageJson
};
