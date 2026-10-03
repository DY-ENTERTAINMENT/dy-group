import { isSupabaseConfigured } from '../lib/supabase';

/**
 * Real outgoing access is deliberately opt-in twice. Both build-time values
 * must be set to the literal string "true" only after the isolated database
 * validation and an explicit release approval. The default is always off.
 */
export function isOutgoingRealServiceEnabled() {
  return isSupabaseConfigured
    && import.meta.env.VITE_ENABLE_OUTGOING_REAL_SERVICE === 'true'
    && import.meta.env.VITE_OUTGOING_REAL_SERVICE_APPROVED === 'true';
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
