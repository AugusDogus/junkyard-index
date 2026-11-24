import type { Metadata } from "next";
import { ContactForm } from "~/components/contact/ContactForm";
import { PageShell } from "~/components/PageShell";
import { sitePageUrl } from "~/lib/site-metadata";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Questions, corrections, or a yard listing that looks wrong? Send Junkyard Index a message.",
  ...sitePageUrl("/contact"),
};

export default function ContactPage() {
  return (
    <PageShell rendering="static">
      <ContactForm />
    </PageShell>
  );
}
