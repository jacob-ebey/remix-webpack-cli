import { createRequire } from "module";
import * as os from "os";
import * as path from "path";
import * as url from "url";

import * as esbuild from "esbuild";
import { ESBuildMinifyPlugin } from "esbuild-loader";
import * as tsconfig from "tsconfig";
import webpack from "webpack";

let require = createRequire(import.meta.url);

let rules = [
  {
    test: /\.js$/,
    loader: "esbuild-loader",
    options: {
      loader: "js",
      target: "esnext",
    },
  },
  {
    test: /\.jsx$/,
    loader: "esbuild-loader",
    options: {
      loader: "jsx",
      target: "esnext",
    },
  },
  {
    test: /\.ts$/,
    loader: "esbuild-loader",
    options: {
      loader: "ts",
      target: "esnext",
    },
  },
  {
    test: /\.tsx$/,
    loader: "esbuild-loader",
    options: {
      loader: "tsx",
      target: "esnext",
    },
  },
  {
    test: /\.css$/,
    type: "asset/resource",
  },
];

/**
 * @param {import("./config-types").RemixWebpackConfig} remixConfig
 * @returns {Promise<webpack.Configuration>}
 */
export async function createBaseConfig(remixConfig) {
  /** @type {"development" | "production"} */
  let mode = remixConfig.mode;

  let alias = undefined;
  let tsConfigPath = await tsconfig.find(remixConfig.rootDirectory);
  if (typeof tsConfigPath === "string" && tsConfigPath) {
    let tsConfig = await tsconfig.readFile(tsConfigPath);

    if (
      tsConfig &&
      tsConfig.compilerOptions &&
      tsConfig.compilerOptions.baseUrl &&
      tsConfig.compilerOptions.paths
    ) {
      let baseUrl = path.resolve(
        path.dirname(tsConfigPath),
        tsConfig.compilerOptions.baseUrl
      );
      let paths = tsConfig.compilerOptions.paths;

      alias = {
        react: path.join(
          path.dirname(require.resolve("react")),
          "cjs",
          mode === "development"
            ? "react.development.js"
            : "react.production.min.js"
        ),
        "react-dom/client": path.join(
          path.dirname(require.resolve("react-dom")),
          "client.js"
        ),
        "react-dom": path.join(
          path.dirname(require.resolve("react-dom")),
          "cjs",
          mode === "development"
            ? "react-dom.development.js"
            : "react-dom.production.min.js"
        ),
        "@remix-run/react": path.join(
          path.dirname(require.resolve("@remix-run/react")),
          "esm/index.js"
        ),
      };
      Object.keys(paths).forEach((item) => {
        const key = item.replace("/*", "");
        const value = path.resolve(
          baseUrl,
          paths[item][0].replace("/*", "").replace("*", "")
        );

        alias[key] = value;
      });
    }
  }

  return {
    mode,
    devtool: mode === "development" ? "eval-cheap-module-source-map" : false,
    resolve: {
      extensions: [".js", ".jsx", ".ts", ".tsx"],
      alias,
    },
    module: {
      rules,
    },
    optimization: {
      moduleIds: "deterministic",
      minimizer: [
        new ESBuildMinifyPlugin({
          target: "esnext",
        }),
      ],
      usedExports: true,
      removeEmptyChunks: true,
      concatenateModules: true,
      minimize: true,
    },
    plugins: [
      new webpack.EnvironmentPlugin({
        REMIX_DEV_SERVER_WS_PORT: JSON.stringify(remixConfig.devServerPort),
      }),
    ],
    cache: {
      type: "filesystem",
      buildDependencies: {
        defaultWebpack: ["webpack/lib/"],
        config: [
          url.fileURLToPath(import.meta.url),
          path.join(remixConfig.rootDirectory, "remix.config.js"),
        ],
        app: [createUrl(remixConfig.appDirectory + "/")],
      },
      cacheDirectory: path.join(remixConfig.cacheDirectory, "webpack"),
    },
  };
}

/**
 *
 * @param {webpack.StatsCompilation} stats
 * @param {string} publicPath
 */
function createNamedChunkGroupFactory(stats, publicPath) {
  let chunksById = new Map(stats.chunks.map((chunk) => [chunk.id, chunk]));
  return (group) => {
    let files = new Set();
    stats.namedChunkGroups[group].chunks.forEach((chunkId) => {
      let chunk = chunksById.get(chunkId);
      if (chunk?.files) {
        chunk.files.forEach((file) => files.add(createUrl(publicPath, file)));
      }
    });
    return [...files];
  };
}

/**
 * @param {import("./config-types").RemixWebpackConfig} remixConfig
 * @returns {Promise<Record<string, Set<string>>>}
 */
export async function getRouteExports(remixConfig) {
  let esbuildResult = await esbuild.build({
    sourceRoot: remixConfig.appDirectory,
    entryPoints: Object.values(remixConfig.routes).map((route) =>
      path.resolve(remixConfig.appDirectory, route.file)
    ),
    bundle: false,
    metafile: true,
    write: false,
    outdir: os.tmpdir(),
  });

  if (esbuildResult.errors?.length > 0) {
    throw new Error(
      await (
        await esbuild.formatMessages(esbuildResult.errors, { kind: "error" })
      ).join("\n")
    );
  }

  let exportsMap = Object.values(esbuildResult.metafile.outputs).reduce(
    (acc, output) => {
      let entrypoint = output.entryPoint
        ?.replace(/^app\//, "")
        .replace(/\.[jt]sx?$/, "");
      if (entrypoint) {
        acc[entrypoint] = new Set(output.exports);
      }
      return acc;
    },
    {}
  );

  return exportsMap;
}

/**
 *
 * @param {import("./config-types").RemixWebpackConfig} remixConfig
 * @param {Record<string, Set<string>>} routeExports
 * @param {webpack.Stats} stats
 * @returns {import("@remix-run/dev/compiler/assets").AssetsManifest}
 */
export function createManifestFromStats(remixConfig, routeExports, stats) {
  let compilationStats = stats.toJson();
  let getByNamedChunkGroup = createNamedChunkGroupFactory(
    compilationStats,
    remixConfig.publicPath
  );

  /** @type {string[]} */
  let entryImports = getByNamedChunkGroup("entry.client");
  let entryModule = createUrl(
    remixConfig.publicPath,
    compilationStats.entrypoints["entry.client"].assets[
      compilationStats.entrypoints["entry.client"].assets.length - 1
    ].name
  );
  /** @type {string[]} */
  let rootImports = getByNamedChunkGroup("root");
  /** @type {string[]} */
  let runtimeImports = compilationStats.assetsByChunkName["runtime"].map(
    (asset) => createUrl(remixConfig.publicPath, asset)
  );

  let routes = Object.entries(remixConfig.routes).reduce(
    (acc, [routeId, route]) => {
      let routeImports = compilationStats.entrypoints[routeId].assets
        .slice(0, -1)
        .map((asset) => createUrl(remixConfig.publicPath, asset.name));
      let routeModule = createUrl(
        remixConfig.publicPath,
        compilationStats.entrypoints[routeId].assets[
          compilationStats.entrypoints[routeId].assets.length - 1
        ].name
      );

      acc[routeId] = {
        id: route.id,
        parentId: route.parentId,
        path: route.path,
        index: route.index,
        caseSensitive: route.caseSensitive,
        module: routeModule,
        imports: routeImports,
        hasAction: routeExports[routeId].has("action"),
        hasLoader: routeExports[routeId].has("loader"),
        hasCatchBoundary: routeExports[routeId].has("CatchBoundary"),
        hasErrorBoundary: routeExports[routeId].has("ErrorBoundary"),
      };
      return acc;
    },
    {}
  );

  return {
    entry: {
      imports: [
        ...new Set([...runtimeImports, ...entryImports, ...rootImports]),
      ],
      module: entryModule,
    },
    routes,
    version: compilationStats.hash,
  };
}

export function createUrl(publicPath, file) {
  return (
    publicPath.split(path.win32.sep).join("/") +
    (file || "").split(path.win32.sep).join("/")
  );
}
