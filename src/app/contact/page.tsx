import { headers } from "next/headers";
import { ContactForm } from "~/components/contact/ContactForm";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { auth } from "~/lib/auth";

export default async function ContactPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return (
    <div className="bg-background min-h-screen">
      <Header />
      <main className="mx-auto max-w-xl px-4 py-12 sm:px-6 lg:px-8">
        <ContactForm initialEmail={session?.user?.email} />
      </main>
      <Footer />
    </div>
  );
}
