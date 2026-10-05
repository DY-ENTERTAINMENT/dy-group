import type { AttendancePunchType } from '../types/database';

export type AttendanceDayRecord = { id: string; punched_at: string; punch_type: AttendancePunchType; clockOutRecovery?: unknown | null };
export type AttendanceDayStatus = 'not_started' | 'working' | 'on_break' | 'clocked_out';

export type AttendanceDaySummary = {
  status: AttendanceDayStatus;
  anomalies: string[];
  hasClockIn: boolean;
  hasClockOut: boolean;
  breakOpen: boolean;
};

const MYT = 'Asia/Kuala_Lumpur';

export function mytDateKey(value: Date | string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: MYT, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function todayMytDateKey(now = new Date()): string { return mytDateKey(now); }

export function mytMonthRange(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const next = monthNumber === 12 ? [year + 1, 1] : [year, monthNumber + 1];
  return {
    start: `${year}-${String(monthNumber).padStart(2, '0')}-01T00:00:00+08:00`,
    end: `${next[0]}-${String(next[1]).padStart(2, '0')}-01T00:00:00+08:00`,
  };
}

export function sortAttendanceRecords<T extends AttendanceDayRecord>(records: T[]): T[] {
  return [...records].sort((a, b) => a.punched_at.localeCompare(b.punched_at) || a.id.localeCompare(b.id));
}

export function groupAttendanceRecordsByMytDate<T extends AttendanceDayRecord>(records: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  sortAttendanceRecords(records).forEach((record) => {
    const date = mytDateKey(record.punched_at);
    groups.set(date, [...(groups.get(date) ?? []), record]);
  });
  return groups;
}

export function summarizeAttendanceDay(records: AttendanceDayRecord[]): AttendanceDaySummary {
  const sorted = sortAttendanceRecords(records);
  let hasClockIn = false;
  let hasClockOut = false;
  let breakOpen = false;
  const anomalies: string[] = [];

  for (const record of sorted) {
    // A recovery never changes the source punch. It only removes that one
    // clock-out from operational state/calculation while leaving it auditable.
    if (record.punch_type === 'clock_out' && record.clockOutRecovery) continue;
    if (hasClockOut) anomalies.push('下班后仍有打卡记录');
    if (record.punch_type === 'clock_in') {
      if (hasClockIn) anomalies.push('重复上班打卡');
      hasClockIn = true;
    }
    if (record.punch_type === 'break_start') {
      if (!hasClockIn) anomalies.push('缺少上班打卡后开始休息');
      if (breakOpen) anomalies.push('休息未结束时再次开始休息');
      breakOpen = true;
    }
    if (record.punch_type === 'break_end') {
      if (!hasClockIn) anomalies.push('缺少上班打卡后结束休息');
      if (!breakOpen) anomalies.push('缺少开始休息记录');
      breakOpen = false;
    }
    if (record.punch_type === 'clock_out') {
      if (!hasClockIn) anomalies.push('缺少上班打卡后下班');
      if (hasClockOut) anomalies.push('重复下班打卡');
      if (breakOpen) anomalies.push('休息中下班');
      hasClockOut = true;
    }
  }

  return { status: hasClockOut ? 'clocked_out' : breakOpen ? 'on_break' : hasClockIn ? 'working' : 'not_started', anomalies: [...new Set(anomalies)], hasClockIn, hasClockOut, breakOpen };
}

/** Returns the sole UI candidate; the database RPC repeats every security check. */
export function findRecoverableBreakClockOut<T extends AttendanceDayRecord>(records: T[]): T | null {
  const sorted = sortAttendanceRecords(records);
  let hasClockIn = false;
  let breakOpen = false;
  let candidate: T | null = null;

  for (const record of sorted) {
    if (record.punch_type === 'clock_in') hasClockIn = true;
    if (record.punch_type === 'break_start') breakOpen = true;
    if (record.punch_type === 'break_end') breakOpen = false;
    if (record.punch_type === 'clock_out') {
      candidate = hasClockIn && breakOpen && !record.clockOutRecovery ? record : null;
    } else if (candidate) {
      // The source clock-out must be the final event of the Malaysia day.
      candidate = null;
    }
  }

  return candidate;
}
