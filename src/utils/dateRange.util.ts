export interface DateRange {
  from: Date;
  to: Date;
}

export function resolveDateRange(query: Record<string, string | undefined>): DateRange {
  const { period, from, to } = query;
  const now = new Date();

  if (period) {
    switch (period) {
      case "7d":
        return { from: new Date(now.getTime() - 7 * 86_400_000), to: now };
      case "30d":
        return { from: new Date(now.getTime() - 30 * 86_400_000), to: now };
      case "90d":
        return { from: new Date(now.getTime() - 90 * 86_400_000), to: now };
      case "ytd":
        return { from: new Date(now.getFullYear(), 0, 1), to: now };
      case "all":
        return { from: new Date("2020-01-01"), to: now };
    }
  }

  if (from && to) return { from: new Date(from), to: new Date(to) };
  if (from) return { from: new Date(from), to: now };

  // Default: last 30 days
  return { from: new Date(now.getTime() - 30 * 86_400_000), to: now };
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function previousRange(range: DateRange): DateRange {
  const durationMs = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - durationMs),
    to: new Date(range.from.getTime()),
  };
}
