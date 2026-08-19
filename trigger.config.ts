import "dotenv/config";
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_mwdwhiathebztiodpnbr",
  dirs: ["./src/trigger"],
  runtime: "node-22",
  maxDuration: 4 * 60 * 60,
  build: {
    external: ["playwright-core"],
  },
});
