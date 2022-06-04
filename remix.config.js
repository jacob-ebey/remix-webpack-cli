// import packageJson from "./package.json" assert { type: "json" };

/**
 * @type {Partial<import("./lib/config-types").RemixWebpackConfig>}
 */
let config = {
  webpack: (config, { buildFor, webpack }) => {
    // if (buildFor === "client") {
    //   config.plugins = config.plugins || [];
    //   config.plugins.push(
    //     new webpack.container.ModuleFederationPlugin({
    //       name: "abTests",
    //       shared: ["react", "react-dom"],
    //       exposes: {
    //         "./ab-counter": "./app/components/ab-counter.tsx",
    //       },
    //       library: { type: "module" },
    //       remoteType: "module",
    //       runtime:
    //         typeof config.optimization.runtimeChunk === "function"
    //           ? config.optimization.runtimeChunk()
    //           : config.optimization.runtimeChunk,
    //       filename: "ab-tests.[contenthash].js",
    //     })
    //   );
    // }

    return config;
  },
};

// module.exports = config;
export default config;
