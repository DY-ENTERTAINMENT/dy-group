import { isSupabaseConfigured } from '../lib/supabase';

/**
 * Real outgoing access is deliberately opt-in three times. The release gate
 * is new for the first Production rollout, so an existing Vercel environment
 * cannot enable this feature unless the release approver explicitly adds it.
 */
export function isOutgoingRealServiceEnabled() {
  return isSupabaseConfigured
    && import.meta.env.VITE_ENABLE_OUTGOING_REAL_SERVICE === 'true'
    && import.meta.env.VITE_OUTGOING_REAL_SERVICE_APPROVED === 'true'
    && import.meta.env.VITE_OUTGOING_REAL_SERVICE_RELEASE_APPROVED === 'true';
}

export function assertOutgoingRealServiceEnabled() {
  if (!isOutgoingRealServiceEnabled()) {
    throw new Error('外出真实服务尚未启用；不会调用外出 RPC 或上传外出照片。');
  }
}

export type OutgoingDataMode = 'local-preview' | 'real' | 'disabled';

export function getOutgoingDataMode(isLocalPreview: boolean): OutgoingDataMode {
  if (isOutgoingRealServiceEnabled()) return 'real';
  return isLocalPreview ? 'local-preview' : 'disabled';
}
