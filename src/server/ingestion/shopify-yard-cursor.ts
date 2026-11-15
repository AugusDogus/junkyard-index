import { createHash } from "node:crypto";
import { z } from "zod";

export const shopifyYardHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const ShopifyYardDonorSchema = z
  .object({
    id: z.string().min(1).max(200),
    vin: z.string().max(100),
    year: z.string().max(20),
    make: z.string().max(100),
    model: z.string().max(300),
    status: z.enum(["active", "excluded"]),
    reasons: z.array(z.string().max(200)).max(20),
    detailsUrl: z.string().url().max(1000),
    imageUrl: z.string().url().max(2000).nullable(),
    color: z.string().max(200).nullable(),
    stockNumber: z.string().max(100).nullable(),
  })
  .strict();
export type ShopifyYardDonor = z.infer<typeof ShopifyYardDonorSchema>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);

const rows = z.array(ShopifyYardDonorSchema).min(1).max(2000);
const stateSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("owner") }).strict(),
  z.object({ phase: z.literal("opening") }).strict(),
  z.object({ phase: z.literal("closing"), rows }).strict(),
  z.object({ phase: z.literal("owner-closing"), rows }).strict(),
  z.object({ phase: z.literal("complete") }).strict(),
]);
export type ShopifyYardState = z.infer<typeof stateSchema>;

/** Only compact allowlisted donor claims enter durable checkpoints. No HTML or feed extras. */
export function shopifyYardCursor<const S extends string>(
  source: S,
  contract: unknown,
) {
  const scope = shopifyYardHash({ source, version: 1, contract });
  const checkpoint = (input: ShopifyYardState) => {
    const state = {
      ...stateSchema.parse(input),
      source,
      version: 1 as const,
      scope,
    };
    return { ...state, checksum: shopifyYardHash(state) };
  };
  const parse = (input: unknown) => {
    if (Buffer.byteLength(JSON.stringify(input)) > 2 * 1024 * 1024)
      throw new Error(`${source} checkpoint exceeds 2 MiB`);
    const {
      checksum,
      source: nativeSource,
      version,
      scope: nativeScope,
      ...state
    } = z
      .object({
        source: z.string(),
        version: z.literal(1),
        scope: z.literal(scope),
        checksum: hash,
      })
      .passthrough()
      .parse(input);
    void version;
    void nativeScope;
    if (nativeSource !== source)
      throw new Error(`${source} checkpoint belongs to another provider`);
    const cursor = checkpoint(stateSchema.parse(state));
    if (checksum !== cursor.checksum)
      throw new Error(`${source} checkpoint checksum changed`);
    return cursor;
  };
  return {
    initial: () => checkpoint({ phase: "owner" }),
    checkpoint,
    parse,
    fromWire: (wire: string) => {
      if (Buffer.byteLength(wire) > 2 * 1024 * 1024)
        throw new Error(`${source} checkpoint exceeds 2 MiB`);
      const value: unknown = JSON.parse(wire);
      return parse(value);
    },
    serialize: (cursor: ReturnType<typeof checkpoint>) =>
      JSON.stringify(parse(cursor)),
  } as const;
}
