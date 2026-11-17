import { supabase } from '../lib/supabase';
import type { ReviewStageKey } from './designer-review-service';

export type HistoryImage = { id: string; originalName: string; contentType: string; sizeBytes: number; storagePath: string };
export type ReviewVersion = { id: string; version: number; submittedAt: string; note: string | null; feedback: string | null; isFinal: boolean; images: HistoryImage[] };
type Client = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };
const client = supabase as unknown as Client;
function parseVersion(value: unknown): ReviewVersion {
  const v = value as ReviewVersion;
  if (!v || typeof v.id !== 'string' || !Number.isSafeInteger(v.version) || typeof v.submittedAt !== 'string' || !Array.isArray(v.images) || v.images.some(i => !i || typeof i.id !== 'string' || typeof i.storagePath !== 'string' || typeof i.originalName !== 'string')) throw new Error('版本资料无效。');
  return v;
}
async function call(name: string, key: ReviewStageKey): Promise<unknown> {
  if (!key.itemId) throw new Error('项目资料无效。');
  const { data, error } = await client.rpc(name, { p_request_id: key.requestId, p_stage_id: key.stageId, p_item_id: key.itemId });
  if (error) throw new Error(error.message);
  return data;
}
export async function readReviewHistory(key: ReviewStageKey): Promise<ReviewVersion[]> {
  const data = await call('read_designer_review_history', key);
  if (!Array.isArray(data)) throw new Error('版本资料无效。');
  return data.map(parseVersion);
}
export async function readReviewHandoff(key: ReviewStageKey): Promise<ReviewVersion> {
  return parseVersion(await call('read_designer_review_final_handoff', key));
}
export async function readProductionHandoff(stageId: string): Promise<ReviewVersion> {
  if (!stageId) throw new Error('制作阶段资料无效。');
  const { data, error } = await client.rpc('read_designer_production_final_handoff', { p_production_stage_id: stageId });
  if (error) throw new Error(error.message);
  return parseVersion(data);
}
export async function historyImageUrl(image: HistoryImage, download = false): Promise<string> {
  const { data, error } = await supabase.storage.from('designer-stage-deliverables').createSignedUrl(image.storagePath, 60, download ? { download: image.originalName } : undefined);
  if (error) throw error;
  return data.signedUrl;
}
