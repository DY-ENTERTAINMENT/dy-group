import { supabase } from '../lib/supabase';
import type { OutgoingEvent, OutgoingRequest, OutgoingRequestEvidence, OutgoingRequestReviewHistory, OutgoingType } from '../types/database';
import { assertOutgoingRealServiceEnabled } from './outgoing-feature.service';
import { getOutgoingEvent, type OutgoingEventRelation } from './outgoing-event-relation';

export type OutgoingRequestFormValues = {
  outgoingDate: string;
  plannedStartTime: string;
  plannedReturnTime: string;
  outgoingType: OutgoingType;
  location: string;
  reason: string;
  relatedContact?: string | null;
  remarks?: string | null;
};

export type OutgoingCaptureValues = {
  requestId: string;
  profileId: string;
  photo: Blob | null;
  /** A previously uploaded path for the same request, phase, and idempotency key. */
  photoPath?: string | null;
  /** Persisted before the RPC so an unknown result can retry without uploading again. */
  onPhotoUploaded?: (photoPath: string) => void;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  idempotencyKey: string;
};

export type OutgoingRequestWithEvent = OutgoingRequest & {
  /** PostgREST to-one embed: null until the approved request is started. */
  outgoing_events: OutgoingEvent | null;
};

export type OutgoingManagementFilters = {
  startDate?: string;
  endDate?: string;
  regionId?: string;
  employeeId?: string;
  outgoingType?: OutgoingType;
  requestStatus?: OutgoingRequest['status'];
  eventStatus?: OutgoingEvent['status'];
};

const requestWithEventSelect = '*, outgoing_events(*)';
const EVIDENCE_BUCKET = 'outgoing-evidence';
const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
const evidenceExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Phase 3 RPC facade. The methods are intentionally not called by the current
 * mock UI until the Phase 3 migrations have been verified in an isolated DB.
 */
export const outgoingService = {
  async getAdmissionsEnabled() {
    assertOutgoingRealServiceEnabled();
    const { data, error } = await supabase.rpc('get_outgoing_feature_admissions_enabled');
    if (error) throw error;
    return data === true;
  },
  async setAdmissionsEnabled(enabled: boolean) {
    assertOutgoingRealServiceEnabled();
    const { error } = await supabase.rpc('set_outgoing_feature_admissions_enabled', { p_enabled: enabled });
    if (error) throw error;
  },
  async createRequest(values: OutgoingRequestFormValues) {
    assertOutgoingRealServiceEnabled();
    const { data, error } = await supabase.rpc('create_outgoing_request', {
      p_outgoing_date: values.outgoingDate,
      p_planned_start_time: values.plannedStartTime,
      p_planned_return_time: values.plannedReturnTime,
      p_outgoing_type: values.outgoingType,
      p_location: values.location,
      p_reason: values.reason,
      p_related_contact: values.relatedContact ?? null,
      p_remarks: values.remarks ?? null,
    });
    if (error) throw error;
    return data;
  },

  async cancelRequest(requestId: string) {
    assertOutgoingRealServiceEnabled();
    const { error } = await supabase.rpc('cancel_outgoing_request', { p_request_id: requestId });
    if (error) throw error;
  },

  async reviewRequest(requestId: string, decision: 'approved' | 'rejected', rejectionReason?: string) {
    assertOutgoingRealServiceEnabled();
    const { error } = await supabase.rpc('review_outgoing_request', {
      p_request_id: requestId,
      p_decision: decision,
      p_note: decision === 'rejected' ? rejectionReason?.trim() || null : null,
    });
    if (error) throw error;
  },

  async listMyRequests() {
    assertOutgoingRealServiceEnabled();
    const { data, error } = await supabase.rpc('list_my_outgoing_requests');
    if (error) throw error;
    const requests = (data ?? []) as OutgoingRequest[];
    if (!requests.length) return [];

    // Defense in depth: the RPC is authoritative, and the browser also rejects
    // any row not owned by the authenticated profile before rendering it.
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    const profileId = authData.user?.id;
    if (!profileId) throw new Error('当前登录会话无效。');
    const ownRequests = requests.filter((request) => request.profile_id === profileId);
    const ids = ownRequests.map((request) => request.id);
    if (!ids.length) return [];
    const { data: events, error: eventsError } = await supabase
      .from('outgoing_events')
      .select('*')
      .eq('profile_id', profileId)
      .in('request_id', ids);
    if (eventsError) throw eventsError;
    const eventsByRequest = new Map((events ?? []).map((event) => [event.request_id, event as OutgoingEvent]));
    return ownRequests.map((request) => ({ ...request, outgoing_events: eventsByRequest.get(request.id) ?? null }));
  },

  async listManagedRequests(filters: OutgoingManagementFilters = {}) {
    assertOutgoingRealServiceEnabled();
    let query = supabase
      .from('outgoing_requests')
      .select(requestWithEventSelect)
      .order('outgoing_date', { ascending: false })
      .order('planned_start_time', { ascending: false });
    if (filters.startDate) query = query.gte('outgoing_date', filters.startDate);
    if (filters.endDate) query = query.lte('outgoing_date', filters.endDate);
    if (filters.regionId) query = query.eq('region_id', filters.regionId);
    if (filters.employeeId) query = query.eq('employee_id', filters.employeeId);
    if (filters.outgoingType) query = query.eq('outgoing_type', filters.outgoingType);
    if (filters.requestStatus) query = query.eq('status', filters.requestStatus);
    const { data, error } = await query;
    if (error) throw error;
    const rows = normalizeOutgoingRequests(data);
    return filters.eventStatus ? rows.filter((row) => getOutgoingEvent(row)?.status === filters.eventStatus) : rows;
  },

  async listReviewHistory(requestId: string) {
    assertOutgoingRealServiceEnabled();
    const { data, error } = await supabase.rpc('list_my_outgoing_request_review_history', { p_request_id: requestId });
    if (error) throw error;
    return (data ?? []) as OutgoingRequestReviewHistory[];
  },

  async listMyEvidence(requestId: string) {
    assertOutgoingRealServiceEnabled();
    const { data, error } = await supabase.rpc('list_my_outgoing_request_evidence', { p_request_id: requestId });
    if (error) throw error;
    return (data ?? []) as OutgoingRequestEvidence[];
  },

  async listManagedEvidence(requestId: string) {
    assertOutgoingRealServiceEnabled();
    const { data, error } = await supabase.rpc('list_managed_outgoing_request_evidence', { p_request_id: requestId });
    if (error) throw error;
    return (data ?? []) as OutgoingRequestEvidence[];
  },

  async uploadEvidence(requestId: string, file: File) {
    assertOutgoingRealServiceEnabled();
    validateEvidenceFile(file);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    const profileId = authData.user?.id;
    if (!profileId) throw new Error('当前登录会话无效。');
    if (typeof crypto?.randomUUID !== 'function') throw new Error('当前浏览器不支持安全的文件名。');
    const path = `${profileId}/${requestId}/evidence/${crypto.randomUUID()}.${evidenceExtensions[file.type]}`;
    const { error: uploadError } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, file, { cacheControl: '3600', contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { data, error } = await supabase.rpc('create_outgoing_request_evidence', { p_request_id: requestId, p_photo_path: path });
    if (error) throw error;
    return data as OutgoingRequestEvidence;
  },

  async getPendingApprovalCount() {
    assertOutgoingRealServiceEnabled();
    const { data, error } = await supabase.rpc('get_my_outgoing_approval_pending_count');
    if (error) throw error;
    return data ?? 0;
  },

  async startOutgoing(values: OutgoingCaptureValues) {
    assertOutgoingRealServiceEnabled();
    const photoPath = await resolveOutgoingPhotoPath(values, 'start');
    const { data, error } = await supabase.rpc('start_outgoing_event', {
      p_request_id: values.requestId,
      p_photo_path: photoPath,
      p_latitude: values.latitude,
      p_longitude: values.longitude,
      p_accuracy: values.accuracy,
      p_idempotency_key: values.idempotencyKey,
    });
    if (error) throw error;
    return data;
  },

  async finishOutgoing(values: OutgoingCaptureValues) {
    assertOutgoingRealServiceEnabled();
    const photoPath = await resolveOutgoingPhotoPath(values, 'end');
    const { data, error } = await supabase.rpc('finish_outgoing_event', {
      p_request_id: values.requestId,
      p_photo_path: photoPath,
      p_latitude: values.latitude,
      p_longitude: values.longitude,
      p_accuracy: values.accuracy,
      p_idempotency_key: values.idempotencyKey,
    });
    if (error) throw error;
    return data;
  },

  async handleException(eventId: string) {
    assertOutgoingRealServiceEnabled();
    const { error } = await supabase.rpc('handle_outgoing_exception', { p_event_id: eventId });
    if (error) throw error;
  },

  async reconcileExceptions(employeeId?: string) {
    assertOutgoingRealServiceEnabled();
    const { data, error } = await supabase.rpc('reconcile_outgoing_exceptions', { p_employee_id: employeeId ?? null });
    if (error) throw error;
    return data ?? 0;
  },

  async getPhotoSignedUrl(photoPath: string, expiresIn = 60) {
    assertOutgoingRealServiceEnabled();
    const { data, error } = await supabase.storage.from('outgoing-photos').createSignedUrl(photoPath, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  },

  async getEvidenceSignedUrl(photoPath: string, expiresIn = 60) {
    assertOutgoingRealServiceEnabled();
    const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(photoPath, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  },
};

function validateEvidenceFile(file: File) {
  if (!(file.type in evidenceExtensions)) throw new Error('外出证明仅支持 JPG、JPEG、PNG 或 WebP 图片。');
  if (file.size <= 0 || file.size > EVIDENCE_MAX_BYTES) throw new Error('外出证明图片大小必须大于 0 且不超过 5MB。');
}

/** Normalize the embedded relation once at the PostgREST boundary. */
function normalizeOutgoingRequests(data: unknown): OutgoingRequestWithEvent[] {
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const request = row as OutgoingRequest & { outgoing_events?: OutgoingEventRelation };
    return { ...request, outgoing_events: getOutgoingEvent(request) };
  });
}

async function resolveOutgoingPhotoPath(values: OutgoingCaptureValues, phase: 'start' | 'end') {
  if (values.photoPath) return values.photoPath;
  if (!values.photo) throw new Error('缺少外出打卡实时照片。');
  const path = `${values.profileId}/${values.requestId}/${phase}-${values.idempotencyKey}.jpg`;
  const { error } = await supabase.storage.from('outgoing-photos').upload(path, values.photo, {
    cacheControl: '3600', contentType: 'image/jpeg', upsert: false,
  });
  if (error && !isExistingOutgoingPhotoError(error)) throw error;
  values.onPhotoUploaded?.(path);
  return path;
}

function isExistingOutgoingPhotoError(error: { statusCode?: string | number; message?: string }) {
  return String(error.statusCode) === '409' || /already exists|duplicate/i.test(error.message ?? '');
}
