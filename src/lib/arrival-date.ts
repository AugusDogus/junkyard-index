import { z } from "zod";

const dateString = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)));
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("yard"), date: dateString }),
  z.object({ kind: z.literal("seen"), date: dateString }),
  z.object({ kind: z.literal("unknown") }),
]);

export type ArrivalDate = z.infer<typeof schema>;

function from(availableDate: unknown, observedArrivalAt: unknown): ArrivalDate {
  const yard = dateString.safeParse(availableDate);
  if (yard.success) return { kind: "yard", date: yard.data };
  const seen = dateString.safeParse(observedArrivalAt);
  return seen.success ? { kind: "seen", date: seen.data } : { kind: "unknown" };
}

function parse(value: unknown): ArrivalDate {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : { kind: "unknown" };
}

function format(value: ArrivalDate): string {
  const arrival = parse(value);
  if (arrival.kind === "unknown") return "Date unknown";
  const date = new Date(arrival.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return arrival.kind === "seen" ? `Seen ${date}` : date;
}

export const ArrivalDate = { schema, from, parse, format } as const;
