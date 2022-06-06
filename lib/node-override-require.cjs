let fs = require("fs");
let path = require("path");

let ogExtensions = require.extensions[".js"];
require.extensions[".js"] = (mod, filename) => {
  if (
    filename.endsWith("node_modules/webpack/lib/esm/ModuleChunkFormatPlugin.js")
  ) {
    let content = fs.readFileSync(
      path.resolve(__dirname, "webpack-module-chunk-format-plugin.cjs"),
      "utf8"
    );

    mod._compile(content, filename);
    return;
  }

  return ogExtensions(mod, filename);
};
