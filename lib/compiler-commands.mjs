import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

import debounce from "debounce-queue";
import deepEqual from "deep-equal";
import webpack from "webpack";
import { merge as mergeConfigs } from "webpack-merge";
import nodeExternals from "webpack-node-externals";
import VirtualModulesPlugin from "webpack-virtual-modules";

import { EsmHmrEngine } from "./runtime-esm-hmr-server.mjs";

import {
  createBaseConfig,
  createManifestFromStats,
  createUrl,
  getRouteExports,
} from "./compiler-utils.mjs";
import { readConfig } from "./config.mjs";

let require = createRequire(import.meta.url);
let __filename = fileURLToPath(import.meta.url);
let __dirname = path.dirname(__filename);

let statsWarningFilters = ["node_modules/@remix-run/react/esm/routeModules.js"];

/**
 * @param {"development" | "production"} mode
 * @param {{ clientWebpackConfig?: webpack.Configuration; serverWebpackConfig?: webpack.Configuration }} args
 */
export async function build(
  mode,
  { clientWebpackConfig = {}, serverWebpackConfig = {} } = {}
) {
  console.time("Build completed in");

  let remixConfig = await readConfig(process.cwd(), mode);

  let routeExports = await getRouteExports(remixConfig);
  let clientCompilationPromise = compileClient(
    remixConfig,
    routeExports,
    clientWebpackConfig
  );

  let clientManifestPromise = clientCompilationPromise.then(async ({ stats }) =>
    createManifestFromStats(remixConfig, routeExports, stats)
  );

  let serverCompilationPromise = compileServer(
    remixConfig,
    clientManifestPromise,
    serverWebpackConfig
  );

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

  let { stats: clientStats } = await clientCompilationPromise;
  if (clientStats.hasErrors()) {
    console.log(
      clientStats.toString({
        colors: true,
        errors: true,
        logging: "warn",
        warningsFilter: statsWarningFilters,
      })
    );
    throw new Error("Client build failed");
  }

  let { stats: serverStats } = await serverCompilationPromise;
  if (serverStats.hasErrors()) {
    console.log(
      serverStats.toString({
        colors: true,
        errors: true,
        logging: "warn",
        warningsFilter: statsWarningFilters,
      })
    );
    throw new Error("Server build failed");
  }

  console.timeEnd("Build completed in");

  let clientCompilationStats = clientStats.toJson({
    modules: true,
  });
  let serverCompilationStats = serverStats.toJson({
    modules: true,
  });
  let clientInputFiles = clientCompilationStats.modules
    .flatMap((mod) => mod.modules?.map((m) => m.nameForCondition) || [])
    .filter((f) => !!f);
  let serverInputFiles = serverCompilationStats.modules
    .flatMap((mod) => mod.modules?.map((m) => m.nameForCondition) || [])
    .filter((f) => !!f);
  let inputFiles = [...new Set([...clientInputFiles, ...serverInputFiles])];

  return {
    inputFiles,
    remixConfig,
    clientManifest,
    clientCompilation: await clientCompilationPromise,
    serverCompilation: await serverCompilationPromise,
  };
}

export async function watch() {
  let {
    remixConfig,
    clientManifest: lastClientManifest,
    clientCompilation,
    serverCompilation,
  } = await build("development", {
    clientWebpackConfig: { watch: true, cache: false },
    serverWebpackConfig: { watch: true, cache: false },
  });

  let devServer = http.createServer();
  let hmrEngine = new EsmHmrEngine({ server: devServer });
  devServer.listen(remixConfig.devServerPort);

  let reloadBrowser = debounce(() => {
    hmrEngine.broadcastMessage({ type: "reload" });
  });

  let needsReload = false;

  clientCompilation.compiler.watching.handler = async (err, stats) => {
    if (err) {
      console.error(err);
      console.log("Client build failed");
      return;
    }
    if (stats.hasErrors()) {
      console.log(
        stats.toString({
          colors: true,
          errors: true,
          logging: "warn",
          warningsFilter: statsWarningFilters,
        })
      );
      console.log("Client build failed");
      return;
    }
    console.log("Client rebuilt");

    let routeExports = await getRouteExports(remixConfig);
    let clientManifest = createManifestFromStats(
      remixConfig,
      routeExports,
      stats
    );
    lastClientManifest = clientManifest;
    let clientManifestFileName = `manifest-${clientManifest.version.toUpperCase()}.js`;
    clientManifest.url = createUrl(
      remixConfig.publicPath,
      clientManifestFileName
    );

    /** @type {Object} */
    let assetManifestRule =
      serverCompilation.compiler.options.module.rules.find(
        (rule) =>
          typeof rule === "object" &&
          typeof rule.loader === "string" &&
          rule.loader.endsWith("/lib/compiler-assets-manifest-loader.cjs")
      );

    /** @type {VirtualModulesPlugin} */
    // @ts-expect-error
    let virtualModulesPlugin = serverCompilation.compiler.options.plugins.find(
      (plugin) => plugin instanceof VirtualModulesPlugin
    );

    let shouldReload = true;

    let cachedClientManifestPromise =
      // @ts-expect-error
      serverCompilation.compiler._clientManifestPromise;
    if (
      !deepEqual(
        (await cachedClientManifestPromise) ||
          (await assetManifestRule.options.clientManifestPromise),
        clientManifest
      )
    ) {
      shouldReload = false;
      fs.mkdirSync(remixConfig.assetsBuildDirectory, { recursive: true });
      fs.writeFileSync(
        path.resolve(remixConfig.assetsBuildDirectory, clientManifestFileName),
        `window.__remixManifest=${JSON.stringify(clientManifest)};`
      );
      // @ts-expect-error
      serverCompilation.compiler._clientManifestPromise =
        Promise.resolve(clientManifest);

      virtualModulesPlugin.writeModule(
        "node_modules/@remix-run/dev/assets-manifest",
        `${Date.now()}`
      );
      serverCompilation.compiler.watching.invalidate();
    }

    /** @type {Object} */
    let clientRoutesManifestRule =
      clientCompilation.compiler.options.module.rules.find(
        (rule) =>
          typeof rule === "object" &&
          typeof rule.loader === "string" &&
          rule.loader.endsWith("/lib/compiler-client-routes-loader.cjs")
      );

    // @ts-expect-error
    let cachedClientRoutes = clientCompilation.compiler._routeExports;
    if (
      !deepEqual(
        cachedClientRoutes || clientRoutesManifestRule.options.routeExports,
        routeExports
      )
    ) {
      shouldReload = false;
      // @ts-expect-error
      clientCompilation.compiler._routeExports = routeExports;
      clientCompilation.compiler.watching.invalidate();
    }

    if (needsReload && shouldReload) {
      reloadBrowser();
    } else {
      needsReload = true;
    }
  };

  serverCompilation.compiler.watching.handler = async (err, stats) => {
    if (err) {
      console.error(err);
      console.log("Server build failed");
      return;
    }
    if (stats.hasErrors()) {
      console.log(
        stats.toString({
          colors: true,
          errors: true,
          logging: "warn",
          warningsFilter: statsWarningFilters,
        })
      );
      console.log("Server build failed");
      return;
    }

    console.log("Server rebuilt");

    /** @type {Object} */
    let assetManifestRule =
      serverCompilation.compiler.options.module.rules.find(
        (rule) =>
          typeof rule === "object" &&
          typeof rule.loader === "string" &&
          rule.loader.endsWith("/lib/compiler-assets-manifest-loader.cjs")
      );

    let cachedClientManifestPromise =
      // @ts-expect-error
      serverCompilation.compiler._clientManifestPromise;
    if (
      needsReload &&
      deepEqual(
        (await cachedClientManifestPromise) ||
          (await assetManifestRule.options.clientManifestPromise),
        lastClientManifest
      )
    ) {
      needsReload = false;
      reloadBrowser();
    }
  };

  return { remixConfig };
}

/**
 * @param {import("./config-types").RemixWebpackConfig} remixConfig
 * @param {Record<string, Set<string>>} routeExports
 * @param {webpack.Configuration} webpackConfig
 */
async function compileClient(remixConfig, routeExports, webpackConfig = {}) {
  let routeEntries = Object.entries(remixConfig.routes).reduce(
    (acc, [id, route]) => {
      acc[id] = path.join(remixConfig.appDirectory, route.file);
      return acc;
    },
    {}
  );

  let clientEntry = path.resolve(
    remixConfig.appDirectory,
    remixConfig.entryClientFile
  );
  /** @type {Record<string, string | string[]>} */
  let entry = {
    ...routeEntries,
    "entry.client": clientEntry,
  };

  if (remixConfig.mode === "development") {
    entry["entry.client"] = [
      path.resolve(__dirname, "runtime-esm-hmr-client.mjs"),
      clientEntry,
    ];
  }

  let config = mergeConfigs(
    await createBaseConfig(remixConfig, "client"),
    {
      target: "web",
      cache: {
        type: "filesystem",
        name: "client-" + remixConfig.mode,
      },
      entry,
      experiments: { outputModule: true },
      externalsType: "module",
      output: {
        filename: "[name]-[contenthash].js",
        chunkFilename: "[name]-[contenthash].js",
        hotUpdateMainFilename: "hot-[runtime]-[fullhash].js",
        hotUpdateChunkFilename: "hot-[runtime]-[id]-[fullhash].js",
        library: { type: "module" },
        chunkFormat: "module",
        chunkLoading: "import",
        module: true,
        path: remixConfig.assetsBuildDirectory,
        publicPath: remixConfig.publicPath,
      },
      resolve: {
        mainFields: ["browser", "module", "main"],
        conditionNames: ["browser", "module", "main"],
        symlinks: true,
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
      plugins: [
        remixConfig.mode === "development" &&
          new webpack.DefinePlugin({
            "window.HMR_WEBSOCKET_URL": `(location.protocol === "http:" ? "ws://" : "wss://") + window.location.hostname + ":" + ${remixConfig.devServerPort}`,
          }),
        remixConfig.mode === "development" &&
          new (require("@pmmmwh/react-refresh-webpack-plugin"))({
            esModule: true,
          }),
        // remixConfig.mode === "development" &&
        //   new webpack.HotModuleReplacementPlugin(),
      ].filter(Boolean),
    },
    webpackConfig
  );

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
 * @param {webpack.Configuration} webpackConfig
 */
async function compileServer(
  remixConfig,
  clientManifestPromise,
  webpackConfig = {}
) {
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

  let config = mergeConfigs(
    await createBaseConfig(remixConfig, "server"),
    {
      cache: {
        type: "filesystem",
        name: "server-" + remixConfig.mode,
      },
      entry: "entry.server",
      target: "node",
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
      snapshot: {
        managedPaths: [],
        immutablePaths: [],
      },
      externals: [
        nodeExternals({
          modulesDir: path.resolve(require.resolve("react-dom"), "../.."),
          allowlist: [
            "entry.server",
            "@remix-run/dev/server-build",
            "@remix-run/dev/assets-manifest",
          ],
          // @ts-expect-error
          importType: isModule ? "import" : "commonjs",
        }),
      ],
      plugins: [
        new VirtualModulesPlugin({
          "node_modules/entry.server.js": `export * from "@remix-run/dev/server-build";`,
          "node_modules/@remix-run/dev/server-build": serverEntry,
          "node_modules/@remix-run/dev/assets-manifest": `${Date.now()}`,
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
    },
    webpackConfig
  );

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
 * @returns {Promise<{ compiler: webpack.Compiler; stats: webpack.Stats }>}
 */
function asyncWebpack(config) {
  return new Promise((resolve, reject) => {
    let compiler = webpack(config, (error, stats) => {
      if (error) return reject(error);
      return resolve({ compiler, stats });
    });
  });
}
