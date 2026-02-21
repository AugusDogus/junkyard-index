import {
  checkout,
  polar,
  portal,
  usage,
  webhooks,
} from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import { render } from "@react-email/components";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { PasswordReset } from "~/emails/PasswordReset";
import { env } from "~/env";
import { db } from "~/lib/db";
import posthog from "~/lib/posthog-server";
import * as schema from "~/schema";

const resend = new Resend(env.RESEND_API_KEY);

export const polarClient = new Polar({
  accessToken: env.POLAR_ACCESS_TOKEN,
});

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  baseURL: env.NEXT_PUBLIC_APP_URL,
  trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      const emailHtml = await render(PasswordReset({ resetUrl: url }));
      const emailText = await render(PasswordReset({ resetUrl: url }), {
        plainText: true,
      });

      await resend.emails.send({
        from: `Junkyard Index <${env.RESEND_FROM_EMAIL}>`,
        to: user.email,
        subject: "Reset your password",
        html: emailHtml,
        text: emailText,
      });
    },
  },
  socialProviders: {
    discord: {
      clientId: env.NEXT_PUBLIC_DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
    },
  },
  databaseHooks: {
    account: {
      create: {
        after: async (account) => {
          // When a user signs in with Discord OAuth, capture their Discord user ID
          // The accountId from Discord is the user's Discord ID
          if (account.providerId === "discord" && account.accountId) {
            await db
              .update(schema.user)
              .set({ discordId: account.accountId })
              .where(eq(schema.user.id, account.userId));
          }
        },
      },
    },
  },
  secret: env.BETTER_AUTH_SECRET,
  plugins: [
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({
          products: [
            {
              productId: env.POLAR_PRODUCT_ID,
              slug: "Email-Notifications",
            },
          ],
          successUrl: `${env.NEXT_PUBLIC_APP_URL}/search?subscription=success`,
          authenticatedUsersOnly: true,
        }),
        portal(),
        usage(),
        webhooks({
          secret: env.POLAR_WEBHOOK_SECRET,
          onSubscriptionCreated: async (payload) => {
            const externalId = payload.data.customer?.externalId;
            if (externalId) {
              posthog.capture({
                distinctId: externalId,
                event: "subscription_created",
              });
            }

            if (
              env.GOOGLE_ADS_CONVERSION_ID &&
              env.GOOGLE_ADS_CONVERSION_LABEL
            ) {
              try {
                const conversionUrl = new URL(
                  `https://www.googleadservices.com/pagead/conversion/${env.GOOGLE_ADS_CONVERSION_ID}/`,
                );
                conversionUrl.searchParams.set(
                  "label",
                  env.GOOGLE_ADS_CONVERSION_LABEL,
                );
                conversionUrl.searchParams.set("value", "1.0");
                conversionUrl.searchParams.set("currency", "USD");

                await fetch(conversionUrl.toString(), { method: "GET" });
              } catch (error) {
                console.error("Failed to send Google Ads conversion:", error);
              }
            }
          },
          onCustomerStateChanged: async (payload) => {
            const customerState = payload.data;
            const hasActiveSubscription =
              customerState.activeSubscriptions.length > 0;

            if (customerState.externalId) {
              posthog.capture({
                distinctId: customerState.externalId,
                event: "subscription_state_changed",
                properties: {
                  has_active_subscription: hasActiveSubscription,
                  active_subscription_count:
                    customerState.activeSubscriptions.length,
                },
              });
            }

            if (!hasActiveSubscription && customerState.externalId) {
              await db
                .update(schema.savedSearch)
                .set({ emailAlertsEnabled: false })
                .where(eq(schema.savedSearch.userId, customerState.externalId));
            }
          },
        }),
      ],
    }),
  ],
});
