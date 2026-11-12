import { describe, expect, spyOn, test } from "bun:test";
import { Reason } from "@vercel/flags-core";
import { IngestionSourceFlags } from "./ingestion-source-flags";

describe("IngestionSourceFlags.resolve", () => {
  test("preserves exactly the fourteen established default-enabled sources", () => {
    expect(IngestionSourceFlags.resolve({})).toEqual([
      "row52",
      "pyp",
      "autorecycler",
      "pullapart",
      "upullitne",
      "upullitdavie",
      "gopullit",
      "pullnsave",
      "tearapart",
      "wrenchapart",
      "upullrparts",
      "ipullupull",
      "upullitwa",
      "partsgalore",
    ]);
  });
  test.each([
    "aero",
    "chesterfield",
    "ddauto",
    "bigtruckpage",
    "beavers",
    "army",
    "alln1",
    "aviation",
    "awap",
    "aplus",
    "brandywine",
    "calton",
  ] as const)(
    "requires explicit enablement for %s before rollout",
    (source) => {
      expect(IngestionSourceFlags.resolve({})).not.toContain(source);
      expect(
        IngestionSourceFlags.resolve({
          [`ingestion-source-${source}`]: {
            value: true,
            variantId: "on",
            reason: Reason.FALLTHROUGH,
          },
        }),
      ).toContain(source);
      const consoleError = spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(
          IngestionSourceFlags.resolve({
            [`ingestion-source-${source}`]: {
              value: "true",
              variantId: "malformed",
              reason: Reason.FALLTHROUGH,
            },
          }),
        ).not.toContain(source);
        expect(
          IngestionSourceFlags.resolve({
            [`ingestion-source-${source}`]: {
              value: true,
              variantId: null,
              reason: Reason.ERROR,
              errorMessage: "Failed to get OIDC token",
            },
          }),
        ).not.toContain(source);
      } finally {
        consoleError.mockRestore();
      }
    },
  );
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
      IngestionSourceFlags.resolve({}).filter(
        (source) => source !== "upullrparts",
      ),
    );
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
      ).toEqual(IngestionSourceFlags.resolve({}));
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
});
