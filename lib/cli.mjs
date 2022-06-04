import getPort from "get-port";

import { build, watch } from "./compiler-commands.mjs";

let command = process.argv[2] || "";

switch (command) {
  case "":
    console.log("Usage: cli [build|dev|watch]");
    process.exit(1);
  case "build":
    process.env.NODE_ENV = "production";
    await build();
    break;
  case "dev":
    process.env.NODE_ENV = "development";
    let { remixConfig } = await watch();
    let { createApp } = await import("@remix-run/serve");

    let app = createApp(remixConfig.serverBuildPath, "development");
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
