import { Suspense } from "react";
import { FooterLinks } from "~/components/FooterLinks";
import { StatusChip } from "~/components/StatusChip";
import { env } from "~/env";

export function Footer() {
  const statusPageUrl = env.NEXT_PUBLIC_STATUS_PAGE_URL;

  return (
    <footer className="border-t px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <p className="text-sm font-semibold whitespace-nowrap">
          Junkyard Index
        </p>
        <FooterLinks />
        {statusPageUrl && (
          <Suspense fallback={null}>
            <StatusChip statusPageUrl={statusPageUrl} />
          </Suspense>
        )}
      </div>
    </footer>
  );
}
