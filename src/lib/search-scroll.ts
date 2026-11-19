import { z } from "zod";

const schema = z.object({
  width: z.number().positive(),
  scrollY: z.number().nonnegative(),
  rowSizes: z.array(z.number().nonnegative()),
  savedAt: z.number(),
});
type Snapshot = z.infer<typeof schema>;
const key = (state: string) => `junkyard-index:search-scroll:v1:${state}`;

function read(state: string): Snapshot | null {
  try {
    const parsed = schema.safeParse(
      JSON.parse(sessionStorage.getItem(key(state)) ?? "null"),
    );
    return parsed.success &&
      Date.now() - parsed.data.savedAt < 30 * 60_000 &&
      parsed.data.width === window.innerWidth
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}
function write(state: string, snapshot: Omit<Snapshot, "savedAt">) {
  try {
    sessionStorage.setItem(
      key(state),
      JSON.stringify({ ...snapshot, savedAt: Date.now() }),
    );
  } catch {
    /* Scroll restoration is optional when tab storage is unavailable. */
  }
}
export const SearchScroll = { read, write } as const;
