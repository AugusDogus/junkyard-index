import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { env } from "~/env";
import { auth } from "~/lib/auth";
import { sendTestDM } from "~/lib/discord";
import { db } from "~/lib/db";
import { user } from "~/schema";

/**
 * Handle the OAuth callback after a user installs the Discord app.
 * This verifies the installation by sending a test DM, then marks the user as having installed the app.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  // Check for errors from Discord
  const error = searchParams.get("error");
  if (error) {
    const errorDescription = searchParams.get("error_description") || "Unknown error";
    console.error("Discord install error:", error, errorDescription);
    return NextResponse.redirect(
      new URL(`/settings?discord_error=${encodeURIComponent(errorDescription)}`, env.NEXT_PUBLIC_APP_URL)
    );
  }

  // Verify the code parameter is present (indicates successful OAuth flow)
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(
      new URL("/settings?discord_error=Invalid callback: missing authorization code", env.NEXT_PUBLIC_APP_URL)
    );
  }

  // Get the current session to identify the user
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    // User not logged in, redirect to sign in
    return NextResponse.redirect(
      new URL("/auth/sign-in?returnTo=/settings", env.NEXT_PUBLIC_APP_URL)
    );
  }

  // Check if user has a Discord account linked (discordId should be set from OAuth login)
  const [userRecord] = await db
    .select({ discordId: user.discordId })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  if (!userRecord?.discordId) {
    // User hasn't linked their Discord account via OAuth login
    return NextResponse.redirect(
      new URL("/settings?discord_error=Please sign in with Discord first to link your account", env.NEXT_PUBLIC_APP_URL)
    );
  }

  // Verify installation by attempting to send a test DM
  const testResult = await sendTestDM(userRecord.discordId, false);
  if (!testResult.success) {
    return NextResponse.redirect(
      new URL("/settings?discord_error=Could not send you a DM. Please make sure you've installed the app.", env.NEXT_PUBLIC_APP_URL)
    );
  }

  // Mark the user as having installed the Discord app
  await db
    .update(user)
    .set({ discordAppInstalled: true })
    .where(eq(user.id, session.user.id));

  // Redirect back to settings with success
  return NextResponse.redirect(
    new URL("/settings?discord_installed=true", env.NEXT_PUBLIC_APP_URL)
  );
}
