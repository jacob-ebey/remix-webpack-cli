module.exports = function assetsManifestLoader(content) {
  return content;
};

module.exports.pitch = async function assetsManifestLoaderPitch() {
  // @ts-expect-error
  let callback = this.async();
  // @ts-expect-error
  let { clientManifestPromise } = this.getOptions();
  /** @type {import("@remix-run/dev/compiler/assets").AssetsManifest} */
  let manifest = await clientManifestPromise;

  callback(null, `export default ${JSON.stringify(manifest)};`);
};
