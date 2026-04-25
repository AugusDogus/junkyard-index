"use client";

import posthog from "posthog-js";
import { useParams } from "next/navigation";
import { Suspense, useEffect } from "react";
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
      "See full results, save searches, and track inventory across salvage yard networks.",
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
  return (
    <Suspense fallback={<AuthPageFallback />}>
      <AuthPageContent />
    </Suspense>
  );
}

function AuthPageContent() {
  const params = useParams<{ pathname: string[] }>();
  const pathname = (params.pathname?.join("/") || "sign-in") as AuthRoute;

  const config = routeConfig[pathname] || routeConfig["sign-in"];
  const { title, description, Form } = config;

  useEffect(() => {
    if (pathname === "sign-in") {
      posthog.capture(AnalyticsEvents.SIGN_IN_VIEWED, {
        source_page: "auth",
      });
    }

    if (pathname === "sign-up") {
      posthog.capture(AnalyticsEvents.SIGN_UP_VIEWED, {
        source_page: "auth",
      });
    }
  }, [pathname]);

  return (
    <div className="flex min-h-svh flex-col sm:items-center sm:justify-center sm:p-4">
      {/* Mobile: Full-screen app-like layout */}
      <div className="flex flex-1 flex-col px-6 pt-16 pb-8 sm:hidden">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground mt-2">{description}</p>
        </div>
        <div className="flex-1">
          <Form />
        </div>
      </div>

      {/* Desktop: Centered card layout */}
      <div className="hidden sm:block">
        <AuthCard title={title} description={description}>
          <Form />
        </AuthCard>
      </div>
    </div>
  );
}

function AuthPageFallback() {
  return (
    <div className="flex min-h-svh flex-col sm:items-center sm:justify-center sm:p-4">
      <div className="flex flex-1 flex-col px-6 pt-16 pb-8 sm:hidden">
        <div className="bg-muted mb-4 h-9 w-48 rounded" />
        <div className="bg-muted h-5 w-64 rounded" />
      </div>
      <div className="bg-card hidden w-full max-w-md rounded-lg border p-8 sm:block">
        <div className="bg-muted mx-auto mb-3 h-8 w-40 rounded" />
        <div className="bg-muted mx-auto h-4 w-56 rounded" />
      </div>
    </div>
  );
}
