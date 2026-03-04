import "dotenv/config";
import { playwright } from "@trigger.dev/build/extensions/playwright";
import { defineConfig } from "@trigger.dev/sdk";
import { env } from "./src/env.js";

export default defineConfig({
  project: env.TRIGGER_PROJECT_REF ?? "proj_mwdwhiathebztiodpnbr",
  dirs: ["./src/trigger"],
  runtime: "node-22",
  maxDuration: 4 * 60 * 60,
  build: {
    external: ["playwright-core", "playwright"],
    extensions: [
      playwright({ headless: false }),
    ],
  },
});
