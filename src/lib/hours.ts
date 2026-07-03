/**
 * Lightweight parser for common OSM opening_hours patterns, enough to power
 * an "open now" filter honestly. Anything it can't parse returns "unknown"
 * rather than guessing.
 *
 * Handles: "Mo-Fr 09:00-11:00", "Tu 18:00-19:00", "Mo,We,Fr 08:00-12:00",
 * "Mo-Fr 09:00-12:00,13:00-17:00", multiple rules joined by ";", "24/7".
 * Does NOT handle week-of-month ("Tu[2,4]"), months, or holidays → unknown.
 */

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

interface Rule {
  days: number[]; // 0=Sunday
  ranges: { start: number; end: number }[]; // minutes since midnight
}

function parseDays(spec: string): number[] | null {
  const days: number[] = [];
  for (const part of spec.split(",")) {
    const range = part.split("-");
    if (range.length === 2) {
      const a = DAYS.indexOf(range[0] as (typeof DAYS)[number]);
      const b = DAYS.indexOf(range[1] as (typeof DAYS)[number]);
      if (a < 0 || b < 0) return null;
      for (let d = a; ; d = (d + 1) % 7) {
        days.push(d);
        if (d === b) break;
        if (days.length > 7) return null;
      }
    } else {
      const d = DAYS.indexOf(part as (typeof DAYS)[number]);
      if (d < 0) return null;
      days.push(d);
    }
  }
  return days;
}

function parseTimes(spec: string): { start: number; end: number }[] | null {
  const ranges: { start: number; end: number }[] = [];
  for (const part of spec.split(",")) {
    const m = part.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!m) return null;
    ranges.push({
      start: +m[1] * 60 + +m[2],
      end: +m[3] * 60 + +m[4],
    });
  }
  return ranges;
}

export function parseOpeningHours(raw: string): Rule[] | null {
  if (raw.trim() === "24/7") {
    return [{ days: [0, 1, 2, 3, 4, 5, 6], ranges: [{ start: 0, end: 1440 }] }];
  }
  const rules: Rule[] = [];
  for (const clause of raw.split(";")) {
    const trimmed = clause.trim();
    if (!trimmed || trimmed.toLowerCase() === "closed") continue;
    const m = trimmed.match(/^([A-Za-z,-]+)\s+(.+)$/);
    if (!m) return null;
    const days = parseDays(m[1]);
    const ranges = parseTimes(m[2]);
    if (!days || !ranges) return null;
    rules.push({ days, ranges });
  }
  return rules.length ? rules : null;
}

export type OpenStatus = "open" | "closed" | "unknown";

export function openStatus(raw: string | null, now = new Date()): OpenStatus {
  if (!raw) return "unknown";
  const rules = parseOpeningHours(raw);
  if (!rules) return "unknown";
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const rule of rules) {
    if (!rule.days.includes(day)) continue;
    for (const r of rule.ranges) {
      if (mins >= r.start && mins < r.end) return "open";
    }
  }
  return "closed";
}

/** Human-friendly rendering of the raw OSM hours string. */
export function friendlyHours(raw: string): string {
  const DAY_NAMES: Record<string, string> = {
    Mo: "Mon",
    Tu: "Tue",
    We: "Wed",
    Th: "Thu",
    Fr: "Fri",
    Sa: "Sat",
    Su: "Sun",
  };
  return raw
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (d) => DAY_NAMES[d] ?? d)
    .replace(/;/g, " · ");
}
