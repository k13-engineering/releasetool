# releasetool

Tooling for building and releasing TypeScript packages to npm.

- **build**: builds a TypeScript project to JavaScript and declaration
  files, keeping every line and column of the code where it was
- **merge**: merges `package.json` with `package.npm.json` for publishing
- **patch-version**: sets the version in `package.json` from a git tag

## Installation

```sh
npm install --save-dev @k13engineering/releasetool
```

## Building

```sh
releasetool build --root . --out dist/ --entry lib/index.ts --entry bin/cli.ts
```

| Option       | Description                                                                         |
| ------------ | ----------------------------------------------------------------------------------- |
| `--entry`    | Entry file, can be given multiple times. Required.                                  |
| `--out`      | Output directory. Required.                                                         |
| `--root`     | Root directory, the structure below it is kept in the output. Defaults to `.`.      |
| `--tsconfig` | TypeScript configuration for declarations. Defaults to `tsconfig.json` in the root. |

Paths are relative to the working directory. The options are the same as
for `deno-node-build`, so `releasetool build` can be used as a drop-in
replacement.

### What the build does

All files reachable through relative imports from the entry files are built
into the output directory:

| Source                           | Output                                                    |
| -------------------------------- | --------------------------------------------------------- |
| `.ts`, `.mts`                    | `.js`, `.mjs` with types stripped, plus `.d.ts`, `.d.mts` |
| `.js`, `.mjs`, `.d.ts`, `.d.mts` | copied, relative imports of TypeScript files rewritten    |
| `.json`                          | copied unchanged                                          |

- **Positions are preserved.** Types are replaced by whitespace using
  [ts-blank-space](https://github.com/bloomberg/ts-blank-space), and imports
  such as `"./foo.ts"` are rewritten to `"./foo.js"`, which has the same
  length. Stack traces of the built code therefore point to the same line
  and column as in the TypeScript source, without source maps.
- **One declaration file per TypeScript file.** Declarations are generated
  by the TypeScript compiler for all files as one program, so types inferred
  from other modules or packages resolve correctly. The project's
  `tsconfig.json` is honored, except for options that control what and where
  to emit.
- **Type-only imports are followed**, so declarations of files that are only
  imported for their types are part of the output.
- **Nothing is written if the build fails.**

The build does not type-check, use `tsc --noEmit` for that.

### Limitations

- Only erasable TypeScript syntax is supported, the same subset Node.js runs
  natively. Enums, namespaces with values, parameter properties,
  `import x = require()` and `<T>value` assertions are rejected with their
  location. Enabling the `erasableSyntaxOnly` compiler option surfaces most
  of these in your editor already.
- Only static specifiers are followed: imports, re-exports and `import()`
  with a string literal. `import.meta.resolve()`, `require()` and computed
  `import()` specifiers are left alone.
- Imports must not leave the root directory and must include the file
  extension, as required by Node.js for ES modules.

## Publishing

```sh
releasetool merge --local-package-json package.json --npm-package-json package.npm.json --output package.json
releasetool patch-version --package-json package.json --package-version v1.2.3
```

`merge` combines both files, with fields of `package.npm.json` taking
precedence. `patch-version` expects the version with a `v` prefix, as in git
tags.

## Usage from code

```ts
import { build, stripTypes, mergePackageJson, patchPackageJsonVersion, runCli } from "@k13engineering/releasetool";

// paths of entry points and tsconfig are relative to the root directory
const { files } = await build({
  rootDirectory: ".",
  outputDirectory: "dist",
  entryPoints: ["lib/index.ts"],
});

const javaScript = stripTypes({ code: "const a: number = 1;", fileName: "a.ts" });
// "const a         = 1;"

const merged = mergePackageJson({ localPackageJson, npmPackageJson });
const patched = patchPackageJsonVersion({ packageJson: merged, versionTag: "v1.2.3" });

// runs the CLI without touching the process, e.g. for wrapping it
const { exitCode } = await runCli({
  args: ["build", "--out", "dist", "--entry", "lib/index.ts"],
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
});
```

All functions throw on errors.
