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
    ).toEqual(
      INGESTION_SOURCES.filter(
        (source) => source !== "upullrparts" && source !== "picknsave",
      ),
    );
  });

  test("keeps existing sources enabled when their flag is missing or unreadable", () => {
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
      ).toEqual(INGESTION_SOURCES.filter((source) => source !== "picknsave"));
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
  test("requires explicit enablement for the unqualified Pick-n-Save source", () => {
    expect(IngestionSourceFlags.resolve({})).not.toContain("picknsave");
    expect(
      IngestionSourceFlags.resolve({
        "ingestion-source-picknsave": {
          value: true,
          variantId: "on",
          reason: Reason.FALLTHROUGH,
        },
      }),
    ).toContain("picknsave");
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        IngestionSourceFlags.resolve({
          "ingestion-source-picknsave": {
            value: true,
            variantId: null,
            reason: Reason.ERROR,
            errorMessage: "Failed to get OIDC token",
          },
        }),
      ).not.toContain("picknsave");
    } finally {
      consoleError.mockRestore();
    }
  });
});
