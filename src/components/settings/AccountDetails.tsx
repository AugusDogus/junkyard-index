"use client";

import { Skeleton } from "~/components/ui/skeleton";
import { useSession } from "~/lib/auth-client";

export function AccountDetails() {
  const { data: session, isPending } = useSession();

  return (
    <section aria-labelledby="account-details-heading">
      <div className="max-w-2xl">
        <h2 id="account-details-heading" className="text-xl font-semibold">
          Account details
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          The identity associated with your saved searches and subscription.
        </p>
      </div>

      <dl className="border-border mt-6 divide-y border-y">
        <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
          <dt className="text-muted-foreground text-sm">Name</dt>
          <dd className="min-w-0 text-sm font-medium">
            {isPending ? (
              <Skeleton className="h-5 w-32" />
            ) : (
              session?.user.name || "Not provided"
            )}
          </dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
          <dt className="text-muted-foreground text-sm">Email</dt>
          <dd className="min-w-0 text-sm font-medium break-words">
            {isPending ? (
              <Skeleton className="h-5 w-52 max-w-full" />
            ) : (
              (session?.user.email ?? "Unavailable")
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
