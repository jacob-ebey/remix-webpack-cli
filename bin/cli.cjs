#!/usr/bin/env node

let childProcess = require("child_process");
let path = require("path");

childProcess.fork(
  path.resolve(__dirname, "../lib/cli.mjs"),
  process.argv.slice(2),
  {
    execArgv: [
      "--experimental-loader",
      path.resolve(__dirname, "../lib/node-override-loader.mjs"),
      "--require",
      path.resolve(__dirname, "../lib/node-override-require.cjs"),
    ],
  }
);

// import("../lib/cli.mjs").catch((error) => {
//   console.log(error.message);
//   error.stack && console.log(error.stack);
//   process.exit(1);
// });
