import { supabase } from '../lib/supabase';
import type { ReviewStageKey } from './designer-review-service';
import type { ReviewMode } from './designer-review-write-guard';

export async function readReviewMode(key: ReviewStageKey): Promise<ReviewMode> {
  if (!key.requestId || !key.stageId || !key.itemId) return 'unknown';
  try {
    const client = supabase as unknown as { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> };
    const { data, error } = await client.rpc('get_designer_review_stage_mode', { p_request_id: key.requestId, p_stage_id: key.stageId, p_item_id: key.itemId });
    return !error && (data === 'active' || data === 'paused' || data === 'off') ? data : 'unknown';
  } catch { return 'unknown'; }
}

export async function enableReviewStage(key: ReviewStageKey): Promise<void> {
  if (!key.requestId || !key.stageId || !key.itemId) throw new Error('设计阶段或项目资料无效。');
  const client = supabase as unknown as { rpc(name: string, args: Record<string, unknown>): Promise<{ error: { message: string } | null }> };
  const { error } = await client.rpc('enable_designer_review_stage', { p_request_id: key.requestId, p_stage_id: key.stageId, p_item_id: key.itemId });
  if (error) throw new Error(error.message);
}
