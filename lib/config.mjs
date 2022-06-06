import * as fsp from "fs/promises";
import { createRequire } from "module";
import * as path from "path";

import getPort from "get-port";
import flatRoutes from "remix-flat-routes";

let require = createRequire(import.meta.url);

let configExtensions = [".js", ".cjs", ".mjs"];
let entryExtensions = [".js", ".jsx", ".ts", ".tsx"];

/** @typedef {import("@remix-run/dev/config").RemixConfig} */

let devServerPortPromise = getPort({ port: 8002 });

async function findFile(searchDir, baseName, extensions) {
  for (let extension of extensions) {
    let filePath = path.resolve(searchDir, baseName + extension);
    if (
      await fsp
        .stat(filePath)
        .then((s) => s.isFile())
        .catch(() => false)
    ) {
      return filePath;
    }
  }
}

/**
 *
 * @param {string} rootDirectory
 * @param {"development" | "production"} mode
 * @returns {Promise<import("./config-types").RemixWebpackConfig>}
 */
export async function readConfig(rootDirectory, mode) {
  let configPath = "";
  for (let extension of configExtensions) {
    let filePath = path.resolve(rootDirectory, "remix.config" + extension);
    if (
      await fsp
        .stat(filePath)
        .then((s) => s.isFile())
        .catch(() => false)
    ) {
      configPath = filePath;
      break;
    }
  }

  let packageJson = require(path.resolve(rootDirectory, "package.json"));

  /** @type {import("@remix-run/dev/config").AppConfig & { type?: "module" | "commonjs" }} */
  let appConfig = {};
  if (configPath) {
    let userConfig = await import(configPath);
    appConfig = userConfig.default || userConfig || {};
  }

  let appDirectory = appConfig.appDirectory
    ? path.resolve(rootDirectory, appConfig.appDirectory)
    : path.resolve(rootDirectory, "app");

  let assetsBuildDirectory = appConfig.assetsBuildDirectory
    ? path.resolve(rootDirectory, appConfig.assetsBuildDirectory)
    : path.resolve(rootDirectory, "public/build");

  let cacheDirectory = appConfig.cacheDirectory
    ? path.resolve(rootDirectory, appConfig.cacheDirectory)
    : path.resolve(rootDirectory, ".cache");

  let publicPath = appConfig.publicPath ? appConfig.publicPath : "/build/";

  let serverBuildPath = appConfig.serverBuildPath
    ? path.resolve(rootDirectory, appConfig.serverBuildPath)
    : path.resolve(rootDirectory, "build/index.js");

  let entryClientFile = await findFile(
    appDirectory,
    "entry.client",
    entryExtensions
  );
  if (!entryClientFile) {
    throw new Error("No entry.client file found in " + appDirectory);
  }
  let entryServerFile = await findFile(
    appDirectory,
    "entry.server",
    entryExtensions
  );
  if (!entryServerFile) {
    throw new Error("No entry.server file found in " + appDirectory);
  }
  let rootRouteFile = await findFile(appDirectory, "root", entryExtensions);
  if (!rootRouteFile) {
    throw new Error("No root file found in " + appDirectory);
  }

  let routes = flatRoutes.flatRoutes("routes", defineRoutes);
  routes.root = {
    path: "",
    id: "root",
    file: path.relative(appDirectory, rootRouteFile),
  };
  if (appConfig.routes) {
    let manualRoutes = await appConfig.routes(defineRoutes);
    for (let key of Object.keys(manualRoutes)) {
      let route = manualRoutes[key];
      routes[route.id] = { ...route, parentId: route.parentId || "root" };
    }
  }

  return {
    appDirectory,
    assetsBuildDirectory,
    cacheDirectory,
    devServerPort: await devServerPortPromise,
    entryClientFile,
    entryServerFile,
    mode,
    publicPath,
    serverBuildPath,
    type: appConfig.type || packageJson.type,
    rootDirectory,
    routes,
    // @ts-expect-error
    webpack: appConfig.webpack,
  };
}

/**
 * A function for defining routes programmatically, instead of using the
 * filesystem convention.
 */
export function defineRoutes(callback) {
  let routes = Object.create(null);
  let parentRoutes = [];
  let alreadyReturned = false;

  let defineRoute = (path, file, optionsOrChildren, children) => {
    if (alreadyReturned) {
      throw new Error(
        "You tried to define routes asynchronously but started defining " +
          "routes before the async work was done. Please await all async " +
          "data before calling `defineRoutes()`"
      );
    }

    let options;
    if (typeof optionsOrChildren === "function") {
      // route(path, file, children)
      options = {};
      children = optionsOrChildren;
    } else {
      // route(path, file, options, children)
      // route(path, file, options)
      options = optionsOrChildren || {};
    }

    let route = {
      path: path ? path : undefined,
      index: options.index ? true : undefined,
      caseSensitive: options.caseSensitive ? true : undefined,
      id: createRouteId(file),
      parentId:
        parentRoutes.length > 0
          ? parentRoutes[parentRoutes.length - 1].id
          : undefined,
      file,
    };

    routes[route.id] = route;

    if (children) {
      parentRoutes.push(route);
      children();
      parentRoutes.pop();
    }
  };

  callback(defineRoute);

  alreadyReturned = true;

  return routes;
}

function createRouteId(file) {
  return normalizeSlashes(stripFileExtension(file));
}

function normalizeSlashes(file) {
  return file.split(path.win32.sep).join("/");
}

function stripFileExtension(file) {
  return file.replace(/\.[a-z0-9]+$/i, "");
}
