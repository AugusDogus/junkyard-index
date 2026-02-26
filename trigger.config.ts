import "dotenv/config";
import { defineConfig } from "@trigger.dev/sdk";
import { env } from "./src/env.js";

export default defineConfig({
  project: env.TRIGGER_PROJECT_REF ?? "proj_mwdwhiathebztiodpnbr",
  dirs: ["./src/trigger"],
  runtime: "node-22",
  maxDuration: 4 * 60 * 60,
});
