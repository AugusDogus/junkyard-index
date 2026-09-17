import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  parseOrgGeoFromDetailsInitData,
  parseOrgGeoFromOrganizationDoc,
  parseOrgGeoFromWebsiteRecord,
  resolveAutorecyclerSeeds,
} from "./autorecycler-geo";

const recordId = "1726602417880x199387504054651780";
const org = `1348695171700984260__LOOKUP__${recordId}`;
const address = {
  lat: 36.0552047,
  lng: -80.2069893,
  address: "3459 Thomasville Rd, Winston-Salem, NC 27107, USA",
  components: {
    city: "Winston-Salem",
    state: "North Carolina",
    "state code": "NC",
  },
};
const source = {
  name_text: "Foss Winston-Salem",
  address_city_text: "WINSTON-SALEM",
  address1_geographic_address: address,
};

describe("autorecycler geo", () => {
  test("uses the organization city field when geographic city is blank", () => {
    expect(
      parseOrgGeoFromOrganizationDoc(
        {
          _id: recordId,
          _type: "custom.organization",
          _source: {
            ...source,
            address1_geographic_address: {
              ...address,
              components: { city: "" },
            },
          },
        },
        org,
      )?.locationCity,
    ).toBe("WINSTON-SALEM");
  });

  test("does not mistake the street-address segment for a city", () => {
    const incomplete = {
      ...address,
      components: { state: "North Carolina", "state code": "NC" },
    };
    expect(
      parseOrgGeoFromWebsiteRecord(
        {
          organization_custom_organization: org,
          address_geographic_address: incomplete,
        },
        org,
      )?.locationCity,
    ).toBe("Unknown");
    expect(
      parseOrgGeoFromOrganizationDoc(
        {
          _id: recordId,
          _type: "custom.organization",
          _source: { address1_geographic_address: incomplete },
        },
        org,
      )?.locationCity,
    ).toBe("Unknown");
  });

  test.each([recordId, org])(
    "reads organization identity %s from the source when absent from the envelope",
    (id) => {
      expect(
        parseOrgGeoFromOrganizationDoc(
          { _source: { ...source, _id: id, _type: "custom.organization" } },
          ` ${org} `,
        ),
      ).toMatchObject({
        locationName: "Foss Winston-Salem",
        locationCity: "Winston-Salem",
        stateAbbr: "NC",
        orgLookup: org,
      });
    },
  );

  test.each([recordId, org])(
    "reads the website's own organization reference %s",
    (id) => {
      expect(
        parseOrgGeoFromWebsiteRecord(
          {
            organization_custom_organization: ` ${id} `,
            name_text: "Foss Winston-Salem",
            address_geographic_address: address,
          },
          org,
        ),
      ).toMatchObject({
        locationName: "Foss Winston-Salem",
        locationCity: "Winston-Salem",
        stateAbbr: "NC",
      });
    },
  );

  test.each([
    "other",
    `999__LOOKUP__${recordId}`,
    "1726602417881x199387504054651780",
    undefined,
  ])("rejects website ownership %s", (id) => {
    expect(
      parseOrgGeoFromWebsiteRecord(
        {
          organization_custom_organization: id,
          address_geographic_address: address,
        },
        org,
      ),
    ).toBeNull();
  });

  test.each(["custom.organization", undefined])(
    "reads init/data organization rows with row type %s",
    (type) => {
      expect(
        parseOrgGeoFromDetailsInitData(
          [
            {
              type,
              data: {
                ...source,
                _type: "custom.organization",
                _id: ` ${recordId} `,
              },
            },
          ],
          ` ${org} `,
        ),
      ).toMatchObject({ locationCity: "Winston-Salem", orgLookup: org });
    },
  );

  test.each([
    { found: false },
    { _id: "other" },
    { _type: "custom.inventory" },
    { _source: { ...source, _type: "custom.inventory" } },
    { _source: { ...source, _id: "other" } },
    { _id: `999__LOOKUP__${recordId}` },
  ])(
    "rejects missing, conflicting or wrong organization documents: %j",
    (override) => {
      expect(
        parseOrgGeoFromOrganizationDoc(
          {
            _id: recordId,
            _type: "custom.organization",
            _source: source,
            ...override,
          },
          org,
        ),
      ).toBeNull();
    },
  );

  test.each([
    [NaN, 0],
    [0, Infinity],
    [91, 0],
    [0, -181],
    ["1", 2],
  ])("rejects invalid coordinates %j, %j", (lat, lng) => {
    const invalid = { ...address, lat, lng };
    expect(
      parseOrgGeoFromOrganizationDoc(
        {
          _id: org,
          _type: "custom.organization",
          _source: { address1_geographic_address: invalid },
        },
        org,
      ),
    ).toBeNull();
    expect(
      parseOrgGeoFromWebsiteRecord(
        {
          organization_custom_organization: org,
          address_geographic_address: invalid,
        },
        org,
      ),
    ).toBeNull();
  });

  test("resolves independent organization seeds with bounded concurrency", async () => {
    const seeds = new Map(
      Array.from({ length: 6 }, (_, index) => [`org-${index}`, `inv-${index}`]),
    );
    let active = 0;
    let maximumActive = 0;
    await Effect.runPromise(
      resolveAutorecyclerSeeds(seeds, () =>
        Effect.promise(async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        }),
      ),
    );
    expect(maximumActive).toBe(3);
  });
});
