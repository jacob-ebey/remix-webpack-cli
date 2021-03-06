import * as path from "path";
import { createRequire } from "module";
import * as url from "url";

import getPort from "get-port";

import { build, watch } from "./compiler-commands.mjs";

let require = createRequire(import.meta.url);

let command = process.argv[2] || "";

switch (command) {
  case "":
    console.log("Usage: cli [build|dev|watch]");
    process.exit(1);
  case "build":
    process.env.NODE_ENV = "production";
    await build("production");
    break;
  case "dev":
    process.env.NODE_ENV = "development";
    let { remixConfig } = await watch();
    let { default: express } = await import("express");
    let { createRequestHandler } = await import("@remix-run/express");

    let app = express();
    app.use(
      remixConfig.publicPath,
      express.static(remixConfig.assetsBuildDirectory, { immutable: false })
    );
    app.all("*", async (req, res, next) => {
      try {
        let entry = url.pathToFileURL(remixConfig.serverBuildPath);
        let build = await import(`${entry}?${Date.now()}`);
        build = build.default || build;

        let handler = createRequestHandler({ build, mode: remixConfig.mode });
        await handler(req, res, next);
      } catch (error) {
        next(error);
      }
    });

    // let app = createApp(remixConfig.serverBuildPath, "development");
    let port = await getPort({ port: 3000 });
    app.listen(port, () => {
      console.log(`Listening on http://localhost:${port}`);
    });

    break;
  case "watch":
    process.env.NODE_ENV = "development";
    await watch();
    break;
}
