import { headers } from "next/headers";
import { ContactForm } from "~/components/contact/ContactForm";
import { PageShell } from "~/components/PageShell";
import { auth } from "~/lib/auth";

export default async function ContactPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return (
    <PageShell>
      <ContactForm initialEmail={session?.user.email} />
    </PageShell>
  );
}
