import { isSupabaseConfigured } from '../lib/supabase';

/** The database is the authority for outgoing admission. */
export function isOutgoingRealServiceEnabled() {
  return isSupabaseConfigured;
}

export function assertOutgoingRealServiceEnabled() {
  if (!isOutgoingRealServiceEnabled()) {
    throw new Error('Supabase 服务尚未配置；不会调用外出 RPC 或上传外出照片。');
  }
}

export type OutgoingDataMode = 'local-preview' | 'real' | 'disabled';

export function getOutgoingDataMode(isLocalPreview: boolean): OutgoingDataMode {
  if (isOutgoingRealServiceEnabled()) return 'real';
  return isLocalPreview ? 'local-preview' : 'disabled';
}
