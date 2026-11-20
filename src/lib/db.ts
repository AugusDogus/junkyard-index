import { createClient } from "@libsql/client/web";
import { drizzle } from "drizzle-orm/libsql/web";
import { env } from "~/env";

export const dbClient = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(dbClient);
