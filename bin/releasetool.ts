#!/usr/bin/env node

import process from "node:process";
import { hideBin } from "yargs/helpers";
import { runCli } from "../lib/cli.ts";

const { exitCode } = await runCli({
  args: hideBin(process.argv),
  stdout: (text) => {
    process.stdout.write(`${text}\n`);
  },
  stderr: (text) => {
    process.stderr.write(`${text}\n`);
  }
});

// eslint-disable-next-line immutable/no-mutation
process.exitCode = exitCode;
