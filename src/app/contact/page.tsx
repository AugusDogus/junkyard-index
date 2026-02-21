import { ContactForm } from "~/components/contact/ContactForm";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";

export default function ContactPage() {
  return (
    <div className="bg-background min-h-screen">
      <Header />
      <main className="mx-auto max-w-xl px-4 py-12 sm:px-6 lg:px-8">
        <ContactForm />
      </main>
      <Footer />
    </div>
  );
}
