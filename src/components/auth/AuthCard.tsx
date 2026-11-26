"use client";

import { useEffect } from "react";
import { Analytics } from "~/lib/analytics";
import { AnalyticsEvents } from "~/lib/analytics-events";

interface AuthCardProps {
  title: string;
  description: string;
  children: React.ReactNode;
  view?: "sign-in" | "sign-up";
}

export function AuthCard({
  title,
  description,
  children,
  view,
}: AuthCardProps) {
  useEffect(() => {
    if (!view) return;
    Analytics.capture(
      view === "sign-in"
        ? AnalyticsEvents.SIGN_IN_VIEWED
        : AnalyticsEvents.SIGN_UP_VIEWED,
      { source_page: "auth" },
    );
  }, [view]);

  return (
    <section className="border-rule-strong bg-paper-3 mx-auto w-full max-w-md border p-6 sm:p-8">
      <div className="mb-8 space-y-3">
        <h1 className="text-ink text-2xl leading-tight font-medium tracking-tight">
          {title}
        </h1>
        <p className="text-ink-2 text-sm leading-relaxed">{description}</p>
      </div>
      {children}
    </section>
  );
}
