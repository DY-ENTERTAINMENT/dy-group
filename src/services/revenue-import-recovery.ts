import type { RevenueBulkReport } from './revenue-import-save';

export type PendingRequest = { requestId: string; selected: string[] };

// Only an exact report and authenticated actor can recover a previous request.
export async function recoveryKeyForActor(actorId: string, report: RevenueBulkReport): Promise<string> {
  if (!actorId || !crypto.subtle) throw new Error('无法确认登录身份或恢复记录，暂不能保存。');
  const bytes = new TextEncoder().encode(JSON.stringify([actorId, report.platform, report.periodStart, report.periodEnd, report.fileSha256, report.verifiedThrough, report.rows]));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return `revenue-bulk-request-v1:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`;
}
export function readRequest(key: string, report: RevenueBulkReport): PendingRequest | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('本地恢复记录无效，请联系管理员核对。');
  const item = value as Partial<PendingRequest>;
  const allowed = new Set(report.rows.map(row => row.uid));
  if (typeof item.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.requestId) ||
      !Array.isArray(item.selected) || !item.selected.length || item.selected.some(uid => typeof uid !== 'string' || !allowed.has(uid)) || new Set(item.selected).size !== item.selected.length)
    throw new Error('本地恢复记录无效，请联系管理员核对。');
  return { requestId: item.requestId, selected: item.selected };
}
