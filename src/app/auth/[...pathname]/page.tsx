"use client";

import { Analytics } from "~/lib/analytics";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import { ForgotPasswordForm } from "~/components/auth/ForgotPasswordForm";
import { ResetPasswordForm } from "~/components/auth/ResetPasswordForm";
import { SignInForm } from "~/components/auth/SignInForm";
import { SignUpForm } from "~/components/auth/SignUpForm";
import { AnalyticsEvents } from "~/lib/analytics-events";

type AuthRoute = "sign-in" | "sign-up" | "forgot-password" | "reset-password";

const routeConfig: Record<
  AuthRoute,
  { title: string; description: string; Form: React.ComponentType }
> = {
  "sign-in": {
    title: "Welcome back",
    description: "Sign in to continue tracking your searches.",
    Form: SignInForm,
  },
  "sign-up": {
    title: "Create your free account",
    description:
      "See full results and track inventory across salvage yard networks.",
    Form: SignUpForm,
  },
  "forgot-password": {
    title: "Forgot password",
    description: "Enter your email to receive a reset link",
    Form: ForgotPasswordForm,
  },
  "reset-password": {
    title: "Reset password",
    description: "Enter your new password",
    Form: ResetPasswordForm,
  },
};

export default function AuthPage() {
  const params = useParams<{ pathname: string[] }>();
  const pathname = params.pathname?.join("/") || "sign-in";
  const config =
    Object.entries(routeConfig).find(([route]) => route === pathname)?.[1] ??
    routeConfig["sign-in"];
  const { title, description, Form } = config;

  useEffect(() => {
    if (pathname === "sign-in") {
      Analytics.capture(AnalyticsEvents.SIGN_IN_VIEWED, {
        source_page: "auth",
      });
    }

    if (pathname === "sign-up") {
      Analytics.capture(AnalyticsEvents.SIGN_UP_VIEWED, {
        source_page: "auth",
      });
    }
  }, [pathname]);

  return (
    <AuthCard title={title} description={description}>
      <Form />
    </AuthCard>
  );
}
