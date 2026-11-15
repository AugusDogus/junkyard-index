import { z } from "zod";
import {
  OemgarageCatalogSchema,
  OemgarageRecordSchema,
  oemgarageHash,
  type OemgarageCatalog,
  type OemgarageRecord,
} from "./oemgarage-parser";
import {
  oemgarageSnapshot,
  validateOemgarageSnapshot,
} from "./oemgarage-transform";
import { OEMGARAGE_CATALOG, OEMGARAGE_YARD } from "./oemgarage-yard-metadata";

const scope = oemgarageHash({
  version: 1,
  yard: OEMGARAGE_YARD,
  catalog: OEMGARAGE_CATALOG,
  floor: 200,
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = {
  source: z.literal("oemgarage"),
  version: z.literal(1),
  scope: z.literal(scope),
};
const owner = { ...base, ownerHash: hash };
const opening = {
  ...owner,
  catalog: OemgarageCatalogSchema,
  opening: z.array(OemgarageRecordSchema).max(1000),
};
const closing = {
  ...opening,
  closing: z.array(OemgarageRecordSchema).max(1000),
};
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("owner") }).strict(),
  z.object({ ...owner, phase: z.literal("catalog") }).strict(),
  z.object({ ...opening, phase: z.literal("opening") }).strict(),
  z.object({ ...opening, phase: z.literal("closing-catalog") }).strict(),
  z.object({ ...closing, phase: z.literal("closing") }).strict(),
  z.object({ ...closing, phase: z.literal("owner-closing") }).strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
export type OemgarageState = z.infer<typeof schema>;
export type OemgarageCursor = OemgarageState & { checksum: string };
export const oemgarageRequiredRecord = (r: OemgarageRecord) => [
  r.card,
  r.title,
  r.header,
  r.stock,
  (r.fields.VIN ?? "").toUpperCase(),
  // This native field controls removal of a literal suffix from the model.
  r.fields.Series ?? "",
];
function prefix(
  catalog: OemgarageCatalog,
  records: readonly OemgarageRecord[],
  complete: boolean,
): void {
  if (
    new Set(catalog.cards.map((c) => c.id)).size !== catalog.cards.length ||
    records.length > catalog.cards.length ||
    (complete
      ? records.length !== catalog.cards.length
      : records.length >= catalog.cards.length) ||
    records.some(
      (r, i) => oemgarageHash(r.card) !== oemgarageHash(catalog.cards[i]),
    )
  )
    throw new Error(
      "oeM Garage checkpoint lost its complete ordered native donor frontier",
    );
}
function checkpoint(state: OemgarageState): OemgarageCursor {
  const parsed = schema.parse(state);
  if (
    "ownerHash" in parsed &&
    parsed.ownerHash !== oemgarageHash(OEMGARAGE_YARD)
  )
    throw new Error("oeM Garage checkpoint physical owner changed");
  if (parsed.phase === "opening") prefix(parsed.catalog, parsed.opening, false);
  if (
    parsed.phase === "closing-catalog" ||
    parsed.phase === "closing" ||
    parsed.phase === "owner-closing"
  ) {
    prefix(parsed.catalog, parsed.opening, true);
    validateOemgarageSnapshot(
      oemgarageSnapshot(parsed.catalog, parsed.opening),
    );
  }
  if (parsed.phase === "closing" || parsed.phase === "owner-closing") {
    prefix(parsed.catalog, parsed.closing, parsed.phase === "owner-closing");
    if (
      parsed.closing.some(
        (r, i) =>
          oemgarageHash(oemgarageRequiredRecord(r)) !==
          oemgarageHash(
            parsed.opening[i]
              ? oemgarageRequiredRecord(parsed.opening[i])
              : null,
          ),
      )
    )
      throw new Error(
        "oeM Garage closing required identity, YMM, stock or source destination changed; no inventory emitted",
      );
  }
  return { ...parsed, checksum: oemgarageHash(parsed) };
}
export const OemgarageCursor = {
  initial: (): OemgarageCursor =>
    checkpoint({ ...baseValues(), phase: "owner" }),
  checkpoint,
  parse(input: unknown): OemgarageCursor {
    if (Buffer.byteLength(JSON.stringify(input)) > 4 * 1024 * 1024)
      throw new Error("oeM Garage checkpoint exceeds 4 MiB");
    const { checksum, ...rest } = z
      .object({ checksum: hash })
      .passthrough()
      .parse(input);
    const parsed = checkpoint(schema.parse(rest));
    if (checksum !== parsed.checksum)
      throw new Error(
        "oeM Garage checkpoint checksum changed; retain the last validated checkpoint",
      );
    return parsed;
  },
} as const;
function baseValues() {
  return { source: "oemgarage" as const, version: 1 as const, scope };
}
