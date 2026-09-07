export type CreatorCalendarMilestoneType = '30_days' | '100_days' | '3_months' | '6_months' | '1_year';

export type CreatorCalendarSource = { joined_date?: string | null; guild_joined_date?: string | null };
export type CreatorCalendarMilestone = { type: CreatorCalendarMilestoneType; date: string };

export const creatorCalendarMilestoneLabels: Record<CreatorCalendarMilestoneType, string> = {
  '30_days': '入会30天', '100_days': '入会100天', '3_months': '入会3个月', '6_months': '入会半年', '1_year': '入会1周年',
};

export function getCreatorMilestoneDateSource(profiles: CreatorCalendarSource[]): string | null {
  const entityDate = profiles.find((profile) => profile.guild_joined_date)?.guild_joined_date;
  if (entityDate && isIsoDate(entityDate)) return entityDate;
  if (!profiles.length || profiles.some((profile) => !isIsoDate(profile.joined_date))) return null;
  const profileDates = [...new Set(profiles.map((profile) => profile.joined_date).filter(isIsoDate))];
  return profileDates.length === 1 ? profileDates[0] : null;
}

export function getCreatorMilestones(profiles: CreatorCalendarSource[]): CreatorCalendarMilestone[] {
  const sourceDate = getCreatorMilestoneDateSource(profiles);
  const date = sourceDate ? parseIsoDate(sourceDate) : null;
  if (!date) return [];
  return [
    { type: '30_days', date: formatIsoDate(addDays(date, 30)) },
    { type: '100_days', date: formatIsoDate(addDays(date, 100)) },
    { type: '3_months', date: formatIsoDate(addMonths(date, 3)) },
    { type: '6_months', date: formatIsoDate(addMonths(date, 6)) },
    { type: '1_year', date: formatIsoDate(addMonths(date, 12)) },
  ];
}

function isIsoDate(value: string | null | undefined): value is string { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseIsoDate(value)); }
function parseIsoDate(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number); const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}
function addDays(date: Date, days: number) { const result = new Date(date); result.setUTCDate(result.getUTCDate() + days); return result; }
function addMonths(date: Date, months: number) {
  const result = new Date(date); const day = result.getUTCDate(); result.setUTCDate(1); result.setUTCMonth(result.getUTCMonth() + months);
  result.setUTCDate(Math.min(day, new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate())); return result;
}
function formatIsoDate(date: Date) { return date.toISOString().slice(0, 10); }
