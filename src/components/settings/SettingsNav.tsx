"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
      <p className="mb-3 hidden text-sm font-medium lg:block">Settings</p>
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:overflow-visible lg:p-0">
        {SETTINGS_SECTIONS.map((section) => {
          const active = pathname === section.href;
          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-visible:ring-ring shrink-0 rounded-md px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 lg:w-full",
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
