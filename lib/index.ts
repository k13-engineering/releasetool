import { mergePackageJson, patchPackageJsonVersion } from "./package-json.ts";
import { runCli } from "./cli.ts";
import { build } from "./build/builder.ts";
import { stripTypes } from "./build/strip-types.ts";

import type { TPackageJson } from "./package-json.ts";
import type { IBuildResult } from "./build/builder.ts";

export {
  build,
  mergePackageJson,
  patchPackageJsonVersion,
  runCli,
  stripTypes
};

export type {
  IBuildResult,
  TPackageJson
};
