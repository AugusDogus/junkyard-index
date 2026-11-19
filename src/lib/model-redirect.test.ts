import { expect, test } from "bun:test";
import { ModelRedirect } from "./model-redirect";

const target = {
  make: { href: "/cars/ford", name: "Ford" },
  models: [{ href: "/cars/ford/f-150", slug: "f-150", key: "F150" }],
};

test("legacy spellings resolve to a canonical model, ambiguous and retired URLs to a live parent", () => {
  expect(ModelRedirect.destination("/cars/ford/f150", target)).toBe(
    "/cars/ford/f-150",
  );
  expect(ModelRedirect.destination("/cars/ford/f-250", target)).toBe(
    "/cars/ford",
  );
  expect(ModelRedirect.destination("/cars/retired/model", null)).toBe("/cars");
  expect(
    ModelRedirect.merge(
      "/cars/ford/truck",
      "/cars/ford/f-150",
      "/cars/ford/f-250",
    ),
  ).toBe("/cars/ford");
  expect(
    ModelRedirect.merge("/cars/ford/truck", "/cars/ford", "/cars/ford/f-150"),
  ).toBe("/cars/ford");
  expect(ModelRedirect.merge("/cars/ford/truck", "", "/cars/ford/f-150")).toBe(
    "/cars/ford/f-150",
  );
});
