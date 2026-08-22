import type { Metadata } from "next";
import { headers } from "next/headers";
import { PageShell } from "~/components/PageShell";
import { RequestYardForm } from "~/components/request-yard/RequestYardForm";
import { auth } from "~/lib/auth";

export const metadata: Metadata = {
  title: "Request a Yard",
  description:
    "Know a salvage yard we don't have yet? Submit a request and we'll look into adding it to Junkyard Index.",
};

export default async function RequestYardPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return (
    <PageShell>
      <RequestYardForm initialEmail={session?.user?.email} />
    </PageShell>
  );
}
