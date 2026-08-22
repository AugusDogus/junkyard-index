import { Polar } from "@polar-sh/sdk";
import { env } from "~/env";

// Owns the singleton Polar SDK client so billing modules can use it without
// importing the Better Auth instance (avoids circular imports with auth.ts).
export const polarClient = new Polar({
  accessToken: env.POLAR_ACCESS_TOKEN,
});
