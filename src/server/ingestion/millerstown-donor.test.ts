import { describe, expect, it } from "bun:test";
import { MillerstownDonor } from "./millerstown-donor";
import { parseMillerstownPdf } from "./millerstown-pdf";
import {
  millerstownOracleFixture,
  millerstownPdfFixture,
} from "./millerstown-test-fixtures";

describe("Millerstown native donor semantics", () => {
  for (const field of ["make", "model"] as const)
    it(`rejects unavailable required ${field} while preserving valid identity`, async () => {
      const first = (await millerstownOracleFixture()).rawRecords[0];
      if (!first) throw new Error("Missing golden donor");
      for (const missing of ["N/A", "n/a", " N/A "])
        expect(
          MillerstownDonor.parse({ ...first.raw, [field]: missing }),
        ).toMatchObject({
          status: "incomplete",
          vin: "JH4DC4456YS013792",
          reasons: [
            field === "make" ? "missing-source-make" : "missing-source-model",
          ],
        });
    });
  it("keeps a donor with optional unavailable color and returns canonical null", async () => {
    const first = (await millerstownOracleFixture()).rawRecords[0];
    if (!first) throw new Error("Missing golden donor");
    for (const color of ["N/A", "n/a", " N/A "])
      expect(MillerstownDonor.parse({ ...first.raw, color })).toMatchObject({
        status: "available",
        vehicle: { vin: "JH4DC4456YS013792", color: null },
      });
  });
  it("matches every raw cell, canonical field, rejection and presence identity", async () => {
    const records = await parseMillerstownPdf(await millerstownPdfFixture());
    const expected = await millerstownOracleFixture();
    // The oracle comes from an independent extraction of the trimmed PDF.
    expect(records).toEqual(expected.rawRecords);
    const vehicles = [];
    const rejections = [];
    const presence = [];
    const rejectedPresence = [];
    for (const record of records) {
      const result = MillerstownDonor.parse(record.raw);
      if (result.status === "available") {
        vehicles.push(result.vehicle);
        presence.push(result.vehicle.vin);
      } else {
        rejections.push({
          provenance: record.provenance,
          vin: result.vin,
          reasons: result.reasons,
        });
        if (result.vin !== null) {
          presence.push(result.vin);
          rejectedPresence.push(result.vin);
        }
      }
    }
    expect(vehicles).toEqual(expected.canonical);
    expect(rejections).toEqual(expected.rejections);
    expect(presence).toEqual(expected.presence);
    expect(rejectedPresence).toEqual(expected.rejectedPresence);
    expect(
      vehicles
        .filter((vehicle) => vehicle.stockNumber === "2609078")
        .map((vehicle) => vehicle.vin),
    ).toEqual(["1HGCP267X8A086479", "JF1SG65657H729410"]);
    expect(
      vehicles
        .filter((vehicle) => vehicle.vin.length !== 17)
        .map((vehicle) => [vehicle.vin, vehicle.year]),
    ).toEqual([["1412202500", 1972]]);
    const first = records[0];
    if (!first) throw new Error("Missing golden donor");
    const optional = MillerstownDonor.parse({
      ...first.raw,
      stock: "",
      color: "",
      engine: "N/A",
      transmission: "N/A",
      trim: "",
    });
    expect(optional.status).toBe("available");
    if (optional.status === "available")
      expect(optional.vehicle).toMatchObject({
        stockNumber: null,
        color: null,
        engine: null,
        transmission: null,
        trim: null,
        imageUrl: null,
        availableDate: null,
        section: null,
        row: null,
        space: null,
      });
    expect(MillerstownDonor.parse({ ...first.raw, year: "" })).toMatchObject({
      status: "incomplete",
      reasons: ["invalid-source-year"],
    });
    expect(MillerstownDonor.parse({ ...first.raw, model: "" })).toMatchObject({
      status: "incomplete",
      vin: "JH4DC4456YS013792",
      reasons: ["missing-source-model"],
    });
  });
});
