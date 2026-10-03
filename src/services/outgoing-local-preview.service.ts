import type { OutgoingType } from '../types/database';

export type LocalOutgoingRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type LocalOutgoingLifecycle = 'none' | 'in_progress' | 'completed' | 'exception';
export type LocalOutgoingAttendanceStatus = 'not_started' | 'working' | 'on_break' | 'clocked_out';
export type LocalOutgoingRequest = {
  id: string;
  profileId: string;
  employeeName: string;
  regionId: string | null;
  regionCode: string;
  outgoingDate: string;
  plannedStartTime: string;
  plannedReturnTime: string;
  outgoingType: OutgoingType;
  location: string;
  reason: string;
  relatedContact: string | null;
  remarks: string | null;
  status: LocalOutgoingRequestStatus;
  reviewNote: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  lifecycle: LocalOutgoingLifecycle;
  startedAt: string | null;
  endedAt: string | null;
  exceptionReason: string | null;
  exceptionHandledAt: string | null;
  exceptionHandledByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LocalOutgoingRequestInput = Pick<LocalOutgoingRequest, 'profileId' | 'employeeName' | 'regionId' | 'regionCode' | 'outgoingDate' | 'plannedStartTime' | 'plannedReturnTime' | 'outgoingType' | 'location' | 'reason' | 'relatedContact' | 'remarks'>;

const storageKey = 'dy-group:phase3:outgoing-local-preview:v1';
const attendanceMockStorageKey = 'dy-group:phase3:outgoing-local-preview:attendance-status:v1';
const changeEvent = 'dy-group:phase3:outgoing-local-preview:changed';

export function isOutgoingLocalPreviewEnabled() {
  const host = window.location.hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export const outgoingLocalPreviewService = {
  list() {
    return read();
  },

  listForProfile(profileId: string) {
    return read().filter((request) => request.profileId === profileId);
  },

  getPendingCount() {
    return read().filter((request) => request.status === 'pending').length;
  },

  getCurrentForProfile(profileId: string) {
    return this.listForProfile(profileId).sort((a, b) => priority(b) - priority(a) || b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  },

  /** A null value deliberately means "use the real attendance summary". */
  getMockAttendanceStatus(profileId: string, date: string): LocalOutgoingAttendanceStatus | null {
    assertEnabled();
    return readAttendanceMocks()[attendanceMockKey(profileId, date)] ?? null;
  },

  setMockAttendanceStatus(profileId: string, date: string, status: LocalOutgoingAttendanceStatus | null) {
    assertEnabled();
    const mocks = readAttendanceMocks();
    const key = attendanceMockKey(profileId, date);
    if (status === null) delete mocks[key]; else mocks[key] = status;
    window.localStorage.setItem(attendanceMockStorageKey, JSON.stringify(mocks));
    window.dispatchEvent(new Event(changeEvent));
  },

  create(input: LocalOutgoingRequestInput) {
    assertEnabled();
    validateInput(input);
    const current = read();
    const overlaps = current.some((request) => request.profileId === input.profileId && request.outgoingDate === input.outgoingDate && ['pending', 'approved'].includes(request.status) && timesOverlap(input.plannedStartTime, input.plannedReturnTime, request.plannedStartTime, request.plannedReturnTime));
    if (overlaps) throw new Error('本地测试：该日期已有时间重叠的待审批或已批准申请。');
    const now = new Date().toISOString();
    const request: LocalOutgoingRequest = { id: createId(), ...input, relatedContact: input.relatedContact?.trim() || null, remarks: input.remarks?.trim() || null, location: input.location.trim(), reason: input.reason.trim(), status: 'pending', reviewNote: null, reviewedByName: null, reviewedAt: null, lifecycle: 'none', startedAt: null, endedAt: null, exceptionReason: null, exceptionHandledAt: null, exceptionHandledByName: null, createdAt: now, updatedAt: now };
    write([request, ...current]);
    return request;
  },

  cancel(requestId: string, profileId: string) {
    return transition(requestId, (request) => {
      if (request.profileId !== profileId || !['pending', 'approved'].includes(request.status) || request.lifecycle !== 'none') throw new Error('本地测试：只有尚未开始的待审批或已批准申请可以取消。');
      return { ...request, status: 'cancelled' };
    });
  },

  review(requestId: string, decision: 'approved' | 'rejected', reviewerName: string, note?: string) {
    return transition(requestId, (request) => {
      if (request.status !== 'pending') throw new Error('本地测试：该申请已处理，不能重复审批。');
      const rejectionReason = note?.trim() ?? '';
      if (decision === 'rejected' && !rejectionReason) throw new Error('请填写拒绝原因。');
      return { ...request, status: decision, reviewNote: decision === 'rejected' ? rejectionReason : null, reviewedByName: reviewerName, reviewedAt: new Date().toISOString() };
    });
  },

  start(requestId: string, profileId: string, attendanceStatus: LocalOutgoingAttendanceStatus) {
    return transition(requestId, (request, all) => {
      if (request.profileId !== profileId || request.status !== 'approved' || request.lifecycle !== 'none') throw new Error('本地测试：该申请不能开始外出。');
      if (request.outgoingDate !== malaysiaDateKey()) throw new Error('本地测试：只能开始当天已批准的外出申请。');
      if (attendanceStatus !== 'working') throw new Error('本地测试：只有模拟工作中时才能开始外出。');
      if (all.some((item) => item.profileId === profileId && item.id !== request.id && item.lifecycle === 'in_progress')) throw new Error('本地测试：当前已有进行中的外出。');
      return { ...request, lifecycle: 'in_progress', startedAt: new Date().toISOString() };
    });
  },

  finish(requestId: string, profileId: string) {
    return transition(requestId, (request) => {
      if (request.profileId !== profileId || request.lifecycle !== 'in_progress') throw new Error('本地测试：该申请不能结束外出。');
      return { ...request, lifecycle: 'completed', endedAt: new Date().toISOString() };
    });
  },

  markException(requestId: string) {
    return transition(requestId, (request) => {
      if (request.lifecycle !== 'in_progress') throw new Error('本地测试：只有外出中的申请可以标记异常。');
      return { ...request, lifecycle: 'exception', exceptionReason: '本地测试：员工下班前未结束外出。' };
    });
  },

  handleException(requestId: string, handlerName: string) {
    return transition(requestId, (request) => {
      if (request.lifecycle !== 'exception' || request.exceptionHandledAt) throw new Error('本地测试：该异常无法重复处理。');
      return { ...request, exceptionHandledAt: new Date().toISOString(), exceptionHandledByName: handlerName };
    });
  },

  subscribe(listener: () => void) {
    const notify = () => listener();
    window.addEventListener(changeEvent, notify);
    window.addEventListener('storage', notify);
    return () => { window.removeEventListener(changeEvent, notify); window.removeEventListener('storage', notify); };
  },
};

function transition(requestId: string, updater: (request: LocalOutgoingRequest, all: LocalOutgoingRequest[]) => LocalOutgoingRequest) {
  assertEnabled();
  const current = read();
  const target = current.find((request) => request.id === requestId);
  if (!target) throw new Error('本地测试申请不存在或已被移除。');
  const updated = updater(target, current);
  const next = current.map((request) => request.id === requestId ? { ...updated, updatedAt: new Date().toISOString() } : request);
  write(next);
  return next.find((request) => request.id === requestId)!;
}

function read(): LocalOutgoingRequest[] {
  if (!isOutgoingLocalPreviewEnabled()) return [];
  try { const value = window.localStorage.getItem(storageKey); return value ? JSON.parse(value) as LocalOutgoingRequest[] : []; } catch { return []; }
}

function readAttendanceMocks(): Record<string, LocalOutgoingAttendanceStatus> {
  if (!isOutgoingLocalPreviewEnabled()) return {};
  try {
    const value = window.localStorage.getItem(attendanceMockStorageKey);
    return value ? JSON.parse(value) as Record<string, LocalOutgoingAttendanceStatus> : {};
  } catch { return {}; }
}

function write(requests: LocalOutgoingRequest[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(requests));
  window.dispatchEvent(new Event(changeEvent));
}

function assertEnabled() { if (!isOutgoingLocalPreviewEnabled()) throw new Error('本地外出测试仅允许在 localhost 使用。'); }
function attendanceMockKey(profileId: string, date: string) { return `${profileId}:${date}`; }
function createId() { return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function timesOverlap(startA: string, endA: string, startB: string, endB: string) { return !(endA <= startB || startA >= endB); }
function validateInput(input: LocalOutgoingRequestInput) {
  if (!input.outgoingDate || !input.plannedStartTime || !input.plannedReturnTime || !input.location.trim() || !input.reason.trim()) throw new Error('请填写所有必填外出申请字段。');
  if (input.plannedReturnTime <= input.plannedStartTime) throw new Error('预计返回时间必须晚于预计开始时间。');
  if (input.outgoingDate < malaysiaDateKey()) throw new Error('本地测试不允许提交过去日期。');
}
function malaysiaDateKey() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()); }
function priority(request: LocalOutgoingRequest) { return request.lifecycle === 'in_progress' ? 4 : request.status === 'approved' && request.lifecycle === 'none' ? 3 : request.status === 'pending' ? 2 : 1; }
