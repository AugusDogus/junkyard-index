import type { Config } from "drizzle-kit";

function requiredDatabaseEnvironment(
  name: "TURSO_DATABASE_URL" | "TURSO_AUTH_TOKEN",
): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required to run database schema commands. Configure the production Turso credentials and retry.`,
    );
  }
  return value;
}

export default {
  schema: "./schema.ts",
  dialect: "turso",
  dbCredentials: {
    url: requiredDatabaseEnvironment("TURSO_DATABASE_URL"),
    authToken: requiredDatabaseEnvironment("TURSO_AUTH_TOKEN"),
  },
} satisfies Config;
