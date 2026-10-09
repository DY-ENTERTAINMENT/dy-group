import type { OutgoingEvent, OutgoingRequest, OutgoingRequestEvidence, OutgoingRequestReviewHistory, OutgoingType } from '../types/database';
import { assertOutgoingRealServiceEnabled } from './outgoing-feature.service';
import { notifyOutgoingRealDataChanged } from './outgoing-notification.service';
import {
  outgoingService,
  type OutgoingCaptureValues,
  type OutgoingManagementFilters,
  type OutgoingRequestFormValues,
  type OutgoingRequestWithEvent,
} from './outgoing.service';
import { getOutgoingLifecycleStatus, type OutgoingLifecycleStatus } from './outgoing-event-relation';

export type { OutgoingLifecycleStatus } from './outgoing-event-relation';

export type OutgoingEmployeeState = {
  requests: OutgoingRequestWithEvent[];
  current: OutgoingRequestWithEvent | null;
};

export type OutgoingManagementState = {
  requests: OutgoingRequestWithEvent[];
  counts: Record<'pending' | 'approved' | 'in_progress' | 'completed' | 'exception', number>;
};

/**
 * The real-data adapter is intentionally separate from the localhost mock
 * service. Every entry point checks the feature gate before it reaches
 * outgoing.service, so importing this module has no network side effects.
 */
export const outgoingRealAdapter = {
  async getAdmissionsEnabled() {
    assertOutgoingRealServiceEnabled();
    return outgoingService.getAdmissionsEnabled();
  },
  async setAdmissionsEnabled(enabled: boolean) {
    assertOutgoingRealServiceEnabled();
    await outgoingService.setAdmissionsEnabled(enabled);
    notifyOutgoingRealDataChanged();
  },
  async loadEmployeeState(): Promise<OutgoingEmployeeState> {
    assertOutgoingRealServiceEnabled();
    const requests = await outgoingService.listMyRequests();
    return { requests, current: selectCurrentRequest(requests) };
  },

  async createRequest(values: OutgoingRequestFormValues) {
    assertOutgoingRealServiceEnabled();
    const result = await outgoingService.createRequest(values);
    notifyOutgoingRealDataChanged();
    return result;
  },

  async cancelRequest(requestId: string) {
    assertOutgoingRealServiceEnabled();
    await outgoingService.cancelRequest(requestId);
    notifyOutgoingRealDataChanged();
  },

  async loadReviewHistory(requestId: string): Promise<OutgoingRequestReviewHistory[]> {
    assertOutgoingRealServiceEnabled();
    return outgoingService.listReviewHistory(requestId);
  },

  async loadMyEvidence(requestId: string): Promise<OutgoingRequestEvidence[]> {
    assertOutgoingRealServiceEnabled();
    return outgoingService.listMyEvidence(requestId);
  },
  async loadManagedEvidence(requestId: string): Promise<OutgoingRequestEvidence[]> {
    assertOutgoingRealServiceEnabled();
    return outgoingService.listManagedEvidence(requestId);
  },
  async uploadEvidence(requestId: string, file: File) {
    assertOutgoingRealServiceEnabled();
    const evidence = await outgoingService.uploadEvidence(requestId, file);
    notifyOutgoingRealDataChanged();
    return evidence;
  },

  async startOutgoing(values: OutgoingCaptureValues) {
    assertOutgoingRealServiceEnabled();
    const result = await outgoingService.startOutgoing(values);
    clearOutgoingOperation(values.requestId, 'start');
    notifyOutgoingRealDataChanged();
    return result;
  },

  async finishOutgoing(values: OutgoingCaptureValues) {
    assertOutgoingRealServiceEnabled();
    const result = await outgoingService.finishOutgoing(values);
    clearOutgoingOperation(values.requestId, 'end');
    notifyOutgoingRealDataChanged();
    return result;
  },

  async loadManagementState(filters: OutgoingManagementFilters = {}): Promise<OutgoingManagementState> {
    assertOutgoingRealServiceEnabled();
    const requests = await outgoingService.listManagedRequests(filters);
    return { requests, counts: countByLifecycle(requests) };
  },

  async reviewRequest(requestId: string, decision: 'approved' | 'rejected', rejectionReason?: string) {
    assertOutgoingRealServiceEnabled();
    await outgoingService.reviewRequest(requestId, decision, rejectionReason);
    notifyOutgoingRealDataChanged();
  },

  async handleException(eventId: string) {
    assertOutgoingRealServiceEnabled();
    await outgoingService.handleException(eventId);
    notifyOutgoingRealDataChanged();
  },

  async reconcileExceptions(employeeId?: string) {
    assertOutgoingRealServiceEnabled();
    const result = await outgoingService.reconcileExceptions(employeeId);
    if (result) notifyOutgoingRealDataChanged();
    return result;
  },

  async getPendingApprovalCount() {
    assertOutgoingRealServiceEnabled();
    return outgoingService.getPendingApprovalCount();
  },

  async getPhotoSignedUrl(photoPath: string, expiresIn = 60) {
    assertOutgoingRealServiceEnabled();
    return outgoingService.getPhotoSignedUrl(photoPath, expiresIn);
  },
  async getEvidenceSignedUrl(photoPath: string, expiresIn = 60) {
    assertOutgoingRealServiceEnabled();
    return outgoingService.getEvidenceSignedUrl(photoPath, expiresIn);
  },
};

const operationStoragePrefix = 'dy-group:phase3:outgoing-operation:';
type PendingOutgoingOperation = { idempotencyKey: string; photoPath: string | null };

export function getOrCreateOutgoingIdempotencyKey(requestId: string, phase: 'start' | 'end') {
  const existing = readPendingOutgoingOperation(requestId, phase);
  if (existing) return existing.idempotencyKey;
  const key = createOutgoingIdempotencyKey();
  writePendingOutgoingOperation(requestId, phase, { idempotencyKey: key, photoPath: null });
  return key;
}

export function clearOutgoingIdempotencyKey(requestId: string, phase: 'start' | 'end') {
  clearOutgoingOperation(requestId, phase);
}

export function createOutgoingCaptureValues(input: Omit<OutgoingCaptureValues, 'idempotencyKey' | 'photoPath' | 'onPhotoUploaded'>, phase: 'start' | 'end'): OutgoingCaptureValues {
  const idempotencyKey = getOrCreateOutgoingIdempotencyKey(input.requestId, phase);
  const operation = readPendingOutgoingOperation(input.requestId, phase);
  return {
    ...input,
    idempotencyKey,
    photoPath: operation?.photoPath ?? null,
    onPhotoUploaded: (photoPath) => writePendingOutgoingOperation(input.requestId, phase, { idempotencyKey, photoPath }),
  };
}

function readPendingOutgoingOperation(requestId: string, phase: 'start' | 'end'): PendingOutgoingOperation | null {
  try {
    const value = window.sessionStorage.getItem(operationStorageKey(requestId, phase));
    if (!value) return null;
    const operation = JSON.parse(value) as PendingOutgoingOperation;
    return operation.idempotencyKey ? operation : null;
  } catch {
    return null;
  }
}

function writePendingOutgoingOperation(requestId: string, phase: 'start' | 'end', operation: PendingOutgoingOperation) {
  window.sessionStorage.setItem(operationStorageKey(requestId, phase), JSON.stringify(operation));
}

function clearOutgoingOperation(requestId: string, phase: 'start' | 'end') {
  window.sessionStorage.removeItem(operationStorageKey(requestId, phase));
}

function operationStorageKey(requestId: string, phase: 'start' | 'end') {
  return `${operationStoragePrefix}${requestId}:${phase}`;
}

function createOutgoingIdempotencyKey() {
  if (typeof crypto?.randomUUID !== 'function') {
    throw new Error('当前浏览器不支持外出打卡所需的幂等键。');
  }
  return crypto.randomUUID();
}

export function lifecycleStatus(request: OutgoingRequestWithEvent): OutgoingLifecycleStatus {
  return getOutgoingLifecycleStatus(request);
}

function selectCurrentRequest(requests: OutgoingRequestWithEvent[]) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  return requests
    .filter((request) => {
      const status = lifecycleStatus(request);
      if (status === 'cancelled') return false;
      if (status === 'in_progress' || status === 'exception') return true;
      if (status === 'completed') return request.outgoing_date === today;
      return request.outgoing_date >= today;
    })
    .sort((left, right) => lifecyclePriority(right) - lifecyclePriority(left) || right.updated_at.localeCompare(left.updated_at))[0] ?? null;
}

function lifecyclePriority(request: OutgoingRequestWithEvent) {
  const status = lifecycleStatus(request);
  return status === 'in_progress' ? 4 : status === 'approved' ? 3 : status === 'pending' ? 2 : 1;
}

function countByLifecycle(requests: OutgoingRequestWithEvent[]) {
  return requests.reduce<Record<'pending' | 'approved' | 'in_progress' | 'completed' | 'exception', number>>(
    (counts, request) => {
      const status = lifecycleStatus(request);
      if (status in counts) counts[status as keyof typeof counts] += 1;
      return counts;
    },
    { pending: 0, approved: 0, in_progress: 0, completed: 0, exception: 0 },
  );
}

export type { OutgoingCaptureValues, OutgoingManagementFilters, OutgoingRequestFormValues, OutgoingRequestWithEvent, OutgoingRequest, OutgoingEvent, OutgoingRequestEvidence, OutgoingType };
