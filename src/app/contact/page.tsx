import { Suspense } from "react";
import { headers } from "next/headers";
import { ContactForm } from "~/components/contact/ContactForm";
import { Footer } from "~/components/Footer";
import { StaticHeader } from "~/components/StaticHeader";
import { auth } from "~/lib/auth";

export default async function ContactPage() {
  return (
    <div className="bg-background min-h-screen">
      <StaticHeader />
      <main className="mx-auto max-w-xl px-4 py-12 sm:px-6 lg:px-8">
        <Suspense fallback={<ContactForm />}>
          <PersonalizedContactForm />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}

async function PersonalizedContactForm() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return <ContactForm initialEmail={session?.user?.email} />;
}
