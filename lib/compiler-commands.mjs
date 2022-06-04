import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";

import chokidar from "chokidar";
import debounce from "debounce-queue";
import webpack from "webpack";
import { merge as mergeConfigs } from "webpack-merge";
import nodeExternals from "webpack-node-externals";
import VirtualModulesPlugin from "webpack-virtual-modules";

import {
  createBaseConfig,
  createManifestFromStats,
  createUrl,
  getRouteExports,
} from "./compiler-utils.mjs";
import { readConfig } from "./config.mjs";

let require = createRequire(import.meta.url);

export async function build() {
  console.time("Build completed in");

  let remixConfig = await readConfig(process.cwd(), "production");

  let routeExports = await getRouteExports(remixConfig);
  let clientStatsPromise = compileClient(remixConfig, routeExports);

  let clientManifestPromise = clientStatsPromise.then(async (stats) =>
    createManifestFromStats(remixConfig, routeExports, stats)
  );

  let serverStatsPromise = compileServer(remixConfig, clientManifestPromise);

  let clientManifest = await clientManifestPromise;
  let clientManifestFileName = `manifest-${clientManifest.version.toUpperCase()}.js`;
  clientManifest.url = createUrl(
    remixConfig.publicPath,
    clientManifestFileName
  );

  fs.mkdirSync(remixConfig.assetsBuildDirectory, { recursive: true });
  fs.writeFileSync(
    path.resolve(remixConfig.assetsBuildDirectory, clientManifestFileName),
    `window.__remixManifest=${JSON.stringify(clientManifest)};`
  );

  let clientStats = await clientStatsPromise;
  if (clientStats.hasErrors()) {
    console.log(clientStats.toString({ errors: true }));
    throw new Error("Client build failed");
  }

  let serverStats = await serverStatsPromise;
  if (serverStats.hasErrors()) {
    console.log(clientStats.toString({ errors: true }));
    throw new Error("Server build failed");
  }

  console.timeEnd("Build completed in");

  let clientCompilationStats = clientStats.toJson();
  let serverCompilationStats = serverStats.toJson();
  let clientInputFiles = clientCompilationStats.modules
    .flatMap((mod) => mod.modules?.map((m) => m.nameForCondition) || [])
    .filter((f) => !!f);
  let serverInputFiles = serverCompilationStats.modules
    .flatMap((mod) => mod.modules?.map((m) => m.nameForCondition) || [])
    .filter((f) => !!f);
  let inputFiles = [...new Set([...clientInputFiles, ...serverInputFiles])];

  return { inputFiles, remixConfig };
}

export async function watch() {
  let { inputFiles, remixConfig } = await build();

  async function rebuild() {
    let { inputFiles } = await build();
    delete require.cache[require.resolve(remixConfig.serverBuildPath)];
    watcher.add(inputFiles);
  }

  let watcher = chokidar.watch(
    [path.join(remixConfig.appDirectory, "**/*"), ...inputFiles],
    {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100,
      },
    }
  );
  watcher.on(
    "all",
    debounce(async (debounced) => {
      let shouldRebuild = false;
      for (let [event] of debounced) {
        switch (event) {
          case "add":
          case "change":
          case "unlink":
          case "unlink":
            shouldRebuild = true;
            break;
        }
        if (shouldRebuild) break;
      }

      if (shouldRebuild) {
        await rebuild();
      }
    })
  );

  return { remixConfig };
}

/**
 * @param {import("./config-types").RemixWebpackConfig} remixConfig
 * @param {Record<string, Set<string>>} routeExports
 */
async function compileClient(remixConfig, routeExports) {
  let routeEntries = Object.entries(remixConfig.routes).reduce(
    (acc, [id, route]) => {
      acc[id] = path.join(remixConfig.appDirectory, route.file);
      return acc;
    },
    {}
  );
  let entry = {
    ...routeEntries,
    "entry.client": path.resolve(
      remixConfig.appDirectory,
      remixConfig.entryClientFile
    ),
  };

  let config = mergeConfigs(await createBaseConfig(remixConfig), {
    cache: {
      type: "filesystem",
      name: "client",
    },
    entry,
    experiments: { outputModule: true },
    externalsType: "module",
    output: {
      filename: "[name]-[contenthash].js",
      chunkFilename: "[name]-[contenthash].js",
      library: { type: "module" },
      chunkFormat: "module",
      chunkLoading: "import",
      module: true,
      path: remixConfig.assetsBuildDirectory,
      publicPath: remixConfig.publicPath,
    },
    resolve: {
      mainFields: ["browser", "module", "main"],
      exportsFields: ["browser", "module", "main"],
    },
    optimization: {
      runtimeChunk: "single",
      splitChunks: {
        chunks: "all",
        minSize: 0,
        maxSize: 250000,
      },
    },
    module: {
      rules: [
        {
          test: (modulePath) => {
            return (
              modulePath.startsWith(
                path.join(remixConfig.appDirectory, "routes")
              ) ||
              modulePath.startsWith(
                path.join(remixConfig.appDirectory, "root.")
              )
            );
          },
          loader: require.resolve("./compiler-client-routes-loader.cjs"),
          options: {
            remixConfig,
            routeExports,
          },
        },
      ],
    },
  });

  if (remixConfig.webpack) {
    config =
      (await remixConfig.webpack(config, {
        buildFor: "client",
        mode: remixConfig.mode,
        webpack,
      })) || config;
  }

  return asyncWebpack(config);
}

/**
 * @param {import("./config-types").RemixWebpackConfig} remixConfig
 * @param {Promise<import("@remix-run/dev/compiler/assets").AssetsManifest>} clientManifestPromise
 */
async function compileServer(remixConfig, clientManifestPromise) {
  let serverEntry = `
    import * as entryServer from ${JSON.stringify(
      path.resolve(remixConfig.appDirectory, remixConfig.entryServerFile)
    )};
    ${Object.keys(remixConfig.routes)
      .map((key, index) => {
        let route = remixConfig.routes[key];
        return `import * as route${index} from ${JSON.stringify(
          path.resolve(remixConfig.appDirectory, route.file)
        )};`;
      })
      .join("\n")}

    export { default as assets } from "@remix-run/dev/assets-manifest";

    export const entry = { module: entryServer };
    export const routes = {
      ${Object.keys(remixConfig.routes)
        .map((key, index) => {
          let route = remixConfig.routes[key];
          return `${JSON.stringify(key)}: {
        id: ${JSON.stringify(route.id)},
        parentId: ${JSON.stringify(route.parentId)},
        path: ${JSON.stringify(route.path)},
        index: ${JSON.stringify(route.index)},
        caseSensitive: ${JSON.stringify(route.caseSensitive)},
        module: route${index}
      }`;
        })
        .join(",\n  ")}
    };
  `;

  let isModule = remixConfig.type === "module";

  let config = mergeConfigs(await createBaseConfig(remixConfig), {
    cache: {
      type: "filesystem",
      name: "server",
    },
    entry: "entry.server.js",
    target: "node",
    devtool: "source-map",
    experiments: isModule ? { outputModule: true } : undefined,
    externalsType: isModule ? "module" : undefined,
    output: {
      filename: path.basename(remixConfig.serverBuildPath),
      library: { type: isModule ? "module" : "commonjs" },
      chunkFormat: isModule ? "module" : "commonjs",
      chunkLoading: isModule ? "import" : "require",
      module: isModule,
      path: path.dirname(remixConfig.serverBuildPath),
      publicPath: remixConfig.publicPath,
    },
    module: {
      rules: [
        {
          test: /@remix-run\/dev\/assets-manifest/,
          loader: require.resolve("./compiler-assets-manifest-loader.cjs"),
          options: { clientManifestPromise },
        },
      ],
    },
    externals: [
      nodeExternals({
        modulesDir: path.resolve(require.resolve("react-dom"), "../.."),
        allowlist: [
          "entry.server",
          "@remix-run/dev/server-build",
          "@remix-run/dev/assets-manifest",
        ],
        importType: isModule ? "import" : "commonjs",
      }),
    ],
    plugins: [
      new VirtualModulesPlugin({
        "node_modules/entry.server.js": `export * from "@remix-run/dev/server-build";`,
        "node_modules/@remix-run/dev/server-build": serverEntry,
        "node_modules/@remix-run/dev/assets-manifest": "",
      }),
      {
        /**
         * @param {webpack.Compiler} compiler
         */
        apply(compiler) {
          compiler.hooks.compilation.tap("NoEmitPlugin", (compilation) => {
            compilation.hooks.processAssets.tap(
              {
                name: "NoEmitPlugin",
                stage:
                  compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
                additionalAssets: true,
              },
              (assets) => {
                for (let [name] of Object.entries(assets)) {
                  if (
                    !name.endsWith(".js") &&
                    !name.endsWith(".mjs") &&
                    !name.endsWith(".cjs") &&
                    !name.endsWith(".js.map") &&
                    !name.endsWith(".mjs.map") &&
                    !name.endsWith(".cjs.map")
                  ) {
                    compilation.deleteAsset(name);
                  }
                }
              }
            );
          });
        },
      },
    ],
  });

  if (remixConfig.webpack) {
    config =
      (await remixConfig.webpack(config, {
        buildFor: "server",
        mode: remixConfig.mode,
        webpack,
      })) || config;
  }

  return asyncWebpack(config);
}

/**
 * @param {webpack.Configuration} config
 * @returns {Promise<webpack.Stats>}
 */
function asyncWebpack(config) {
  return new Promise((resolve, reject) => {
    webpack(config, (error, stats) => {
      if (error) return reject(error);
      return resolve(stats);
    });
  });
}
