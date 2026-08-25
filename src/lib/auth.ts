import { polar, portal, usage, webhooks } from "@polar-sh/better-auth";
import { render } from "@react-email/components";
import { betterAuth } from "better-auth";
import { APIError, getOAuthState } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous, oAuthProxy } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { PasswordReset } from "~/emails/PasswordReset";
import { env } from "~/env";
import { db } from "~/lib/db";
import { TERMS_METADATA } from "~/lib/legal";
import { polarClient } from "~/lib/polar";
import { TermsAcceptance } from "~/lib/terms-acceptance";
import * as schema from "~/schema";
import { transferAnonymousSearchUsage } from "~/server/auth/anonymous-search-usage-transfer";
import {
  handleCustomerStateChanged,
  handleSubscriptionCreated,
} from "~/server/billing/polar-webhooks";

const resend = new Resend(env.RESEND_API_KEY);

const productionURL = env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
  : env.NEXT_PUBLIC_APP_URL;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  baseURL: env.NEXT_PUBLIC_APP_URL,
  trustedOrigins: [
    env.NEXT_PUBLIC_APP_URL,
    productionURL,
    "https://*.vercel.app",
  ],
  user: {
    additionalFields: {
      termsAcceptedAt: {
        type: "date",
        required: false,
        input: false,
        returned: false,
      },
      termsVersion: {
        type: "string",
        required: true,
        input: true,
        returned: false,
      },
    },
  },
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
      redirectURI: `${productionURL}/api/auth/callback/discord`,
      disableImplicitSignUp: true,
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => {
          if (newUser.isAnonymous === true) {
            return { data: newUser };
          }
          const acceptedCurrentTerms =
            await TermsAcceptance.isAcceptedAtAuthBoundary({
              directVersion: newUser.termsVersion,
              readOAuthState: getOAuthState,
            });

          if (!acceptedCurrentTerms) {
            throw new APIError("BAD_REQUEST", {
              message: "You must accept the current Terms of Service.",
            });
          }

          return {
            data: {
              ...newUser,
              termsAcceptedAt: new Date(),
              termsVersion: TERMS_METADATA.version,
            },
          };
        },
      },
      update: {
        before: async (updatedUser) => {
          if (TermsAcceptance.attemptsAcceptanceUpdate(updatedUser)) {
            throw new APIError("BAD_REQUEST", {
              message: "Terms acceptance records cannot be changed.",
            });
          }
        },
      },
    },
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
    oAuthProxy({ productionURL }),
    anonymous({
      disableDeleteAnonymousUser: true,
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        await transferAnonymousSearchUsage({
          database: db,
          anonymousUserId: anonymousUser.user.id,
          newUserId: newUser.user.id,
        });
        await db
          .delete(schema.user)
          .where(eq(schema.user.id, anonymousUser.user.id));
      },
    }),
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        portal(),
        usage(),
        webhooks({
          secret: env.POLAR_WEBHOOK_SECRET,
          onSubscriptionCreated: handleSubscriptionCreated,
          onCustomerStateChanged: handleCustomerStateChanged,
        }),
      ],
    }),
  ],
});
