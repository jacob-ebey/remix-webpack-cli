import type { Configuration } from "webpack";
import type { RemixConfig } from "@remix-run/dev/config";

export interface RemixWebpackConfig {
  appDirectory: string;
  assetsBuildDirectory: string;
  cacheDirectory: string;
  devServerPort: number;
  entryClientFile: string;
  entryServerFile: string;
  mode: "development" | "production";
  publicPath: string;
  rootDirectory: string;
  routes: RemixConfig["routes"];
  serverBuildPath: string;
  webpack?: (
    config: Configuration,
    {
      buildFor,
      mode,
    }: { buildFor: "client" | "server"; mode: "development" | "production" }
  ) => Promise<Configuration> | Configuration;
}
