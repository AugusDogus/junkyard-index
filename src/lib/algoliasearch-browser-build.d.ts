// The browser build of the lite client, which client bundles resolve
// `algoliasearch/lite` to. Tests import it by path to get its response cache.
declare module "algoliasearch/dist/lite/builds/browser" {
  export { liteClient } from "algoliasearch/lite";
}
