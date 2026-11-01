import { describe, expect, spyOn, test } from "bun:test";
import { Reason } from "@vercel/flags-core";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import { IngestionSourceFlags } from "./ingestion-source-flags";

describe("IngestionSourceFlags.resolve", () => {
  test("leaves out sources whose flag serves false", () => {
    expect(
      IngestionSourceFlags.resolve({
        "ingestion-source-upullrparts": {
          value: false,
          variantId: "off",
          reason: Reason.FALLTHROUGH,
        },
        "ingestion-source-pyp": {
          value: true,
          variantId: "on",
          reason: Reason.FALLTHROUGH,
        },
      }),
    ).toEqual(INGESTION_SOURCES.filter((source) => source !== "upullrparts"));
  });

  test("keeps sources enabled when their flag is missing or unreadable", () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        IngestionSourceFlags.resolve({
          "ingestion-source-upullrparts": {
            value: true,
            variantId: null,
            reason: Reason.ERROR,
            errorMessage: "Failed to get OIDC token",
          },
          "ingestion-source-pyp": {
            value: "off",
            variantId: "off",
            reason: Reason.FALLTHROUGH,
          },
        }),
      ).toEqual([...INGESTION_SOURCES]);
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
});
