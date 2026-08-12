import { supabase } from '../lib/supabase';
import type {
  Employee,
  WorkTimeAdjustmentDetailStatus,
  WorkTimeAdjustmentRequest,
  WorkTimeAdjustmentRequestDate,
} from '../types/database';

const ATTACHMENT_BUCKET = 'work-time-adjustment-attachments';
const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

export const workTimeAdjustmentStatusLabels: Record<WorkTimeAdjustmentDetailStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消',
  revoked: '已撤销',
};

export type WorkTimeAdjustmentAttachment = {
  path: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
};

export type WorkTimeAdjustmentFormValues = {
  startDate: string;
  endDate: string;
  adjustedStartTime: string;
  reason: string;
  attachment?: WorkTimeAdjustmentAttachment | null;
};

export type WorkTimeAdjustmentRequestItem = WorkTimeAdjustmentRequest & {
  dates: WorkTimeAdjustmentRequestDate[];
};

export type WorkTimeAdjustmentReviewStatusFilter = WorkTimeAdjustmentDetailStatus | 'all';

export type WorkTimeAdjustmentReviewDecision = Extract<WorkTimeAdjustmentDetailStatus, 'approved' | 'rejected'>;

export type WorkTimeAdjustmentReviewEmployee = Pick<Employee, 'id' | 'full_name' | 'employee_code'>;

export type WorkTimeAdjustmentReviewDetail = WorkTimeAdjustmentRequestDate & {
  request: WorkTimeAdjustmentRequest | null;
  employee: WorkTimeAdjustmentReviewEmployee | null;
};

export const workTimeAdjustmentService = {
  async createRequest(values: WorkTimeAdjustmentFormValues) {
    const { data, error } = await supabase.rpc('create_work_time_adjustment_request', {
      p_start_date: values.startDate,
      p_end_date: values.endDate,
      p_adjusted_start_time: values.adjustedStartTime,
      p_reason: values.reason,
      p_attachment_path: values.attachment?.path ?? null,
      p_attachment_original_name: values.attachment?.originalName ?? null,
      p_attachment_content_type: values.attachment?.contentType ?? null,
      p_attachment_size_bytes: values.attachment?.sizeBytes ?? null,
    });

    if (error) {
      throw error;
    }

    return data;
  },

  async listMyRequests() {
    const profileId = await getCurrentProfileId();
    const { data: requests, error: requestError } = await supabase
      .from('work_time_adjustment_requests')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false });

    if (requestError) {
      throw requestError;
    }

    const requestList = requests ?? [];
    if (requestList.length === 0) {
      return [];
    }

    const requestIds = requestList.map((request) => request.id);
    const { data: dates, error: dateError } = await supabase
      .from('work_time_adjustment_request_dates')
      .select('*')
      .in('request_id', requestIds)
      .order('work_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (dateError) {
      throw dateError;
    }

    return attachDatesToRequests(requestList, dates ?? []);
  },

  async listReviewDetails(status: WorkTimeAdjustmentReviewStatusFilter = 'pending') {
    let detailQuery = supabase
      .from('work_time_adjustment_request_dates')
      .select('*')
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (status !== 'all') {
      detailQuery = detailQuery.eq('status', status);
    }

    const { data: details, error: detailError } = await detailQuery;

    if (detailError) {
      throw detailError;
    }

    const detailList = details ?? [];
    if (detailList.length === 0) {
      return [];
    }

    const requestIds = [...new Set(detailList.map((detail) => detail.request_id))];
    const employeeIds = [...new Set(detailList.map((detail) => detail.employee_id))];

    const [requestResult, employeeResult] = await Promise.all([
      supabase.from('work_time_adjustment_requests').select('*').in('id', requestIds),
      supabase.from('employees').select('id, full_name, employee_code').in('id', employeeIds),
    ]);

    if (requestResult.error) {
      throw requestResult.error;
    }

    if (employeeResult.error) {
      throw employeeResult.error;
    }

    const requestsById = new Map((requestResult.data ?? []).map((request) => [request.id, request]));
    const employeesById = new Map((employeeResult.data ?? []).map((employee) => [employee.id, employee]));

    return detailList.map<WorkTimeAdjustmentReviewDetail>((detail) => ({
      ...detail,
      request: requestsById.get(detail.request_id) ?? null,
      employee: employeesById.get(detail.employee_id) ?? null,
    }));
  },

  async reviewDate(detailId: string, status: WorkTimeAdjustmentReviewDecision, note: string | null) {
    const { error } = await supabase.rpc('review_work_time_adjustment_date', {
      p_detail_id: detailId,
      p_status: status,
      p_note: note?.trim() || null,
    });

    if (error) {
      throw error;
    }
  },

  async revokeApprovedDate(detailId: string, note: string) {
    const { error } = await supabase.rpc('revoke_approved_work_time_adjustment_date', {
      p_detail_id: detailId,
      p_note: note,
    });

    if (error) {
      throw error;
    }
  },

  async updatePendingDate(detailId: string, adjustedStartTime: string) {
    const { error } = await supabase.rpc('update_pending_work_time_adjustment_date', {
      p_detail_id: detailId,
      p_adjusted_start_time: adjustedStartTime,
    });

    if (error) {
      throw error;
    }
  },

  async cancelPendingDate(detailId: string, note = '') {
    const { error } = await supabase.rpc('cancel_pending_work_time_adjustment_date', {
      p_detail_id: detailId,
      p_note: note.trim() || null,
    });

    if (error) {
      throw error;
    }
  },

  async uploadAttachment(file: File): Promise<WorkTimeAdjustmentAttachment> {
    validateAttachment(file);

    const profileId = await getCurrentProfileId();
    const extension = getAttachmentExtension(file);
    const path = `${profileId}/${Date.now()}-${sanitizeFileName(file.name)}`;
    const normalizedPath = path.endsWith(`.${extension}`) ? path : `${path}.${extension}`;

    const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(normalizedPath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

    if (error) {
      throw error;
    }

    return {
      path: normalizedPath,
      originalName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    };
  },

  async createAttachmentSignedUrl(path: string, expiresInSeconds = 60) {
    const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, expiresInSeconds);

    if (error) {
      throw error;
    }

    return data.signedUrl;
  },
};

function attachDatesToRequests(
  requests: WorkTimeAdjustmentRequest[],
  dates: WorkTimeAdjustmentRequestDate[],
): WorkTimeAdjustmentRequestItem[] {
  const datesByRequestId = new Map<string, WorkTimeAdjustmentRequestDate[]>();

  dates.forEach((date) => {
    const current = datesByRequestId.get(date.request_id) ?? [];
    current.push(date);
    datesByRequestId.set(date.request_id, current);
  });

  return requests.map((request) => ({
    ...request,
    dates: datesByRequestId.get(request.id) ?? [],
  }));
}

async function getCurrentProfileId() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!data.user?.id) {
    throw new Error('请先登录后再使用工时调整申请。');
  }

  return data.user.id;
}

function validateAttachment(file: File) {
  if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
    throw new Error('附件只支持 JPG、JPEG、PNG 或 PDF。');
  }

  if (file.size <= 0 || file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error('附件大小必须大于 0 且不超过 5MB。');
  }
}

function getAttachmentExtension(file: File) {
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === 'image/png') return 'png';
  return 'jpg';
}

function sanitizeFileName(fileName: string) {
  const fallback = 'attachment';
  const normalized = fileName
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}
