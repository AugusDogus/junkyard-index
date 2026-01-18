import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";

interface PasswordResetProps {
  resetUrl: string;
}

export function PasswordReset({ resetUrl }: PasswordResetProps) {
  const previewText = "Reset your Junkyard Index password";

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Tailwind>
        <Body className="bg-gray-100 font-sans">
          <Container className="mx-auto max-w-[600px] bg-white px-5 py-10">
            <Heading className="m-0 mb-5 border-b-2 border-gray-200 pb-2.5 text-2xl font-semibold text-gray-900">
              Reset Your Password
            </Heading>

            <Text className="m-0 mb-5 text-base text-gray-700">
              We received a request to reset your password for your Junkyard Index account.
              Click the button below to set a new password:
            </Text>

            <Section className="my-8 text-center">
              <Button
                href={resetUrl}
                className="inline-block rounded bg-gray-900 px-6 py-3 text-base font-medium text-white no-underline"
              >
                Reset Password
              </Button>
            </Section>

            <Text className="m-0 mb-5 text-sm text-gray-600">
              This link will expire in 1 hour. If you didn&apos;t request a password reset,
              you can safely ignore this email.
            </Text>

            <Hr className="my-8 border-gray-200" />

            <Text className="m-0 text-xs text-gray-500">
              If the button above doesn&apos;t work, copy and paste this link into your browser:
            </Text>
            <Text className="m-0 mt-2 break-all text-xs text-gray-500">
              <Link href={resetUrl} className="text-gray-900 underline">
                {resetUrl}
              </Link>
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default PasswordReset;
