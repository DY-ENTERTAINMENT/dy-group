import { supabase } from '../lib/supabase';
import type { AttendanceClockOutRecovery, AttendancePunchType, AttendanceRecord, Employee } from '../types/database';

export type AttendanceCapturePayload = {
  profileId: string;
  punchType: AttendancePunchType;
  photoBlob: Blob;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  ipAddress: string | null;
  deviceInfo: string;
};

export type AttendanceRecordItem = AttendanceRecord & {
  employee: Pick<Employee, 'id' | 'full_name' | 'employee_code'> | null;
  clockOutRecovery: AttendanceClockOutRecovery | null;
};

type AttendanceRowWithEmployee = AttendanceRecord & {
  employees: Pick<Employee, 'id' | 'full_name' | 'employee_code'> | null;
};

export const attendanceService = {
  async listMyAttendanceRecords(profileId: string, range?: { start: string; end: string }) {
    let query = supabase
      .from('attendance_records')
      .select(
        `
        *,
        employees:employee_id(id, full_name, employee_code)
      `,
      )
      .eq('profile_id', profileId);

    if (range) {
      query = query.gte('punched_at', range.start).lt('punched_at', range.end);
    }

    const { data, error } = await query
      .order('punched_at', { ascending: false });

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as unknown as AttendanceRowWithEmployee[];
    const clockOutIds = rows.filter((row) => row.punch_type === 'clock_out').map((row) => row.id);
    const recoveries = clockOutIds.length
      ? await listClockOutRecoveries(clockOutIds)
      : new Map<string, AttendanceClockOutRecovery>();

    return rows.map((row) => mapAttendanceRow(row, recoveries.get(row.id) ?? null));
  },

  async createAttendanceRecord(payload: AttendanceCapturePayload) {
    const photoPath = await uploadAttendancePhoto(payload.profileId, payload.punchType, payload.photoBlob);

    const { error } = await supabase.rpc('create_attendance_record_checked', {
      p_punch_type: payload.punchType,
      p_photo_path: photoPath,
      p_latitude: payload.latitude,
      p_longitude: payload.longitude,
      p_accuracy: payload.accuracy,
      p_ip_address: payload.ipAddress,
      p_device_info: payload.deviceInfo,
    });

    if (error) {
      throw error;
    }
  },

  async recoverMyBreakClockOut() {
    const { error } = await supabase.rpc('recover_my_break_clock_out');
    if (error) throw error;
  },
};

export async function getPublicIpAddress() {
  try {
    const response = await fetch('https://api.ipify.org?format=json');

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { ip?: string };
    return data.ip ?? null;
  } catch {
    return null;
  }
}

async function listClockOutRecoveries(clockOutIds: string[]) {
  const { data, error } = await supabase
    .from('attendance_clock_out_recoveries')
    .select('*')
    .in('attendance_record_id', clockOutIds);
  if (error) throw error;
  return new Map((data ?? []).map((recovery) => [recovery.attendance_record_id, recovery]));
}

function mapAttendanceRow(row: AttendanceRowWithEmployee, clockOutRecovery: AttendanceClockOutRecovery | null): AttendanceRecordItem {
  return {
    ...row,
    employee: row.employees,
    clockOutRecovery,
  };
}

async function uploadAttendancePhoto(profileId: string, punchType: AttendancePunchType, photoBlob: Blob) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `${profileId}/${timestamp}-${punchType}.jpg`;
  const { error } = await supabase.storage.from('attendance-photos').upload(path, photoBlob, {
    cacheControl: '3600',
    contentType: 'image/jpeg',
    upsert: false,
  });

  if (error) {
    throw error;
  }

  return path;
}
