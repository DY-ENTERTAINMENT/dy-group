export type CreatorCalendarMilestoneType = '30_days' | '100_days' | '6_months' | '1_year' | 'birthday';

export type CreatorCalendarSource = { joined_date?: string | null; guild_joined_date?: string | null; birthday?: string | null };
export type CreatorCalendarMilestone = { type: CreatorCalendarMilestoneType; date: string };

export const creatorCalendarMilestoneLabels: Record<CreatorCalendarMilestoneType, string> = {
  '30_days': '满月', '100_days': '百日', '6_months': '半年', '1_year': '周年', 'birthday': '生日',
};

export function getCreatorMilestoneDateSource(profiles: CreatorCalendarSource[]): string | null {
  const entityDate = profiles.find((profile) => profile.guild_joined_date)?.guild_joined_date;
  if (entityDate && isIsoDate(entityDate)) return entityDate;
  if (!profiles.length || profiles.some((profile) => !isIsoDate(profile.joined_date))) return null;
  const profileDates = [...new Set(profiles.map((profile) => profile.joined_date).filter(isIsoDate))];
  return profileDates.length === 1 ? profileDates[0] : null;
}

export function getCreatorMilestones(profiles: CreatorCalendarSource[], year = new Date().getUTCFullYear()): CreatorCalendarMilestone[] {
  const sourceDate = getCreatorMilestoneDateSource(profiles);
  const date = sourceDate ? parseIsoDate(sourceDate) : null;
  const milestones: CreatorCalendarMilestone[] = date ? [
    { type: '30_days', date: formatIsoDate(addDays(date, 30)) },
    { type: '100_days', date: formatIsoDate(addDays(date, 100)) },
    { type: '6_months', date: formatIsoDate(addMonths(date, 6)) },
    { type: '1_year', date: formatIsoDate(addMonths(date, 12)) },
  ] : [];
  const birthday = profiles.find((profile) => isIsoDate(profile.birthday))?.birthday;
  if (birthday) milestones.push({ type: 'birthday', date: birthdayForYear(birthday, year) });
  return milestones;
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
function birthdayForYear(birthday: string, year: number) {
  const [, month, day] = birthday.split('-').map(Number);
  if (month === 2 && day === 29 && !isLeapYear(year)) return `${year}-02-28`;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function isLeapYear(year: number) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
