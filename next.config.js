/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  images: {
    loader: "custom",
    loaderFile: "./src/lib/wsrvLoader.ts",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.lkqcorp.com",
      },
      {
        protocol: "https",
        hostname: "pypimages.azureedge.net",
      },
    ],
  },
};

export default config;
