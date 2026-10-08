/**
 * Dates and working days for attendance.
 *
 *   todayIn('Asia/Kolkata')                     -> "2026-10-02" (the date where the organization is)
 *   workingDay(db, organization, branchId, date) -> { working: false, reason: 'Sunday (weekly off)' }
 *
 * A day is a working day when it is not one of the organization's weekly off days (Academic ->
 * Calendar) and not a holiday of the organization or of that branch.
 * Dates are calendar dates ("2026-10-02"), stored as midnight UTC, so their weekday is getUTCDay().
 */
import type { Db } from '../../prisma/prisma.service';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Today's date ("YYYY-MM-DD") in a time zone. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

/** "2026-10-02" -> Date at midnight UTC, or null if it isn't a real date. */
export function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The date `days` days before `day` ("YYYY-MM-DD"). */
export function daysBefore(day: string, days: number): string {
  const date = parseDay(day)!;
  date.setUTCDate(date.getUTCDate() - days);
  return isoDay(date);
}

/** Is a time zone name valid (e.g. "Asia/Kolkata")? */
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export async function workingDay(
  db: Db,
  organization: { id: string; weeklyOffDays: number[] },
  branchId: string,
  date: Date,
): Promise<{ working: boolean; reason?: string }> {
  const weekday = date.getUTCDay();
  if (organization.weeklyOffDays.includes(weekday)) {
    return { working: false, reason: `${WEEKDAYS[weekday]} (weekly off)` };
  }
  const holiday = await db.holiday.findFirst({
    where: {
      organizationId: organization.id,
      OR: [{ branchId: null }, { branchId }],
      startsOn: { lte: date },
      endsOn: { gte: date },
    },
  });
  if (holiday) return { working: false, reason: `Holiday: ${holiday.name}` };
  return { working: true };
}

/** How many working days there are from `from` to `to` (both included). */
export async function countWorkingDays(
  db: Db,
  organization: { id: string; weeklyOffDays: number[] },
  branchId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const holidays = await db.holiday.findMany({
    where: {
      organizationId: organization.id,
      OR: [{ branchId: null }, { branchId }],
      startsOn: { lte: to },
      endsOn: { gte: from },
    },
  });
  let count = 0;
  for (const d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    if (organization.weeklyOffDays.includes(d.getUTCDay())) continue;
    if (holidays.some((h) => h.startsOn <= d && h.endsOn >= d)) continue;
    count++;
  }
  return count;
}
