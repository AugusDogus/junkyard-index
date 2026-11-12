import { expect, test } from "bun:test";
import { fenixPhotoUrl } from "./fenix-photo";
import { fenixTestRecord } from "./fenix-test-fixtures";

test("Fenix preserves only native donor-bound published photo URLs", () => {
  expect(fenixPhotoUrl(fenixTestRecord.photoUrl, fenixTestRecord.id)).toBe(
    fenixTestRecord.photoUrl,
  );
  expect(
    fenixPhotoUrl(
      "https://fenixupull.com/wp-content/uploads/2026/11/203022291_1-1-150x100.jpg",
      "203022291",
    ),
  ).toBe(
    "https://fenixupull.com/wp-content/uploads/2026/11/203022291_1-1-150x100.jpg",
  );
  for (const raw of [
    null,
    "",
    "/wp-content/themes/fenixupull/assets/img/placeholder-150x100.jpg",
    "https://other.example/204015747.jpg",
    fenixTestRecord.photoUrl + "?token=unsafe",
    fenixTestRecord.photoUrl.replace("204015747", "204015700"),
  ])
    expect(fenixPhotoUrl(raw, fenixTestRecord.id)).toBeNull();
});
