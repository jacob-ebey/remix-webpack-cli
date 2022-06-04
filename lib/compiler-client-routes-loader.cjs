let path = require("path");
let esbuild = require("esbuild");

let browserSafeRouteExports = {
  CatchBoundary: true,
  ErrorBoundary: true,
  default: true,
  handle: true,
  links: true,
  meta: true,
  unstable_shouldReload: true,
};

module.exports = function clientRoutesLoader(content) {
  return content;
};

module.exports.pitch = async function clientRoutesLoaderPitch() {
  // @ts-expect-error
  let callback = this.async();
  // @ts-expect-error
  let options = this.getOptions();
  /** @type {import("@remix-run/dev/config").RemixConfig} */
  let remixConfig = options.remixConfig;
  /** @type {Record<string, Set<string>>} */
  let routeExports = options.routeExports;
  /** @type {string} */
  // @ts-expect-error
  let resourcePath = this.resourcePath;

  let [routeId] = Object.entries(remixConfig.routes).find(
    ([, route]) =>
      path.resolve(remixConfig.appDirectory, route.file) === resourcePath
  );

  let theExports = [...routeExports[routeId]].filter(
    (ex) => !!browserSafeRouteExports[ex]
  );

  let contents = "module.exports = {};";
  if (theExports.length !== 0) {
    let spec = `{ ${theExports.join(", ")} }`;
    contents = `export ${spec} from ${JSON.stringify(resourcePath)};`;
  }

  let buildResult = await esbuild.build({
    stdin: { contents, resolveDir: remixConfig.rootDirectory },
    format: "esm",
    target: "es2018",
    bundle: true,
    treeShaking: true,
    write: false,
    plugins: [
      {
        name: "externals",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === resourcePath) return undefined;

            return { external: true, sideEffects: false };
          });
        },
      },
    ],
  });
  callback(undefined, buildResult.outputFiles[0].text);
};
