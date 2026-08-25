"use client";

import { polarClient } from "@polar-sh/better-auth";
import {
  anonymousClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { env } from "~/env";
import { type auth } from "~/lib/auth";

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : env.NEXT_PUBLIC_APP_URL,
  plugins: [
    anonymousClient(),
    polarClient(),
    inferAdditionalFields<typeof auth>(),
  ],
});

export const { useSession, signIn, signUp, signOut } = authClient;
