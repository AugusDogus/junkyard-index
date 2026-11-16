import type { ConnectorChunkAccounting } from "./connector-chunk";
import {
  six03Field,
  type Six03Catalog,
  type Six03Detail,
} from "./six03-parser";
import {
  six03NativeIdentity,
  six03RecordVins,
  transformSix03Record,
  type Six03CanonicalVehicle,
} from "./six03-transform";

export function six03PendingPosts(catalog: Six03Catalog) {
  const embedded = new Set(catalog.embedded.map((record) => record.path));
  return catalog.posts.filter((post) => !embedded.has(post[0]));
}

export function six03Snapshot(
  catalog: Six03Catalog,
  details: readonly Six03Detail[],
) {
  const records = [...catalog.embedded, ...details];
  if (
    records.length !== catalog.posts.length ||
    new Set(records.map((record) => record.path)).size !== records.length
  )
    throw new Error(
      "603 complete snapshot lost or repeated a native donor destination",
    );
  const rows = catalog.posts.map((post) => {
    const record = records.find((row) => row.path === post[0]);
    if (!record)
      throw new Error(
        "603 native donor destination has no retained observation",
      );
    return {
      record,
      post,
      vins: six03RecordVins(record, post),
      result: transformSix03Record(record, post),
    };
  });
  const byVin = new Map<string, typeof rows>();
  const byDestination = new Map<string, typeof rows>();
  for (const row of rows) {
    for (const vin of row.vins)
      byVin.set(vin, [...(byVin.get(vin) ?? []), row]);
    byDestination.set(row.record.path, [
      ...(byDestination.get(row.record.path) ?? []),
      row,
    ]);
  }
  const conflictingVins = new Set<string>();
  for (const [vin, group] of byVin) {
    const identities = new Set(
      group.flatMap(({ record, post }) =>
        six03Field(record, "Year / Make / Model").map((raw) =>
          JSON.stringify(six03NativeIdentity(raw, post)),
        ),
      ),
    );
    if (
      new Set(group.map(({ record }) => record.path)).size > 1 ||
      identities.size > 1 ||
      group.some(({ result }) => result.status === "incomplete")
    )
      conflictingVins.add(vin);
  }
  for (const group of byDestination.values()) {
    if (new Set(group.flatMap(({ vins }) => vins)).size > 1)
      for (const row of group)
        for (const vin of row.vins) conflictingVins.add(vin);
  }
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: rows.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  const vehicles = new Map<string, Six03CanonicalVehicle>();
  const observedVins = new Set<string>();
  const rejectedDestinations: string[] = [];
  for (const row of rows) {
    if (
      row.result.status === "incomplete" ||
      row.vins.some((vin) => conflictingVins.has(vin))
    ) {
      accounting.recordsRejected++;
      rejectedDestinations.push(row.record.path);
      for (const vin of row.vins) observedVins.add(vin);
    } else if (vehicles.has(row.result.vehicle.vin))
      accounting.duplicateVehicles++;
    else vehicles.set(row.result.vehicle.vin, row.result.vehicle);
  }
  return {
    vehicles: [...vehicles.values()],
    accounting,
    observedVins: [...observedVins].sort(),
    conflictingVins: [...conflictingVins].sort(),
    rejectedDestinations,
  };
}

export function validateSix03Snapshot(
  snapshot: ReturnType<typeof six03Snapshot>,
): void {
  const { accounting, vehicles } = snapshot;
  const total = accounting.recordsProcessed;
  if (
    vehicles.length < 324 ||
    total !==
      vehicles.length +
        accounting.recordsRejected +
        accounting.duplicateVehicles ||
    accounting.recordsRejected / total > 0.1 ||
    accounting.duplicateVehicles / total > 0.25
  )
    throw new Error(
      "603 complete inventory is below 324 or exceeds 10% rejects / 25% duplicates; preserve prior inventory and inspect the retained native observations",
    );
  if (
    snapshot.observedVins.some((vin) =>
      vehicles.some((vehicle) => vehicle.vin === vin),
    )
  )
    throw new Error("603 rejected VIN presence overlaps emitted inventory");
}
