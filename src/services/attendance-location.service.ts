import { supabase } from '../lib/supabase';
import type { AttendanceLocation, Region } from '../types/database';

export const ATTENDANCE_RADIUS_OPTIONS = [100, 200, 300, 500] as const;

export type AttendanceLocationListItem = AttendanceLocation & {
  region: Pick<Region, 'id' | 'code' | 'name'> | null;
};

export type AttendanceLocationFormValues = {
  name: string;
  region_id: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number;
  is_active: boolean;
};

export type BrowserGeoPosition = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

type AttendanceLocationRowWithRegion = AttendanceLocation & {
  regions: Pick<Region, 'id' | 'code' | 'name'> | null;
};

export const emptyAttendanceLocationForm: AttendanceLocationFormValues = {
  name: '',
  region_id: '',
  latitude: null,
  longitude: null,
  radius_meters: 200,
  is_active: true,
};

export const attendanceLocationService = {
  async listAttendanceLocations(regionFilter: string): Promise<AttendanceLocationListItem[]> {
    let query = supabase
      .from('attendance_locations')
      .select(
        `
          id,
          region_id,
          name,
          latitude,
          longitude,
          radius_meters,
          is_active,
          created_by,
          updated_by,
          created_at,
          updated_at,
          regions:region_id(id, code, name)
        `,
      )
      .order('is_active', { ascending: false })
      .order('name', { ascending: true });

    if (regionFilter) {
      query = query.eq('region_id', regionFilter);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return ((data ?? []) as unknown as AttendanceLocationRowWithRegion[]).map(mapAttendanceLocationRow);
  },

  async getRegions(): Promise<Region[]> {
    const { data, error } = await supabase
      .from('regions')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      throw error;
    }

    return data ?? [];
  },

  async createAttendanceLocation(values: AttendanceLocationFormValues) {
    const { error } = await supabase.from('attendance_locations').insert(normalizeAttendanceLocationPayload(values));

    if (error) {
      throw error;
    }
  },

  async updateAttendanceLocation(locationId: string, values: AttendanceLocationFormValues) {
    const { error } = await supabase
      .from('attendance_locations')
      .update(normalizeAttendanceLocationPayload(values))
      .eq('id', locationId);

    if (error) {
      throw error;
    }
  },

  async deleteAttendanceLocation(locationId: string) {
    const { error } = await supabase.from('attendance_locations').delete().eq('id', locationId);

    if (error) {
      throw error;
    }
  },
};

export function getBrowserGeoPosition(): Promise<BrowserGeoPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('无法取得当前位置，请检查浏览器定位权限或网络后重试。'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (geoError) => {
        if (geoError.code === geoError.PERMISSION_DENIED) {
          reject(new Error('请允许浏览器定位权限，否则无法打卡。'));
          return;
        }

        reject(new Error('无法取得当前位置，请检查浏览器定位权限或网络后重试。'));
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      },
    );
  });
}

export function calculateDistanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const earthRadiusMeters = 6371000;
  const latDelta = toRadians(latitudeB - latitudeA);
  const lonDelta = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) * Math.sin(lonDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function normalizeAttendanceLocationPayload(values: AttendanceLocationFormValues) {
  if (values.latitude === null || values.longitude === null) {
    throw new Error('请先点击使用当前位置或重新定位。');
  }

  return {
    name: values.name.trim(),
    region_id: values.region_id,
    latitude: values.latitude,
    longitude: values.longitude,
    radius_meters: values.radius_meters,
    is_active: values.is_active,
  };
}

function mapAttendanceLocationRow(row: AttendanceLocationRowWithRegion): AttendanceLocationListItem {
  return {
    ...row,
    region: row.regions,
  };
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
