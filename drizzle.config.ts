import type { Config } from "drizzle-kit";
import { env } from "./src/env";

export default {
  schema: "./schema.ts",
  dialect: "turso",
  dbCredentials: {
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  },
} satisfies Config;