import * as Sentry from "@sentry/nextjs";
import { render } from "@react-email/components";
import crypto from "crypto";
import { Resend } from "resend";
import { NewVehiclesAlert } from "~/emails/NewVehiclesAlert";
import { escapeHtml } from "~/lib/html";
import { env } from "~/env";
import type { NotificationDeliveryResult } from "~/lib/notification-delivery-result";
import type { SearchAlertDigest } from "~/lib/search-alert-data";

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

export function generateUserUnsubscribeToken(userId: string): string {
  const userTokenKey = crypto
    .createHmac("sha256", env.UNSUBSCRIBE_SECRET)
    .update("junkyard-index:user-unsubscribe:key")
    .digest();
  return crypto.createHmac("sha256", userTokenKey).update(userId).digest("hex");
}

function verifyToken(expectedToken: string, token: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    return false;
  }
  const tokenBuffer = Buffer.from(token, "hex");
  const expectedTokenBuffer = Buffer.from(expectedToken, "hex");
  return crypto.timingSafeEqual(tokenBuffer, expectedTokenBuffer);
}

/**
 * Verify an unsubscribe token is valid for a given search ID.
 */
export function verifyUnsubscribeToken(
  searchId: string,
  token: string,
): boolean {
  const expectedToken = generateUnsubscribeToken(searchId);
  return verifyToken(expectedToken, token);
}

export function verifyUserUnsubscribeToken(
  userId: string,
  token: string,
): boolean {
  return verifyToken(generateUserUnsubscribeToken(userId), token);
}

function buildUnsubscribeUrl(searchId: string): string {
  const token = generateUnsubscribeToken(searchId);
  return `${env.NEXT_PUBLIC_APP_URL}/unsubscribe?id=${encodeURIComponent(searchId)}&token=${token}`;
}

function buildOneClickUnsubscribeUrl(searchId: string): string {
  const token = generateUnsubscribeToken(searchId);
  return `${env.NEXT_PUBLIC_APP_URL}/api/unsubscribe?id=${encodeURIComponent(searchId)}&token=${token}`;
}

function buildUserUnsubscribeUrl(userId: string): string {
  const token = generateUserUnsubscribeToken(userId);
  return `${env.NEXT_PUBLIC_APP_URL}/api/unsubscribe-all?id=${encodeURIComponent(userId)}&token=${token}`;
}

export interface EmailDigestRecipient {
  userId: string;
  email: string;
}

export interface YardRequestNotification {
  yardName: string;
  website: string | null;
  requesterEmail: string | null;
  accountEmail: string | null;
}

/** Strips control characters that could break email subject headers. */
export function sanitizeEmailSubject(text: string): string {
  return text.replace(/[\r\n\t\f\v]+/g, " ");
}

export async function sendYardRequestNotification(
  input: YardRequestNotification,
): Promise<NotificationDeliveryResult> {
  try {
    const followUpEmail = input.requesterEmail ?? input.accountEmail;
    const subject = `Yard Request: ${sanitizeEmailSubject(input.yardName)}`;

    const { error } = await resend.emails.send({
      from: `Junkyard Index <${env.RESEND_FROM_EMAIL}>`,
      to: env.CONTACT_EMAIL,
      ...(followUpEmail ? { replyTo: followUpEmail } : {}),
      subject,
      text: [
        `Yard name: ${input.yardName}`,
        input.website ? `Website: ${input.website}` : "Website: (none)",
        `Follow-up email: ${followUpEmail ?? "(none)"}`,
        input.accountEmail
          ? `Submitted by account: ${input.accountEmail}`
          : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
      html: `
        <h2>New Yard Request</h2>
        <p><strong>Yard name:</strong> ${escapeHtml(input.yardName)}</p>
        <p><strong>Website:</strong> ${
          input.website ? escapeHtml(input.website) : "(none)"
        }</p>
        <p><strong>Follow-up email:</strong> ${
          followUpEmail ? escapeHtml(followUpEmail) : "(none)"
        }</p>
        ${
          input.accountEmail
            ? `<p><strong>Submitted by account:</strong> ${escapeHtml(input.accountEmail)}</p>`
            : ""
        }
      `,
    });

    if (error) {
      console.error("Failed to send yard request notification:", error);
      Sentry.captureException(error, {
        tags: { context: "yard-request-notification" },
        extra: { yardName: input.yardName },
      });
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error("Error sending yard request notification:", error);
    Sentry.captureException(error, {
      tags: { context: "yard-request-notification" },
      extra: { yardName: input.yardName },
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function sendEmailDigest(
  recipient: EmailDigestRecipient,
  digest: SearchAlertDigest,
  options?: { idempotencyKey?: string },
): Promise<NotificationDeliveryResult> {
  try {
    const emailAlerts = digest.previewAlerts.map((alert) => ({
      ...alert,
      unsubscribeUrl: buildUnsubscribeUrl(alert.searchId),
    }));
    const listUnsubscribeUrl =
      digest.alertCount === 1 && emailAlerts[0]
        ? buildOneClickUnsubscribeUrl(emailAlerts[0].searchId)
        : buildUserUnsubscribeUrl(recipient.userId);

    const emailComponent = NewVehiclesAlert({
      digest: {
        previewAlerts: emailAlerts,
        alertCount: digest.alertCount,
        vehicleCount: digest.vehicleCount,
      },
      manageSearchesUrl: `${env.NEXT_PUBLIC_APP_URL}/settings`,
    });

    const [emailHtml, emailText] = await Promise.all([
      render(emailComponent),
      render(emailComponent, { plainText: true }),
    ]);

    const { error } = await resend.emails.send(
      {
        from: `Junkyard Index <${env.RESEND_FROM_EMAIL}>`,
        to: recipient.email,
        subject: `Daily saved search update: ${digest.vehicleCount} new vehicle${digest.vehicleCount === 1 ? "" : "s"}`,
        html: emailHtml,
        text: emailText,
        headers: {
          "List-Unsubscribe": `<${listUnsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      },
      options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {},
    );

    if (error) {
      console.error("Failed to send email digest:", error);
      Sentry.captureException(error, {
        tags: { context: "email-digest", userId: recipient.userId },
        extra: {
          searchIds: digest.previewAlerts.map((alert) => alert.searchId),
          alertCount: digest.alertCount,
        },
      });
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error("Error sending email digest:", error);
    Sentry.captureException(error, {
      tags: { context: "email-digest", userId: recipient.userId },
      extra: {
        searchIds: digest.previewAlerts.map((alert) => alert.searchId),
        alertCount: digest.alertCount,
      },
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
