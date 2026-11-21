import { describe, expect, spyOn, test } from "bun:test";
import { Reason } from "@vercel/flags-core";
import {
  PublicationModeFlag,
  PublicationModeUnavailable,
} from "./publication-mode-flag";
import { SearchPublicationFlag } from "./search-publication-flag";

describe("PublicationModeFlag.resolve", () => {
  test("reads the two modes the flag serves", () => {
    expect(
      PublicationModeFlag.resolve(
        {
          value: "decoupled",
          variantId: "decoupled",
          reason: Reason.FALLTHROUGH,
        },
        true,
      ),
    ).toBe("decoupled");
    expect(
      PublicationModeFlag.resolve(
        {
          value: "inline",
          variantId: "inline",
          reason: Reason.FALLTHROUGH,
        },
        true,
      ),
    ).toBe("inline");
  });

  test("is unavailable, not inline, when the flag cannot be read or serves another value", () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        PublicationModeFlag.resolve(
          {
            value: "decoupled",
            variantId: null,
            reason: Reason.ERROR,
            errorMessage: "Failed to get OIDC token",
          },
          true,
        ),
      ).toBe("unavailable");
      expect(
        PublicationModeFlag.resolve(
          {
            value: true,
            variantId: "on",
            reason: Reason.FALLTHROUGH,
          },
          true,
        ),
      ).toBe("unavailable");
      expect(
        PublicationModeFlag.resolve(
          {
            value: "Decoupled",
            variantId: "on",
            reason: Reason.FALLTHROUGH,
          },
          true,
        ),
      ).toBe("unavailable");
      expect(consoleError).toHaveBeenCalledTimes(3);
      // A process that cannot read flags (tests, local scripts) stays inline.
      expect(
        PublicationModeFlag.resolve(
          {
            value: "inline",
            variantId: null,
            reason: Reason.ERROR,
            errorMessage: "Failed to get OIDC token",
          },
          false,
        ),
      ).toBe("inline");
      expect(consoleError).toHaveBeenCalledTimes(3);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("SearchPublicationFlag.publicationFor", () => {
  const skipFlag = (served: "inline" | "skipped") => {
    const reads: string[] = [];
    return {
      reads,
      read: async () => {
        reads.push("skip");
        return served;
      },
    };
  };

  test("decoupled publication wins over the skip flag", async () => {
    const skip = skipFlag("inline");
    expect(
      await SearchPublicationFlag.publicationFor("decoupled", skip.read),
    ).toBe("decoupled");
    expect(skip.reads).toEqual([]);
  });

  test("inline publication defers to the skip flag", async () => {
    expect(
      await SearchPublicationFlag.publicationFor(
        "inline",
        skipFlag("skipped").read,
      ),
    ).toBe("skipped");
    expect(
      await SearchPublicationFlag.publicationFor(
        "inline",
        skipFlag("inline").read,
      ),
    ).toBe("inline");
  });

  test("throws when the publication mode is unavailable, so the step retries without releasing or skipping", async () => {
    const skip = skipFlag("inline");
    await expect(
      SearchPublicationFlag.publicationFor("unavailable", skip.read),
    ).rejects.toBeInstanceOf(PublicationModeUnavailable);
    expect(skip.reads).toEqual([]);
  });
});
