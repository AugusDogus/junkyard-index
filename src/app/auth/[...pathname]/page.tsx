"use client";

import { useParams } from "next/navigation";
import { AuthCard } from "~/components/auth/AuthCard";
import { SignInForm } from "~/components/auth/SignInForm";
import { SignUpForm } from "~/components/auth/SignUpForm";

export default function AuthPage() {
  const params = useParams<{ pathname: string[] }>();
  const pathname = params.pathname?.join("/") || "sign-in";

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      {pathname === "sign-up" ? (
        <AuthCard
          title="Create an account"
          description="Enter your information to get started"
        >
          <SignUpForm />
        </AuthCard>
      ) : (
        <AuthCard
          title="Sign in"
          description="Enter your email and password to continue"
        >
          <SignInForm />
        </AuthCard>
      )}
    </div>
  );
}
