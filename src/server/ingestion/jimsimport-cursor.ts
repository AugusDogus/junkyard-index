import { z } from "zod";
import {
  JimsimportControlSchema,
  JimsimportMenuSchema,
  JimsimportPageSchema,
  jimsimportControlPath,
  jimsimportHash,
  jimsimportRequiredPage,
  type JimsimportPage,
  type JimsimportMenu,
} from "./jimsimport-parser";
import {
  jimsimportModels,
  jimsimportSnapshot,
  validateJimsimportSnapshot,
} from "./jimsimport-transform";
import {
  JIMSIMPORT_CATALOG,
  JIMSIMPORT_YARD,
} from "./jimsimport-yard-metadata";

const scope = jimsimportHash({
  version: 1,
  catalog: JIMSIMPORT_CATALOG,
  yard: JIMSIMPORT_YARD,
  floor: 1_216,
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = {
  source: z.literal("jimsimport"),
  version: z.literal(1),
  scope: z.literal(scope),
  requests: z.number().int().min(0).max(1024),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(128 * 1024 * 1024),
};
const owner = { ...base, ownerHash: hash };
const makes = {
  ...owner,
  makes: z.array(JimsimportControlSchema).min(1).max(128),
};
const graph = { ...makes, menus: z.array(JimsimportMenuSchema).max(128) };
const opening = { ...graph, opening: z.array(JimsimportPageSchema).max(1024) };
const closing = {
  ...opening,
  closing: z.array(JimsimportPageSchema).max(1024),
};
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("owner") }).strict(),
  z.object({ ...owner, phase: z.literal("makes") }).strict(),
  z.object({ ...graph, phase: z.literal("models") }).strict(),
  z.object({ ...opening, phase: z.literal("opening") }).strict(),
  z.object({ ...opening, phase: z.literal("closing-makes") }).strict(),
  z
    .object({
      ...opening,
      phase: z.literal("closing-models"),
      closedMenus: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ ...closing, phase: z.literal("closing") }).strict(),
  z.object({ ...closing, phase: z.literal("owner-closing") }).strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
export type JimsimportState = z.infer<typeof schema>;
export type JimsimportCursor = JimsimportState & { checksum: string };
function prefix(
  menus: readonly JimsimportMenu[],
  pages: readonly JimsimportPage[],
  complete: boolean,
) {
  const models = jimsimportModels(menus);
  if (
    (complete
      ? pages.length !== models.length
      : pages.length >= models.length) ||
    pages.some(
      (p, i) =>
        p.makePath !== models[i]?.make.path ||
        p.modelPath !== models[i]?.model.path ||
        (p.records.length === 0) !== p.nativeEmpty,
    )
  )
    throw new Error(
      "Jim's Import checkpoint lost its complete ordered native model frontier",
    );
}
function checkpoint(state: JimsimportState): JimsimportCursor {
  const parsed = schema.parse(state);
  if (
    "ownerHash" in parsed &&
    parsed.ownerHash !== jimsimportHash(JIMSIMPORT_YARD)
  )
    throw new Error("Jim's Import checkpoint physical owner changed");
  if (
    "makes" in parsed &&
    (new Set(parsed.makes.map((c) => c.path)).size !== parsed.makes.length ||
      parsed.makes.some((c) => jimsimportControlPath(c.path, 1) !== c.path))
  )
    throw new Error(
      "Jim's Import checkpoint make controls are invalid or repeated",
    );
  if ("menus" in parsed) {
    if (
      (parsed.phase === "models"
        ? parsed.menus.length >= parsed.makes.length
        : parsed.menus.length !== parsed.makes.length) ||
      parsed.menus.some(
        (menu, i) =>
          jimsimportHash(menu.make) !== jimsimportHash(parsed.makes[i]) ||
          !menu.models.length ||
          new Set(menu.models.map((c) => c.path)).size !== menu.models.length ||
          menu.models.some(
            (c) =>
              jimsimportControlPath(c.path, 2) !== c.path ||
              !c.path.startsWith(menu.make.path.replace(/\/$/, "") + "/"),
          ),
      )
    )
      throw new Error(
        "Jim's Import checkpoint model menus lost their published parent frontier",
      );
    if (jimsimportModels(parsed.menus).length > 1024)
      throw new Error("Jim's Import model graph exceeds 1024 leaves");
  }
  if (parsed.phase === "opening") prefix(parsed.menus, parsed.opening, false);
  if ("opening" in parsed && parsed.phase !== "opening") {
    prefix(parsed.menus, parsed.opening, true);
    validateJimsimportSnapshot(
      jimsimportSnapshot(parsed.menus, parsed.opening),
    );
  }
  if (
    parsed.phase === "closing-models" &&
    parsed.closedMenus >= parsed.menus.length
  )
    throw new Error("Jim's Import closing-menu checkpoint is out of bounds");
  if ("closing" in parsed) {
    prefix(parsed.menus, parsed.closing, parsed.phase === "owner-closing");
    if (
      parsed.closing.some(
        (page, i) =>
          jimsimportHash(jimsimportRequiredPage(page)) !==
          jimsimportHash(
            parsed.opening[i]
              ? jimsimportRequiredPage(parsed.opening[i])
              : null,
          ),
      )
    )
      throw new Error(
        "Jim's Import closing required donor membership, identity, YMM or destination changed; no inventory emitted",
      );
  }
  return { ...parsed, checksum: jimsimportHash(parsed) };
}
export const JimsimportCursor = {
  initial: (): JimsimportCursor =>
    checkpoint({
      source: "jimsimport",
      version: 1,
      scope,
      phase: "owner",
      requests: 0,
      bytes: 0,
    }),
  checkpoint,
  parse(input: unknown): JimsimportCursor {
    if (Buffer.byteLength(JSON.stringify(input)) > 8 * 1024 * 1024)
      throw new Error("Jim's Import checkpoint exceeds 8 MiB");
    const { checksum, ...rest } = z
      .object({ checksum: hash })
      .passthrough()
      .parse(input);
    const parsed = checkpoint(schema.parse(rest));
    if (checksum !== parsed.checksum)
      throw new Error(
        "Jim's Import checkpoint checksum changed; retain the last validated checkpoint",
      );
    return parsed;
  },
} as const;
