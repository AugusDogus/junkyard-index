import { expect, test } from "bun:test";
import {
  parseOrgGeoFromDetailsInitData,
  parseOrgGeoFromOrganizationDoc,
} from "./autorecycler-geo";

const org = "1348695171700984260__LOOKUP__1726602417880x199387504054651780";
const recordId = "1726602417880x199387504054651780";
const source = {
  name_text: "EZ Pull N Pay Columbus",
  address1_geographic_address: {
    lat: 32.44405100000001,
    lng: -84.9404565,
    address: "3843 Aldridge Rd, Columbus, GA 31903, USA",
    components: { city: "Columbus", state: "Georgia", "state code": "GA" },
  },
};

test.each([recordId, org])(
  "accepts exact organization %s without a self partner",
  (id) => {
    expect(
      parseOrgGeoFromOrganizationDoc(
        {
          _id: id,
          _type: "custom.organization",
          found: true,
          _source: source,
        },
        org,
      ),
    ).toMatchObject({ locationCity: "Columbus", lat: 32.44405100000001 });
  },
);

test.each([
  { parent_organization_custom_organization: org },
  { partner_orgs_list_custom_organization: [org] },
])("rejects a related organization: %j", (relationship) => {
  expect(
    parseOrgGeoFromOrganizationDoc(
      {
        _id: "1726602417881x199387504054651780",
        _type: "custom.organization",
        _source: { ...source, ...relationship },
      },
      org,
    ),
  ).toBeNull();
});

test("inventory ownership does not prove its GPS belongs to that physical yard", () => {
  expect(
    parseOrgGeoFromDetailsInitData(
      [
        {
          type: "custom.inventory",
          data: {
            organization_custom_organization: org,
            seo_description_text:
              "Look no further than Ez Pull N Pay Columbus!",
            gps_location_geographic_address: {
              lat: 33.7877874,
              lng: -84.4842809,
              address: "1172 Field Rd NW, Atlanta, GA 30318, USA",
              components: {
                city: "Atlanta",
                state: "Georgia",
                "state code": "GA",
              },
            },
          },
        },
      ],
      org,
    ),
  ).toBeNull();
});
