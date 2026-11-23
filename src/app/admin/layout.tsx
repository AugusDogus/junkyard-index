import type { ReactNode } from "react";
import { AdminNav } from "~/components/admin/AdminNav";
import { AppProviders } from "~/components/AppProviders";
import { PageShell } from "~/components/PageShell";
import { adminMetadata, requireAdmin } from "~/server/admin/require-admin";

// Every request checks the session; nothing here is cached or prerendered.
export const dynamic = "force-dynamic";

// For non-admins this and every admin page's metadata add nothing, so their
// 404 carries the same title and tags as any other missing page. Throwing
// here instead would drop them all.
export function generateMetadata() {
  return adminMetadata({
    title: { default: "Admin", template: "%s | Admin" },
    robots: { index: false, follow: false },
  });
}

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAdmin();
  return (
    <AppProviders>
      <PageShell width="workspace">
        <div className="grid min-w-0 gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16">
          <AdminNav />
          <div className="min-w-0">{children}</div>
        </div>
      </PageShell>
    </AppProviders>
  );
}
