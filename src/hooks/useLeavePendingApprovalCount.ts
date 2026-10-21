import { useCallback, useEffect, useRef, useState } from 'react';
import { leaveService } from '../services/leave.service';
import { replacementWorkChangeService } from '../services/replacement-work-change.service';

const leavePendingApprovalsChangedEvent = 'dy-group:leave-pending-approvals-changed';

export type LeavePendingApprovalCounts = { leave: number; replacement: number };

export function notifyLeavePendingApprovalsChanged() {
  window.dispatchEvent(new Event(leavePendingApprovalsChangedEvent));
}

export function useLeavePendingApprovalCount(enabled = true) {
  const [counts, setCounts] = useState<LeavePendingApprovalCounts | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    if (!enabled) {
      setCounts({ leave: 0, replacement: 0 });
      return;
    }

    try {
      const [leaveRequests, replacementChanges] = await Promise.all([
        leaveService.listPendingLeaveRequests(),
        replacementWorkChangeService.listPending(),
      ]);
      if (currentRequestId !== requestId.current) return;
      setCounts({
        leave: leaveRequests.filter((request) => request.leave_type === 'annual' || request.leave_type === 'medical' || request.leave_type === 'unpaid').length,
        replacement: leaveRequests.filter((request) => request.leave_type === 'replacement').length + replacementChanges.length,
      });
    } catch {
      // Keep the last successful count rather than displaying a false zero.
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    window.addEventListener(leavePendingApprovalsChangedEvent, refresh);
    return () => window.removeEventListener(leavePendingApprovalsChangedEvent, refresh);
  }, [refresh]);

  const leave = counts?.leave ?? 0;
  const replacement = counts?.replacement ?? 0;
  return { leave, replacement, total: leave + replacement, preferredTab: leave === 0 && replacement > 0 ? 'replacement' as const : 'leave' as const, refresh };
}
