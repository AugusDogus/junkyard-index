import { describe, expect, test } from "bun:test";
import { parseOrgGeoFromDetailsInitData } from "./autorecycler-geo";

describe("autorecycler geo", () => {
  test("parseOrgGeoFromDetailsInitData reads gps_location_geographic_address", () => {
    const org = "1348695171700984260__LOOKUP__test";
    const rows = [
      {
        type: "custom.inventory",
        data: {
          _type: "custom.inventory",
          organization_custom_organization: org,
          gps_location_geographic_address: {
            lat: 36.77,
            lng: -76.45,
            address: "5411 W Military Hwy, Chesapeake, VA 23321, USA",
            components: {
              city: "Chesapeake",
              state: "Virginia",
              "state code": "VA",
            },
          },
          seo_description_text:
            "Looking for used parts in Chesapeake, VA? Look no further than Foss U-Pull-It Chesapeake VA! We are your go-to auto recycler.",
        },
      },
    ];
    const g = parseOrgGeoFromDetailsInitData(rows, org);
    expect(g).not.toBeNull();
    expect(g!.lat).toBe(36.77);
    expect(g!.lng).toBe(-76.45);
    expect(g!.stateAbbr).toBe("VA");
    expect(g!.locationName).toBe("Foss U-Pull-It Chesapeake VA");
    expect(g!.locationCity).toBe("Chesapeake");
    expect(g!.address).toContain("Chesapeake");
  });

  test("parseOrgGeoFromDetailsInitData falls back to city label when seo name is absent", () => {
    const org = "1348695171700984260__LOOKUP__test";
    const rows = [
      {
        type: "custom.inventory",
        data: {
          _type: "custom.inventory",
          organization_custom_organization: org,
          gps_location_geographic_address: {
            lat: 42.36,
            lng: -83.18,
            address: "9309 Hubbell Ave, Detroit, MI 48228, USA",
            components: {
              city: "Detroit",
              state: "Michigan",
              "state code": "MI",
            },
          },
        },
      },
    ];

    const g = parseOrgGeoFromDetailsInitData(rows, org);
    expect(g).not.toBeNull();
    expect(g!.locationName).toBe("AutoRecycler - Detroit");
    expect(g!.locationCity).toBe("Detroit");
  });

  test("parseOrgGeoFromDetailsInitData matches org after trim on both sides", () => {
    const orgCore = "1348695171700984260__LOOKUP__test";
    const rows = [
      {
        type: "custom.inventory",
        data: {
          organization_custom_organization: orgCore,
          gps_location_geographic_address: {
            lat: 1,
            lng: 2,
            components: { city: "X", "state code": "ST" },
          },
        },
      },
    ];
    const g = parseOrgGeoFromDetailsInitData(rows, `  ${orgCore}  `);
    expect(g).not.toBeNull();
    expect(g!.orgLookup).toBe(orgCore);
  });

  test("parseOrgGeoFromDetailsInitData returns null when org mismatches", () => {
    const rows = [
      {
        type: "custom.inventory",
        data: {
          organization_custom_organization: "other",
          gps_location_geographic_address: { lat: 1, lng: 2 },
        },
      },
    ];
    expect(parseOrgGeoFromDetailsInitData(rows, "expected")).toBeNull();
  });
});
