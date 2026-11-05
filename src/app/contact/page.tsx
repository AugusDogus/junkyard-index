import type { Metadata } from "next";
import { headers } from "next/headers";
import { ContactForm } from "~/components/contact/ContactForm";
import { PageShell } from "~/components/PageShell";
import { auth } from "~/lib/auth";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Questions, corrections, or a yard listing that looks wrong? Send Junkyard Index a message.",
  alternates: { canonical: "/contact" },
};

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
