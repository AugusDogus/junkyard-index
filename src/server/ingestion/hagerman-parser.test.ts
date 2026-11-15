import { describe, expect, test } from "bun:test";
import {
  HagermanCatalog,
  HagermanDonor,
  HagermanProfile,
} from "./hagerman-parser";
import { hagermanFixture } from "./hagerman-test-fixtures";
import { HagermanCensus } from "./hagerman-catalog";
import {
  assessHagermanDonor,
  transformHagermanDonor,
} from "./hagerman-transform";
import { HAGERMAN_COORDINATES } from "./hagerman-yard-metadata";

describe("Hagerman actual native bodies", () => {
  test("complete donor membership is separate from retail truck sales", () => {
    const page = HagermanCatalog.parse(hagermanFixture("catalog"));
    expect(page.total).toBe(5);
    expect(page.members.map((member) => member.id)).toEqual([
      "8012",
      "8407",
      "8631",
      "11976",
      "17483",
    ]);
    expect(page.members[0]?.make).toBe("INTERNATIONAL");
  });

  test("all five primary details publish native VIN/YMM and Umatilla ownership", () => {
    const page = HagermanCatalog.parse(hagermanFixture("catalog"));
    const donors = page.members.map((member) =>
      HagermanDonor.parse(hagermanFixture(member.id), member),
    );
    expect(donors.map((donor) => donor.vin)).toEqual([
      "1HTAA19E4CHA11021",
      "2FWJA3CV19AAL6262",
      "1XKTD49X5AJ240248",
      "4V4NC9EGXBN296856",
      "1FUJA6CK06LV85227",
    ]);
    expect(
      donors.every(
        (donor) => donor.owner === "82891 Bud Draper Rd UMATILLA, OR",
      ),
    ).toBe(true);
    expect(HagermanProfile.parse(hagermanFixture("contact"))).toBeTruthy();
  });

  test("incomplete totals, truncation and pagination cannot prove terminal membership", () => {
    const raw = hagermanFixture("catalog");
    expect(() =>
      HagermanCatalog.parse(
        raw.replace("Showing all 5 results", "Showing all 6 results"),
      ),
    ).toThrow();
    expect(() =>
      HagermanCatalog.parse(
        raw.replace("Showing all 5 results", "Showing 1-5 of 10 results"),
      ),
    ).toThrow();
    expect(() => HagermanCatalog.parse(raw.slice(0, -20))).toThrow();
    expect(() =>
      HagermanCatalog.parse(
        raw.replace('aria-current="page"', 'aria-current="false"'),
      ),
    ).toThrow();
  });

  test("retail category, active filters and foreign or disagreeing card destinations stop", () => {
    const raw = hagermanFixture("catalog");
    expect(() =>
      HagermanCatalog.parse(
        raw.replace(
          "value=\"99000\" selected='selected'",
          "value=\"9000\" selected='selected'",
        ),
      ),
    ).toThrow();
    expect(() =>
      HagermanCatalog.parse(
        raw.replace(
          /name="keywords"([^>]*?)value=""/,
          'name="keywords"$1value="Volvo"',
        ),
      ),
    ).toThrow();
    expect(() =>
      HagermanCatalog.parse(
        raw.replace(
          'href="/item/international/9200/',
          'href="https://foreign.example/item/international/9200/',
        ),
      ),
    ).toThrow();
    expect(() =>
      HagermanCatalog.parse(
        raw.replace('/1125862/1/8012/"', '/1125862/1/8407/"'),
      ),
    ).toThrow();
  });

  test("canonical detail identity and duplicated field labels cannot be repaired", () => {
    const member = HagermanCatalog.parse(hagermanFixture("catalog")).members[0];
    if (!member) throw new Error("Missing actual fixture member");
    const raw = hagermanFixture("8012");
    expect(() =>
      HagermanDonor.parse(
        raw.replace(
          'href="https://hagermanparts.com/item/international/9200/dismantled-vehicles/1125862/1/8012"',
          'href="https://hagermanparts.com/item/international/9200/dismantled-vehicles/1125862/1/8407"',
        ),
        member,
      ),
    ).toThrow();
    expect(() =>
      HagermanDonor.parse(
        raw.replace(">Vehicle Model</div>", ">VIN</div>"),
        member,
      ),
    ).toThrow();
  });

  test("rejected missing YMM or foreign-yard donors retain independently valid VIN presence", () => {
    const member = HagermanCatalog.parse(hagermanFixture("catalog")).members[0];
    if (!member) throw new Error("Missing actual fixture member");
    const donor = HagermanDonor.parse(hagermanFixture("8012"), member);
    const missing = assessHagermanDonor(member, { ...donor, model: "" });
    const foreign = assessHagermanDonor(member, {
      ...donor,
      owner: "Foreign Supplier, WA",
    });
    expect(missing).toMatchObject({
      status: "rejected",
      vin: "1HTAA19E4CHA11021",
    });
    expect(foreign).toMatchObject({
      status: "rejected",
      vin: "1HTAA19E4CHA11021",
    });
  });

  test("optional metadata stays null and the real stock-bound donor image is retained", () => {
    const page = HagermanCatalog.parse(hagermanFixture("catalog"));
    const first = page.members[0],
      photo = page.members[2];
    if (!first || !photo) throw new Error("Missing actual fixture members");
    const donor = HagermanDonor.parse(hagermanFixture("8012"), first);
    const accepted = assessHagermanDonor(first, { ...donor, stock: null });
    if (accepted.status !== "accepted")
      throw new Error("Optional absent stock rejected a real donor");
    expect(
      transformHagermanDonor(accepted, HAGERMAN_COORDINATES),
    ).toMatchObject({
      stockNumber: null,
      imageUrl: null,
      availableDate: null,
      color: null,
      row: null,
    });
    const photoBody = hagermanFixture("8631");
    expect(HagermanDonor.parse(photoBody, photo).imageUrl).toContain(
      "_1125862_1_8631_1.jpg",
    );
    expect(
      HagermanDonor.parse(
        photoBody.replaceAll(
          "imagehost.heavytruckparts.net",
          "foreign.example",
        ),
        photo,
      ).imageUrl,
    ).toBeNull();
    expect(
      HagermanDonor.parse(
        photoBody.replaceAll("_1125862_1_8631_", "_1125862_1_8012_"),
        photo,
      ).imageUrl,
    ).toBeNull();
  });

  test("full actual census passes and duplicate destinations are both quarantined", () => {
    const page = HagermanCatalog.parse(hagermanFixture("catalog"));
    const donors = page.members.map((member) =>
      HagermanDonor.parse(hagermanFixture(member.id), member),
    );
    expect(HagermanCensus.quality(page, donors, null).accepted.length).toBe(5);
    expect(() => HagermanCensus.quality(page, donors, 12)).toThrow(
      "drift guards",
    );
    const first = donors[0];
    if (!first) throw new Error("Missing actual donor");
    const conflicted = donors.map((donor, index) =>
      index === 1 ? { ...donor, vin: first.vin } : donor,
    );
    const records = HagermanCensus.assess(page, conflicted);
    expect(records.slice(0, 2).map((record) => record.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(records.slice(0, 2).map((record) => record.vin)).toEqual([
      first.vin,
      first.vin,
    ]);
    expect(() => HagermanCensus.quality(page, conflicted, null)).toThrow(
      "rejection",
    );
  });
});
