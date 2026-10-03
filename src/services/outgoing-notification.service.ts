import { useCallback, useEffect, useState } from 'react';
import { getOutgoingDataMode } from './outgoing-feature.service';
import { isOutgoingLocalPreviewEnabled, outgoingLocalPreviewService } from './outgoing-local-preview.service';
import { outgoingService } from './outgoing.service';

const outgoingChangedEvent = 'dy-group:phase3:outgoing-real-service-changed';

export function notifyOutgoingRealDataChanged() {
  window.dispatchEvent(new Event(outgoingChangedEvent));
}

/**
 * No polling: the count is read on mount, and refreshed only after an outgoing
 * mutation broadcasts this local browser event. The database RPC remains the
 * authority for scope and de-duplication.
 */
export function useOutgoingPendingApprovalCount() {
  const localPreview = isOutgoingLocalPreviewEnabled();
  const mode = getOutgoingDataMode(localPreview);
  const [count, setCount] = useState(() => mode === 'local-preview' ? outgoingLocalPreviewService.getPendingCount() : 0);

  const refresh = useCallback(async () => {
    if (mode === 'local-preview') {
      setCount(outgoingLocalPreviewService.getPendingCount());
      return;
    }
    if (mode !== 'real') {
      setCount(0);
      return;
    }
    try {
      setCount(await outgoingService.getPendingApprovalCount());
    } catch {
      // A notification badge must never block attendance navigation or expose
      // a stale fixed number when the real service is unavailable.
      setCount(0);
    }
  }, [mode]);

  useEffect(() => {
    void refresh();
    if (mode === 'local-preview') return outgoingLocalPreviewService.subscribe(() => void refresh());
    if (mode === 'real') {
      window.addEventListener(outgoingChangedEvent, refresh);
      return () => window.removeEventListener(outgoingChangedEvent, refresh);
    }
    return undefined;
  }, [mode, refresh]);

  return { count, refresh, mode };
}
