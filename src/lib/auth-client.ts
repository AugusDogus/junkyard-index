"use client";

import { polarClient } from "@polar-sh/better-auth";
import { createAuthClient } from "better-auth/react";
import { env } from "~/env";

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : env.NEXT_PUBLIC_APP_URL,
  plugins: [polarClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;
