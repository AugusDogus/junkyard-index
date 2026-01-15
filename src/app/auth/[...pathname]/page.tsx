"use client";

import { useParams } from "next/navigation";
import { AuthCard } from "~/components/auth/AuthCard";
import { SignInForm } from "~/components/auth/SignInForm";
import { SignUpForm } from "~/components/auth/SignUpForm";

export default function AuthPage() {
  const params = useParams<{ pathname: string[] }>();
  const pathname = params.pathname?.join("/") || "sign-in";

  const isSignUp = pathname === "sign-up";
  const title = isSignUp ? "Create an account" : "Welcome back";
  const description = isSignUp
    ? "Enter your information to get started"
    : "Sign in to continue";

  return (
    <div className="flex min-h-svh flex-col sm:items-center sm:justify-center sm:p-4">
      {/* Mobile: Full-screen app-like layout */}
      <div className="flex flex-1 flex-col px-6 pb-8 pt-16 sm:hidden">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground mt-2">{description}</p>
        </div>
        <div className="flex-1">
          {isSignUp ? <SignUpForm /> : <SignInForm />}
        </div>
      </div>

      {/* Desktop: Centered card layout */}
      <div className="hidden sm:block">
        <AuthCard title={title} description={description}>
          {isSignUp ? <SignUpForm /> : <SignInForm />}
        </AuthCard>
      </div>
    </div>
  );
}
