import { headers } from "next/headers";
import { PageShell } from "~/components/PageShell";
import { RequestYardForm } from "~/components/request-yard/RequestYardForm";
import { auth } from "~/lib/auth";

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
