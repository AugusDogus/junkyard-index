"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "~/lib/utils";
import { AdminLinkPending } from "./AdminLinkPending";

/**
 * The admin sections. Add a section here when its page exists; source
 * controls live on each source's page.
 */
const ADMIN_SECTIONS = [
  {
    href: "/admin",
    label: "Overview",
    description: "What needs attention",
  },
  {
    href: "/admin/sources",
    label: "Sources",
    description: "Every yard feed and its runs",
  },
  {
    href: "/admin/search",
    label: "Search & alerts",
    description: "Search updates and alert emails",
  },
  {
    href: "/admin/budgets",
    label: "Budgets",
    description: "Hyperbrowser credits and Algolia limits",
  },
  {
    href: "/admin/analytics",
    label: "Analytics",
    description: "Users, paid plans, saved searches",
  },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/admin"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin"
      className="min-w-0 lg:sticky lg:top-24 lg:self-start"
    >
      <p className="mb-4 font-medium">Admin</p>
      <div className="grid grid-cols-3 gap-1 rounded-lg border p-1 lg:grid-cols-1 lg:border-0 lg:p-0">
        {ADMIN_SECTIONS.map((section) => {
          const active = isActive(pathname, section.href);
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
              <span className="flex items-center justify-between gap-2">
                {section.label}
                <AdminLinkPending />
              </span>
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
