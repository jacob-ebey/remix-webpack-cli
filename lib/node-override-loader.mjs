import { readFile } from "fs/promises";
import { createRequire } from "module";
import * as URL from "url";

import { readConfig } from "./config.mjs";

let require = createRequire(import.meta.url);

let config = await readConfig(process.cwd(), "development");
let outputFile = URL.pathToFileURL(config.serverBuildPath);

/**
 *
 * @param {string} url
 * @param {{ format: string }} context
 * @param {*} defaultLoad
 * @returns
 */
export async function load(url, context, defaultLoad) {
  let baseUrl = url.split("?", 1)[0];

  if (baseUrl.endsWith(outputFile.href)) {
    if (context.format === "module") {
      return {
        format: "module",
        source: await readFile(new URL.URL(baseUrl)),
      };
    } else {
      let buildPath = require.resolve(config.serverBuildPath);
      delete require.cache[buildPath];
    }
  }

  return defaultLoad(url, context, defaultLoad);
}
