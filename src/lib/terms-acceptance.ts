import { TERMS_METADATA } from "~/lib/legal";

function isCurrentVersion(version: unknown): boolean {
  return version === TERMS_METADATA.version;
}

function isCurrentOAuthState(state: unknown): boolean {
  if (
    typeof state !== "object" ||
    state === null ||
    !("termsVersion" in state)
  ) {
    return false;
  }

  return isCurrentVersion(state.termsVersion);
}

async function isAcceptedAtAuthBoundary(input: {
  directVersion: unknown;
  readOAuthState(): Promise<unknown>;
}): Promise<boolean> {
  if (isCurrentVersion(input.directVersion)) return true;
  return isCurrentOAuthState(await input.readOAuthState());
}

function attemptsAcceptanceUpdate(fields: object): boolean {
  return "termsAcceptedAt" in fields || "termsVersion" in fields;
}

export const TermsAcceptance = {
  attemptsAcceptanceUpdate,
  isAcceptedAtAuthBoundary,
  isCurrentVersion,
  isCurrentOAuthState,
};
