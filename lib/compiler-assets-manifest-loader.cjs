module.exports = function assetsManifestLoader(content) {};

module.exports.pitch = async function assetsManifestLoaderPitch() {
  // @ts-expect-error
  let callback = this.async();
  // @ts-expect-error
  this.cacheable(false);
  // @ts-expect-error
  let { clientManifestPromise } = this.getOptions();
  clientManifestPromise =
    // @ts-expect-error
    this._compiler._clientManifestPromise || clientManifestPromise;

  /** @type {import("@remix-run/dev/compiler/assets").AssetsManifest} */
  let manifest = await clientManifestPromise;
  console.log(manifest.version, "build");

  callback(null, `export default ${JSON.stringify(manifest)};`);
};
