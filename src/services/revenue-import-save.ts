import { supabase } from '../lib/supabase';

// Keep closed until the migration has been reviewed, deployed and verified.
export const BULK_SAVE_ENABLED = false;
// Enable separately only after observation deployment is approved.
const BULK_OBSERVATION_ENABLED = false;
export type RevenueBulkRow = { uid: string; amount: string };
export type RevenueBulkReport = {
  platform: 'tiktok' | 'douyin'; periodStart: string; periodEnd: string;
  fileSha256: string; verifiedThrough: string; rows: RevenueBulkRow[];
};
export type RevenueEligibility = { uid: string; status: 'eligible' | 'equal' | 'conflict' | 'blocked'; reason: string };
export type RevenueBulkRowResult = { uid: string; outcome: 'saved' | 'skipped' | 'conflict' | 'failed'; reason: string };
export type RevenueBulkSaveResult = { requestId: string; results: RevenueBulkRowResult[] };

function assertReport(report: RevenueBulkReport) {
  if (!/^[a-f0-9]{64}$/.test(report.fileSha256) || report.verifiedThrough < report.periodEnd ||
      report.rows.length < 1 || report.rows.length > 500 ||
      new Set(report.rows.map(row => row.uid)).size !== report.rows.length ||
      report.rows.some(row => !row.uid || row.uid !== row.uid.trim() || !/^\d{1,12}(?:\.\d{1,2})?$/.test(row.amount)))
    throw new Error('报表摘要、截止日期或完整行集合不符合保存条件，请重新核对。');
}
const args = (report: RevenueBulkReport) => ({p_platform: report.platform, p_start: report.periodStart,
  p_end: report.periodEnd, p_file_sha256: report.fileSha256, p_verified_through: report.verifiedThrough, p_rows: report.rows});
function disabled() { if (!BULK_SAVE_ENABLED) throw new Error('批量保存尚未开放：服务器接口未获批准。'); }

// Observation and saving are independently controlled.
// Each awaited RPC is a separate request/transaction; missing or busy profiles remain blocked.
export async function observeFutureDirectModes(profileIds: string[], shouldContinue: () => boolean): Promise<void> {
  if (!BULK_OBSERVATION_ENABLED) return;
  const ids = [...new Set(profileIds)].sort();
  for (let offset = 0; offset < ids.length && shouldContinue(); offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    for (let pass = 0; pass < 4 && shouldContinue(); pass++) {
      const { error } = await (supabase as any).rpc('observe_creator_weekly_direct_v5', { p_profiles: batch });
      if (error) throw new Error('Direct mode observation unavailable');
    }
  }
}

export async function preflightRevenueImport(report: RevenueBulkReport): Promise<RevenueEligibility[]> {
  disabled(); assertReport(report);
  const { data, error } = await (supabase as any).rpc('preflight_creator_weekly_bulk_v4', args(report));
  if (error || !Array.isArray(data) || data.length !== report.rows.length) throw new Error('服务器资格核对不可用或结果不完整。');
  const remaining = new Set(report.rows.map(row => row.uid));
  for (const item of data) if (!item || typeof item.uid !== 'string' || !remaining.delete(item.uid) ||
    !['eligible','equal','conflict','blocked'].includes(item.status) || typeof item.reason !== 'string')
    throw new Error('服务器资格结果无效，请重新核对。');
  if (remaining.size) throw new Error('服务器资格结果不完整，请重新核对。');
  return data as RevenueEligibility[];
}

// Keep the same request ID and immutable report/selection when retrying after a timeout.
export async function saveRevenueImport(report: RevenueBulkReport, selectedUids: string[], requestId: string, confirmsComplete: boolean): Promise<RevenueBulkSaveResult> {
  disabled(); assertReport(report);
  const available = new Set(report.rows.map(row => row.uid));
  if (!requestId || !confirmsComplete || !selectedUids.length || new Set(selectedUids).size !== selectedUids.length ||
      selectedUids.some(uid => !available.has(uid))) throw new Error('确认内容或选中记录无效。');
  const { data, error } = await (supabase as any).rpc('save_creator_weekly_bulk_v4', {
    ...args(report), p_request: requestId, p_selected_uids: selectedUids, p_confirmed: confirmsComplete,
  });
  if (error) throw new Error('保存结果未知或失败，请保留原请求标识并重新核对。');
  if (!data || data.requestId !== requestId || !Array.isArray(data.results) || data.results.length !== selectedUids.length)
    throw new Error('服务器返回结果不完整，请勿视为保存成功。');
  const remaining = new Set(selectedUids);
  for (const item of data.results) if (!item || typeof item.uid !== 'string' || !remaining.delete(item.uid) ||
    !['saved','skipped','conflict','failed'].includes(item.outcome) || typeof item.reason !== 'string')
    throw new Error('服务器返回的逐项结果无效，请勿视为保存成功。');
  if (remaining.size) throw new Error('服务器返回的逐项结果不完整，请勿视为保存成功。');
  return data as RevenueBulkSaveResult;
}
