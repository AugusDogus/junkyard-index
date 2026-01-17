import * as Sentry from "@sentry/nextjs";
import { render } from "@react-email/components";
import crypto from "crypto";
import { Resend } from "resend";
import { NewVehiclesAlert } from "~/emails/NewVehiclesAlert";
import { env } from "~/env";
import type { Vehicle } from "~/lib/types";

const resend = new Resend(env.RESEND_API_KEY);

/**
 * Generate an HMAC signature for a search ID.
 * This creates a unique, verifiable token for each search.
 */
export function generateUnsubscribeToken(searchId: string): string {
  return crypto
    .createHmac("sha256", env.UNSUBSCRIBE_SECRET)
    .update(searchId)
    .digest("hex");
}

/**
 * Verify an unsubscribe token is valid for a given search ID.
 */
export function verifyUnsubscribeToken(searchId: string, token: string): boolean {
  const expectedToken = generateUnsubscribeToken(searchId);
  // Check length first to avoid timingSafeEqual throwing on mismatched lengths
  if (token.length !== expectedToken.length) {
    return false;
  }
  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(token),
    Buffer.from(expectedToken)
  );
}

function buildUnsubscribeUrl(searchId: string): string {
  const token = generateUnsubscribeToken(searchId);
  return `${env.NEXT_PUBLIC_APP_URL}/unsubscribe?id=${searchId}&token=${token}`;
}

export interface EmailAlertData {
  searchName: string;
  query: string;
  newVehicles: Vehicle[];
  searchUrl: string;
  searchId: string;
}

export async function sendEmailAlert(
  to: string,
  data: EmailAlertData
): Promise<{ success: boolean; error?: string }> {
  try {
    // Generate unsubscribe URL for this specific search
    const unsubscribeUrl = buildUnsubscribeUrl(data.searchId);

    // Create the email component once
    const emailComponent = NewVehiclesAlert({
      searchName: data.searchName,
      query: data.query,
      newVehicles: data.newVehicles,
      searchUrl: data.searchUrl,
      unsubscribeUrl,
    });

    // Render HTML and plain text in parallel
    const [emailHtml, emailText] = await Promise.all([
      render(emailComponent),
      render(emailComponent, { plainText: true }),
    ]);

    const { error } = await resend.emails.send({
      from: `Junkyard Index <${env.RESEND_FROM_EMAIL}>`,
      to,
      subject: `New vehicles found: ${data.searchName}`,
      html: emailHtml,
      text: emailText,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    if (error) {
      console.error("Failed to send email alert:", error);
      Sentry.captureException(error, {
        tags: { context: "email-alert", searchId: data.searchId },
      });
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error("Error sending email alert:", error);
    Sentry.captureException(error, {
      tags: { context: "email-alert", searchId: data.searchId },
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
