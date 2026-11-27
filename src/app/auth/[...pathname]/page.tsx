import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { sitePageUrl } from "~/lib/site-metadata";
import { AuthCard } from "~/components/auth/AuthCard";
import { ForgotPasswordForm } from "~/components/auth/ForgotPasswordForm";
import { ResetPasswordForm } from "~/components/auth/ResetPasswordForm";
import { SignedInRedirect } from "~/components/auth/SignedInRedirect";
import { SignInForm } from "~/components/auth/SignInForm";
import { SignUpForm } from "~/components/auth/SignUpForm";

// Every header links here with its page as the return path, so crawlers
// request a new URL per page. The pages read nothing from the request:
// the CDN serves one prerender per route whatever the query, and the forms
// read the return path in the browser.
export const dynamicParams = true;

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
    description: "Track inventory across salvage yard networks.",
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
}

export function generateStaticParams(): { pathname: string[] }[] {
  return Object.keys(routeConfig).map((route) => ({ pathname: [route] }));
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
  return { title: titles[route], ...sitePageUrl(`/auth/${route}`) };
}

export default async function AuthPage({ params }: AuthPageProps) {
  const route = getRoute((await params).pathname);
  const { title, description, Form } = routeConfig[route];
  const signInOrUp = route === "sign-in" || route === "sign-up";
  return (
    <PublicPageShell>
      {signInOrUp && <SignedInRedirect />}
      <AuthCard
        title={title}
        description={description}
        view={signInOrUp ? route : undefined}
      >
        {/* The reset form reads its token from the URL, so it renders in
        the browser. */}
        {route === "reset-password" ? (
          <Suspense>
            <Form />
          </Suspense>
        ) : (
          <Form />
        )}
      </AuthCard>
    </PublicPageShell>
  );
}
