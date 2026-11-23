/**
 * A value per UTC day (or per week, keyed by its Monday), for the admin
 * charts. Days are `YYYY-MM-DD` strings, so a series survives a JSON cache.
 */
export type DayValue = { day: string; value: number };

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export const AdminSeries = {
  DAY_MS,
  dayKey,
  dayStart,

  /** The `count` UTC days ending with `now`'s day, oldest first. */
  lastDays(now: Date, count: number): string[] {
    const today = dayStart(dayKey(now)).getTime();
    return Array.from({ length: count }, (_, index) =>
      dayKey(new Date(today - (count - 1 - index) * DAY_MS)),
    );
  },

  /** One entry per day in `days`: the sum of its rows, or 0. */
  fillDays(rows: readonly DayValue[], days: readonly string[]): DayValue[] {
    const totals = new Map(days.map((day) => [day, 0]));
    for (const row of rows) {
      const total = totals.get(row.day);
      if (total !== undefined) totals.set(row.day, total + row.value);
    }
    return days.map((day) => ({ day, value: totals.get(day) ?? 0 }));
  },

  /** Daily values summed into weeks, each keyed by its Monday, in order. */
  weeks(daily: readonly DayValue[]): DayValue[] {
    const weeks = new Map<string, number>();
    for (const { day, value } of daily) {
      const start = dayStart(day);
      const sinceMonday = (start.getUTCDay() + 6) % 7;
      const monday = dayKey(new Date(start.getTime() - sinceMonday * DAY_MS));
      weeks.set(monday, (weeks.get(monday) ?? 0) + value);
    }
    return [...weeks]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, value]) => ({ day, value }));
  },
} as const;
