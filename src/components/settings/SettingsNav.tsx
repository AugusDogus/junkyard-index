"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

const SETTINGS_SECTIONS = [
  {
    href: "/settings/searches",
    label: "Searches",
    description: "Saved searches and location",
  },
  {
    href: "/settings/notifications",
    label: "Notifications",
    description: "Delivery channel setup",
  },
  {
    href: "/settings/billing",
    label: "Plan and billing",
    description: "Subscription and plan",
  },
  {
    href: "/settings/account",
    label: "Account",
    description: "Identity and access",
  },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings"
      className="min-w-0 lg:sticky lg:top-24 lg:self-start"
    >
      <div className="mb-4 flex items-center justify-between gap-4 lg:flex-col lg:items-start">
        <p className="font-semibold">Settings</p>
        <Button asChild variant="link" size="sm" className="px-0">
          <Link href="/search">
            <ArrowLeft data-icon="inline-start" />
            Back to search
          </Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg border p-1 lg:grid-cols-1 lg:border-0 lg:p-0">
        {SETTINGS_SECTIONS.map((section) => {
          const active = pathname === section.href;
          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-visible:ring-ring rounded-md px-3 py-3 text-sm outline-none transition-colors focus-visible:ring-2 lg:w-full",
                active
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <span className="block">{section.label}</span>
              <span className="text-muted-foreground mt-0.5 hidden text-xs leading-5 font-normal lg:block">
                {section.description}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
