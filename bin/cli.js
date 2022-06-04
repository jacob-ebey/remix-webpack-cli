#!/usr/bin/env node

import("../lib/cli.mjs").catch((error) => {
  console.log(error.message);
  error.stack && console.log(error.stack);
  process.exit(1);
});
