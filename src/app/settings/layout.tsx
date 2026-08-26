import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PageShell } from "~/components/PageShell";
import { SettingsNav } from "~/components/settings/SettingsNav";
import { auth } from "~/lib/auth";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export default async function SettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/auth/sign-in?returnTo=%2Fsettings%2Fsearches");
  }

  return (
    <PageShell width="workspace">
      <div className="grid min-w-0 gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16">
        <SettingsNav />
        <div className="min-w-0">{children}</div>
      </div>
    </PageShell>
  );
}
