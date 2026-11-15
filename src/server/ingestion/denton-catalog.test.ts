import { expect, test } from "bun:test";
import { DentonCatalog } from "./denton-catalog";
import { DentonSnapshot } from "./denton-snapshot";
import { transformDentonVehicle } from "./denton-transform";

const make = {
  url: "https://dentonauto.com/used-parts/ACURA",
  label: "ACURA",
  count: 11,
};
const model = {
  url: "https://dentonauto.com/used-parts/ACURA/MDX/",
  label: "MDX",
  count: 4,
};
const document = (body: string) =>
  `<html><body><script>var urgid = 'KS12';</script><div id="iiscont">${body}</div></body></html>`;
// Native AD4656 field values and destination captured 2026-11-15 in the KS lane.
const card = (
  vin = "5FRYD4H51HB016721",
  year = "2017",
  extra = "",
) => `<div class="card card-price" id="AD4656">
<div class="car-details"><b>Stock:</b> AD4656<br><b>Year:</b> ${year}<br><b>Make/Model :</b> ACURA MDX<br><b>Vin :</b> ${vin}<br>${extra}</div>
<a href="//dentonauto.com/used-parts/ACURA/MDX/AD4656/${year}">See Parts</a></div>`;
function parsed(body: string) {
  const result = DentonCatalog.model(document(body), { make, model });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

test("Denton preserves every literal make/model control and treats counts as observations", () => {
  const result = DentonCatalog.directory(
    document(
      '<div id="menumodellist"><a href="//dentonauto.com/used-parts/ACURA/MDX/">MDX <span class="badge">4</span></a></div>',
    ),
    make,
  );
  expect(result).toMatchObject({ ok: true, value: [model] });
  expect(
    DentonCatalog.directory(
      document(
        '<div id="menumodellist"><a href="https://foreign.test/MDX">MDX <span class="badge">4</span></a></div>',
      ),
      make,
    ).ok,
  ).toBe(false);
  expect(
    DentonCatalog.directory(
      document(
        '<div id="menumodellist"><a href="//dentonauto.com/used-parts/ACURA/MDX/">MDX</a></div>',
      ),
      make,
    ).ok,
  ).toBe(false);
});

test("Denton retains genuine required values without requiring optional metadata", () => {
  const page = parsed(card());
  const snapshot = DentonSnapshot.build([page]);
  expect(snapshot.vehicles).toEqual([
    {
      vin: "5FRYD4H51HB016721",
      year: 2017,
      make: "ACURA",
      model: "MDX",
      detailsUrl: "https://dentonauto.com/used-parts/ACURA/MDX/AD4656/2017",
      stockNumber: "AD4656",
      imageUrl: null,
      availableDate: null,
      color: null,
      row: null,
      mileage: null,
    },
  ]);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 1,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  });
  expect(
    DentonSnapshot.validate(snapshot, {
      minimumUniqueInventory: 1,
      previousAcceptedCount: null,
      terminal: true,
    }).ok,
  ).toBe(true);
  expect(
    DentonSnapshot.validate(snapshot, {
      minimumUniqueInventory: 1,
      previousAcceptedCount: null,
      terminal: false,
    }).ok,
  ).toBe(false);
});

test("Denton rejects unread continuation, truncated responses and missing native cards", () => {
  for (const body of [
    card() + '<a href="?page=2">Next Page</a>',
    card() + '<div data-next-cursor="more"></div>',
    '<div class="car-details">unaccounted identity</div>',
  ]) {
    expect(DentonCatalog.model(document(body), { make, model }).ok).toBe(false);
  }
  expect(
    DentonCatalog.model(document(card()).replace("</html>", ""), {
      make,
      model,
    }).ok,
  ).toBe(false);
  expect(
    DentonCatalog.model(document(card()).replace("'KS12'", "'T159'"), {
      make,
      model,
    }).ok,
  ).toBe(false);
  expect(
    DentonCatalog.model(document(card().repeat(500)), { make, model }).ok,
  ).toBe(false);
});

test("Denton counts rejected identities and duplicate observations and enforces existing limits", () => {
  const good = parsed(card());
  const bad = parsed(card("", "2017"));
  const snapshot = DentonSnapshot.build([good, bad]);
  expect(snapshot.accounting.recordsRejected).toBe(1);
  expect(
    DentonSnapshot.validate(snapshot, {
      minimumUniqueInventory: 1,
      previousAcceptedCount: null,
      terminal: true,
    }).ok,
  ).toBe(false);
  const duplicate = DentonSnapshot.build([good, good]);
  expect(duplicate.accounting.duplicateVehicles).toBe(1);
  expect(
    DentonSnapshot.validate(duplicate, {
      minimumUniqueInventory: 1,
      previousAcceptedCount: null,
      terminal: true,
    }).ok,
  ).toBe(false);
  expect(
    DentonSnapshot.validate(DentonSnapshot.build([good]), {
      minimumUniqueInventory: 1,
      previousAcceptedCount: 4,
      terminal: true,
    }).ok,
  ).toBe(false);
});

test("Denton quarantines every conflicting VIN and destination occurrence", () => {
  const first = parsed(card());
  const conflict = parsed(card("5FRYD4H51HB016721", "2018"));
  const snapshot = DentonSnapshot.build([first, conflict]);
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  const crossed = DentonSnapshot.build([
    first,
    parsed(card("2HNYD2H68AH515234")),
  ]);
  expect(crossed.vehicles).toHaveLength(0);
  expect(crossed.accounting.recordsRejected).toBe(2);
  expect(crossed.observedVins).toHaveLength(2);
});

test("Denton merges genuine optional metadata and nulls conflicting observations", () => {
  const blank = parsed(card());
  const photo =
    '<img data-src="https://da8h1v3w8q6n5.cloudfront.net/ks12/images/AD4656/AD4656_0.jpg">';
  const supplied = parsed(
    card(undefined, undefined, "<b>Miles :</b> 104000<br>").replace(
      /<\/div>$/,
      photo + "</div>",
    ),
  );
  expect(DentonSnapshot.build([blank, supplied]).vehicles[0]?.mileage).toBe(
    104000,
  );
  expect(DentonSnapshot.build([blank, supplied]).vehicles[0]?.imageUrl).toBe(
    "https://da8h1v3w8q6n5.cloudfront.net/ks12/images/AD4656/AD4656_0.jpg",
  );
  const conflicting = parsed(
    card(undefined, undefined, "<b>Miles :</b> 104001<br>").replace(
      /<\/div>$/,
      photo.replace("_0.jpg", "_1.jpg") + "</div>",
    ),
  );
  expect(
    DentonSnapshot.build([supplied, conflicting, blank]).vehicles[0]?.mileage,
  ).toBe(null);
  expect(
    DentonSnapshot.build([supplied, conflicting, blank]).vehicles[0]?.imageUrl,
  ).toBe(null);
  expect(
    DentonSnapshot.build([parsed(card() + photo)]).vehicles[0]?.imageUrl,
  ).toBe(null);
});

test("Denton retains the inclusive 10% rejection and 25% duplicate boundaries", () => {
  const good = Array.from({ length: 9 }, (_, index) =>
    parsed(
      card(`5FRYD4H51HB01672${index}`).replaceAll("AD4656", `AD465${index}`),
    ),
  );
  const bad = parsed(card(""));
  expect(
    DentonSnapshot.validate(DentonSnapshot.build([...good, bad]), {
      terminal: true,
      minimumUniqueInventory: 1,
      previousAcceptedCount: null,
    }).ok,
  ).toBe(true);
  expect(
    DentonSnapshot.validate(DentonSnapshot.build([...good, bad, bad]), {
      terminal: true,
      minimumUniqueInventory: 1,
      previousAcceptedCount: null,
    }).ok,
  ).toBe(false);
  const first = good[0];
  if (!first) throw new Error("Fixture missing");
  expect(
    DentonSnapshot.validate(
      DentonSnapshot.build([...good.slice(0, 3), first]),
      {
        terminal: true,
        minimumUniqueInventory: 1,
        previousAcceptedCount: null,
      },
    ).ok,
  ).toBe(true);
});

test("Denton parses the native arrivals wrapper and retains primary photos and dates", () => {
  const photo =
    '<img data-src="https://da8h1v3w8q6n5.cloudfront.net/ks12/images/AD4656/AD4656_0.jpg">';
  const body = card(
    undefined,
    undefined,
    "<b>Enter Date:</b> 2026-10-22<br>",
  ).replace(/<\/div>$/, photo + photo.replace("_0.jpg", "_1.jpg") + "</div>");
  const result = DentonCatalog.arrivals(
    document(body).replace('id="iiscont"', 'class="card-deck"'),
    [make],
  );
  if (!result.ok) throw new Error(result.error.message);
  const snapshot = DentonSnapshot.build([parsed(card()), result.value]);
  expect(snapshot.vehicles[0]?.availableDate).toBe("2026-10-22");
  expect(snapshot.vehicles[0]?.imageUrl).toBe(
    "https://da8h1v3w8q6n5.cloudfront.net/ks12/images/AD4656/AD4656_0.jpg",
  );
  expect(snapshot.accounting.duplicateVehicles).toBe(1);
});

test("Denton retains supported older serial claims when native years conflict", () => {
  const page = parsed(card("ABC12345", "1975", "<b>Year:</b> 2017<br>"));
  const snapshot = DentonSnapshot.build([page]);
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting.recordsRejected).toBe(1);
  expect(snapshot.observedVins).toEqual(["ABC12345"]);
});

test("Denton canonical transform uses verified Kansas geography and existing make normalization", () => {
  const vehicle = DentonSnapshot.build([parsed(card())]).vehicles[0];
  if (!vehicle) throw new Error("Native fixture did not produce a vehicle");
  expect(transformDentonVehicle(vehicle)).toMatchObject({
    source: "denton",
    vin: "5FRYD4H51HB016721",
    make: "Acura",
    model: "MDX",
    locationCode: "KS12",
    locationCity: "Carbondale",
    stateAbbr: "KS",
    lat: 38.80331100000001,
    lng: -95.686134,
    color: null,
    row: null,
  });
});

test("Denton preserves a known failed stock destination as a counted quarantine", () => {
  const body = card("KM8SNDHF5KU306127", "2019")
    .replaceAll("AD4656", "AD80068")
    .replaceAll("ACURA MDX", "HYUNDAI SANTA FE")
    .replaceAll("/ACURA/MDX/", "/HYUNDAI/SANTA_FE/");
  const page = DentonCatalog.model(document(body), {
    make: {
      url: "https://dentonauto.com/used-parts/HYUNDAI",
      label: "HYUNDAI",
      count: 1,
    },
    model: {
      url: "https://dentonauto.com/used-parts/HYUNDAI/SANTA_FE/",
      label: "SANTA FE",
      count: 1,
    },
  });
  if (!page.ok) throw new Error(page.error.message);
  const snapshot = DentonSnapshot.build([page.value]);
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting.recordsRejected).toBe(1);
  expect(snapshot.rejections[0]?.reasons).toContain(
    "preserved-failed-native-destination",
  );
  expect(snapshot.observedVins).toEqual(["KM8SNDHF5KU306127"]);
});

test("Denton accepts the observed arrivals NISSAN/DATSUN alias only with native title, destination and published make agreement", () => {
  // AD80067 native values from the saved 2026-11-11 arrivals response.
  const alias = card("5N1BT3BA4PC890885", "2023")
    .replaceAll("AD4656", "AD80067")
    .replaceAll("ACURA MDX", "NISSAN/DATSUN ROGUE")
    .replaceAll("/ACURA/MDX/", "/NISSAN.DATSUN/ROGUE/");
  const nissan = {
    url: "https://dentonauto.com/used-parts/NISSAN",
    label: "NISSAN",
    count: 133,
  };
  const arrivals = (body: string, makes = [nissan]) => {
    const result = DentonCatalog.arrivals(
      document(body).replace('id="iiscont"', 'class="card-deck"'),
      makes,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  const source = DentonSnapshot.build([arrivals(alias)]);
  expect(source.vehicles[0]).toMatchObject({
    vin: "5N1BT3BA4PC890885",
    make: "NISSAN",
    model: "ROGUE",
    stockNumber: "AD80067",
  });
  const browse = DentonCatalog.model(
    document(
      alias
        .replaceAll("NISSAN/DATSUN", "NISSAN")
        .replaceAll("NISSAN.DATSUN", "NISSAN"),
    ),
    {
      make: nissan,
      model: { url: nissan.url + "/ROGUE/", label: "ROGUE", count: 29 },
    },
  );
  if (!browse.ok) throw new Error(browse.error.message);
  const combined = DentonSnapshot.build([browse.value, arrivals(alias)]);
  expect(combined.vehicles).toHaveLength(1);
  expect(combined.accounting.duplicateVehicles).toBe(1);
  for (const page of [
    arrivals(alias, [make]),
    arrivals(alias.replace("NISSAN.DATSUN", "TOYOTA")),
    arrivals(alias.replace("/ROGUE/", "/ALTIMA/")),
  ]) {
    const snapshot = DentonSnapshot.build([page]);
    expect(snapshot.vehicles).toHaveLength(0);
    expect(snapshot.observedVins).toEqual(["5N1BT3BA4PC890885"]);
  }
});

test("Denton concrete foreign supplier spill blocks the source and retains rejected identities", () => {
  const foreign = parsed(
    card().replace(
      /<\/div>$/,
      '<img data-src="https://da8h1v3w8q6n5.cloudfront.net/ok06/images/AD4656/AD4656_0.jpg"></div>',
    ),
  );
  const snapshot = DentonSnapshot.build([foreign]);
  expect(snapshot.ownershipSpill).toBe(true);
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.observedVins).toEqual(["5FRYD4H51HB016721"]);
  expect(snapshot.rejections[0]?.reasons).toContain(
    "foreign-native-supplier-spill",
  );
  const validation = DentonSnapshot.validate(snapshot, {
    terminal: true,
    minimumUniqueInventory: 1,
    previousAcceptedCount: null,
  });
  expect(validation).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining("foreign supplier") },
  });
  const unavailable = parsed(
    card().replace(
      /<\/div>$/,
      '<img data-src="https://foreign.test/unavailable.jpg"></div>',
    ),
  );
  expect(DentonSnapshot.build([unavailable]).vehicles[0]?.imageUrl).toBe(null);
});

test("Denton retains every valid conflicting native identity, including a serial valid under one conflicting year", () => {
  const snapshot = DentonSnapshot.build([
    parsed(
      card(
        "5FRYD4H51HB016721",
        "1975",
        "<b>Year:</b> 2017<br><b>Vin:</b> ABC12345<br><b>Vin:</b> 2HNYD2H68AH515234<br>",
      ),
    ),
  ]);
  expect(snapshot.accounting.recordsRejected).toBe(1);
  expect(new Set(snapshot.observedVins)).toEqual(
    new Set(["5FRYD4H51HB016721", "ABC12345", "2HNYD2H68AH515234"]),
  );
});

test("Denton validates actual source arrival model tokens for hyphens and make-prefixed pickup names", () => {
  for (const [title, token, label] of [
    ["HONDA CR-V", "CR~V", "HONDA"],
    ["FORD F150 PICKUP", "FORD_F150_PICKUP", "FORD"],
  ]) {
    if (!title || !token || !label)
      throw new Error("Incomplete native example");
    const body = card()
      .replaceAll("ACURA MDX", title)
      .replaceAll("/ACURA/MDX/", `/${label}/${token}/`);
    const result = DentonCatalog.arrivals(
      document(body).replace('id="iiscont"', 'class="card-deck"'),
      [{ url: `https://dentonauto.com/used-parts/${label}`, label, count: 1 }],
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(DentonSnapshot.build([result.value]).vehicles).toHaveLength(1);
  }
});
