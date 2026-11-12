"use client";

import { polarClient } from "@polar-sh/better-auth/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { type auth } from "~/lib/auth";

export const authClient = createAuthClient({
  // Not `~/env`: validating it here would ship zod (about 68 KB) to every
  // page that shows the header. The server validates the same variable.
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL,
  plugins: [polarClient(), inferAdditionalFields<typeof auth>()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
