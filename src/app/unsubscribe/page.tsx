import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "~/lib/db";
import { verifyUnsubscribeToken } from "~/lib/email";
import { savedSearch } from "~/schema";

interface UnsubscribePageProps {
  searchParams: Promise<{ id?: string; token?: string; done?: string }>;
}

export default async function UnsubscribePage({
  searchParams,
}: UnsubscribePageProps) {
  const { id: searchId, token, done } = await searchParams;

  // Validate token using HMAC verification
  const isValidToken =
    searchId && token && verifyUnsubscribeToken(searchId, token);

  // Success state after unsubscribing
  if (done === "1" && isValidToken) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="mb-4 text-2xl font-semibold text-green-600">
          ✓ Unsubscribed
        </h1>
        <p className="text-muted-foreground mb-8">
          You have been unsubscribed from this alert.
        </p>
        <Link
          href="/"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-6 py-3"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  // Invalid link
  if (!isValidToken) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="mb-4 text-2xl font-semibold">Invalid Link</h1>
        <p className="text-muted-foreground mb-8">
          This unsubscribe link is invalid or has expired.
        </p>
        <Link
          href="/"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-6 py-3"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  // Get the search
  const search = await db
    .select({
      name: savedSearch.name,
      emailAlertsEnabled: savedSearch.emailAlertsEnabled,
    })
    .from(savedSearch)
    .where(eq(savedSearch.id, searchId))
    .limit(1);

  if (!search[0]) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="mb-4 text-2xl font-semibold">Not Found</h1>
        <p className="text-muted-foreground mb-8">
          This saved search no longer exists.
        </p>
        <Link
          href="/"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-6 py-3"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  // Already unsubscribed
  if (!search[0].emailAlertsEnabled) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="mb-4 text-2xl font-semibold">✓ Already Unsubscribed</h1>
        <p className="text-muted-foreground mb-8">
          You have already unsubscribed from alerts for &quot;{search[0].name}
          &quot;.
        </p>
        <Link
          href="/"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-6 py-3"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  // Show confirmation with form
  async function unsubscribe() {
    "use server";
    // Re-validate token in server action (server actions can be called independently)
    if (!searchId || !token || !verifyUnsubscribeToken(searchId, token)) {
      redirect("/unsubscribe");
    }
    await db
      .update(savedSearch)
      .set({ emailAlertsEnabled: false })
      .where(eq(savedSearch.id, searchId));
    redirect(`/unsubscribe?id=${searchId}&token=${token}&done=1`);
  }

  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="mb-4 text-2xl font-semibold">Unsubscribe</h1>
      <p className="text-muted-foreground mb-8">
        Are you sure you want to unsubscribe from alerts for &quot;
        {search[0].name}&quot;?
      </p>
      <form action={unsubscribe} className="inline">
        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 mr-2 rounded px-6 py-3"
        >
          Unsubscribe
        </button>
      </form>
      <Link
        href="/"
        className="bg-muted text-muted-foreground hover:bg-muted/90 rounded px-6 py-3"
      >
        Cancel
      </Link>
    </div>
  );
}
