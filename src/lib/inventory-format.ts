const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Text for inventory pages; output depends only on the input. */
export const InventoryFormat = {
  count(value: number): string {
    return value.toLocaleString("en-US");
  },

  /** "1 vehicle", "1,204 vehicles". */
  plural(value: number, one: string, many: string): string {
    return `${InventoryFormat.count(value)} ${value === 1 ? one : many}`;
  },

  /** "Nov 4, 2026", in UTC so the page reads the same wherever it renders. */
  date(value: string | number): string {
    return DATE.format(new Date(value));
  },
} as const;
