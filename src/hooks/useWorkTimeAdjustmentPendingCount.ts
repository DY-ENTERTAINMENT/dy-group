import { useCallback, useEffect, useState } from 'react';
import { workTimeAdjustmentService } from '../services/work-time-adjustment.service';

const workTimeAdjustmentChangedEvent = 'dy-group:work-time-adjustment-changed';

export function notifyWorkTimeAdjustmentChanged() {
  window.dispatchEvent(new Event(workTimeAdjustmentChangedEvent));
}

export function useWorkTimeAdjustmentPendingCount(enabled = true) {
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    if (!enabled) { setCount(0); return; }
    try { setCount((await workTimeAdjustmentService.listReviewDetails('pending')).length); } catch { setCount(0); }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    window.addEventListener(workTimeAdjustmentChangedEvent, refresh);
    return () => window.removeEventListener(workTimeAdjustmentChangedEvent, refresh);
  }, [refresh]);

  return { count, refresh };
}
