import { type Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { SubscriptionCheckoutForm } from "~/components/subscription/SubscriptionCheckoutForm";
import { auth } from "~/lib/auth";
import {
  parseSubscriptionSelection,
  subscriptionReturnTo,
} from "~/lib/subscription-selection";

export const metadata: Metadata = {
  title: "Subscribe to Alerts",
  robots: { index: false, follow: false },
};

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const selection = parseSubscriptionSelection({
    tier: params.tier,
    interval: params.interval,
  });
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect(
      `/auth/sign-in?returnTo=${encodeURIComponent(subscriptionReturnTo(selection))}`,
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <Header />
      <main className="mx-auto max-w-xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-3xl font-bold tracking-tight">
          Subscribe to alerts
        </h1>
        <p className="text-muted-foreground mb-8">
          Review the renewal terms before continuing to secure checkout.
        </p>
        <SubscriptionCheckoutForm selection={selection} />
      </main>
      <Footer />
    </div>
  );
}
