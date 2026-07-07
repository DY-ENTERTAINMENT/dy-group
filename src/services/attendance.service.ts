import { supabase } from '../lib/supabase';
import type { AttendancePunchType, AttendanceRecord, Employee } from '../types/database';

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
};

type AttendanceRowWithEmployee = AttendanceRecord & {
  employees: Pick<Employee, 'id' | 'full_name' | 'employee_code'> | null;
};

export const attendanceService = {
  async listMyAttendanceRecords(profileId: string) {
    const { data, error } = await supabase
      .from('attendance_records')
      .select(
        `
        *,
        employees:employee_id(id, full_name, employee_code)
      `,
      )
      .eq('profile_id', profileId)
      .order('punched_at', { ascending: false });

    if (error) {
      throw error;
    }

    return ((data ?? []) as unknown as AttendanceRowWithEmployee[]).map(mapAttendanceRow);
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

function mapAttendanceRow(row: AttendanceRowWithEmployee): AttendanceRecordItem {
  return {
    ...row,
    employee: row.employees,
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
