import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { auth } from "~/lib/auth";
import { ReturnTo } from "~/lib/return-to";
import { AuthCard } from "~/components/auth/AuthCard";
import { ForgotPasswordForm } from "~/components/auth/ForgotPasswordForm";
import { ResetPasswordForm } from "~/components/auth/ResetPasswordForm";
import { SignInForm } from "~/components/auth/SignInForm";
import { SignUpForm } from "~/components/auth/SignUpForm";

type AuthRoute = "sign-in" | "sign-up" | "forgot-password" | "reset-password";

const routeConfig: Record<
  AuthRoute,
  { title: string; description: string; Form: React.ComponentType }
> = {
  "sign-in": {
    title: "Sign in to Junkyard Index",
    description: "Sign in to continue tracking your searches.",
    Form: SignInForm,
  },
  "sign-up": {
    title: "Create your Junkyard Index account",
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

interface AuthPageProps {
  params: Promise<{ pathname: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getRoute(pathname: string[]): AuthRoute {
  return (
    Object.keys(routeConfig).find(
      (route): route is AuthRoute => route === pathname.join("/"),
    ) ?? "sign-in"
  );
}

export async function generateMetadata({
  params,
}: AuthPageProps): Promise<Metadata> {
  const route = getRoute((await params).pathname);
  const titles: Record<AuthRoute, string> = {
    "sign-in": "Sign in",
    "sign-up": "Create an account",
    "forgot-password": "Forgot password",
    "reset-password": "Reset password",
  };
  return { title: titles[route] };
}

export default async function AuthPage({
  params,
  searchParams,
}: AuthPageProps) {
  const route = getRoute((await params).pathname);
  if (route === "sign-in" || route === "sign-up") {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session) {
      const returnTo = ReturnTo.parse((await searchParams).returnTo);
      // Unknown auth routes also fall back to sign-in, so exclude the whole shell.
      redirect(returnTo.startsWith("/auth/") ? "/search" : returnTo);
    }
  }

  const { title, description, Form } = routeConfig[route];
  return (
    <PublicPageShell>
      <AuthCard
        title={title}
        description={description}
        view={route === "sign-in" || route === "sign-up" ? route : undefined}
      >
        <Form />
      </AuthCard>
    </PublicPageShell>
  );
}
