"use client";

import posthog from "posthog-js";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { signIn } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { DiscordIcon } from "~/components/ui/icons";
import { AlertCircle, Eye, EyeOff } from "lucide-react";

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDiscordLoading, setIsDiscordLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    posthog.capture(AnalyticsEvents.SIGN_IN_SUBMITTED, { method: "email" });

    try {
      const result = await signIn.email({
        email,
        password,
      });

      if (result.error) {
        posthog.capture(AnalyticsEvents.SIGN_IN_FAILED, {
          method: "email",
          error: result.error.message ?? "unknown",
        });
        setError(result.error.message || "Failed to sign in");
      } else {
        posthog.identify(result.data?.user?.id, {
          email: result.data?.user?.email,
          name: result.data?.user?.name,
        });
        posthog.capture(AnalyticsEvents.SIGN_IN_SUCCEEDED, { method: "email" });
        router.push(returnTo || "/search");
        router.refresh();
      }
    } catch (err) {
      console.error("Sign in error:", err);
      posthog.capture(AnalyticsEvents.SIGN_IN_FAILED, {
        method: "email",
        error: "unexpected",
      });
      setError("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDiscordSignIn = async () => {
    setError(null);
    setIsDiscordLoading(true);
    posthog.capture(AnalyticsEvents.DISCORD_SIGN_IN_INITIATED, {
      context: "sign_in",
    });

    try {
      await signIn.social({
        provider: "discord",
        callbackURL: returnTo || "/search",
      });
    } catch (err) {
      console.error("Discord sign in error:", err);
      setError("An unexpected error occurred");
      setIsDiscordLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="john.doe@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={isLoading}
          tabIndex={1}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/auth/forgot-password"
            className="text-muted-foreground text-sm hover:underline"
            tabIndex={5}
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
            className="pr-10"
            tabIndex={2}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
            tabIndex={-1}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={isLoading || isDiscordLoading}
        tabIndex={3}
      >
        {isLoading ? "Signing in..." : "Sign In"}
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background text-muted-foreground px-2">
            Or continue with
          </span>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleDiscordSignIn}
        disabled={isLoading || isDiscordLoading}
        tabIndex={4}
      >
        <DiscordIcon className="mr-2 h-4 w-4" />
        {isDiscordLoading ? "Connecting..." : "Discord"}
      </Button>

      <div className="text-muted-foreground text-center text-sm">
        Don't have an account?{" "}
        <Link
          href={
            returnTo
              ? `/auth/sign-up?returnTo=${encodeURIComponent(returnTo)}`
              : "/auth/sign-up"
          }
          className="text-primary hover:underline"
          tabIndex={6}
        >
          Sign up
        </Link>
      </div>
    </form>
  );
}
