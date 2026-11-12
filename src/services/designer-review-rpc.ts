import { supabase } from '../lib/supabase';
import { designerReviewAssets } from './designer-review-assets';
import type { DesignerReviewService, ReviewImage, ReviewSnapshot, ReviewStageKey } from './designer-review-service';
import { guardReviewWrites } from './designer-review-write-guard';
import { readReviewMode } from './designer-review-mode';

// The server authorizes the selected Stage for every operation.
type Client = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };
const client = supabase as unknown as Client;
type ObjectRow = Record<string, unknown>;
function object(value: unknown): ObjectRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('服务器返回数据无效。');
  return value as ObjectRow;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('服务器返回标识无效。');
  return value;
}
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
async function rawSnapshot(key: ReviewStageKey): Promise<ObjectRow> {
  if (!key.itemId) throw new Error('项目资料无效。');
  const value = object(await rpc('read_designer_review_current', { p_request_id: key.requestId, p_stage_id: key.stageId, p_item_id: key.itemId }));
  const actual = object(value.key);
  if (actual.requestId !== key.requestId || actual.stageId !== key.stageId || actual.itemId !== key.itemId) throw new Error('项目资料不匹配。');
  return value;
}
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
function image(value: unknown): ReviewImage {
  const r = object(value);
  const contentType = text(r.contentType);
  if (!imageTypes.has(contentType) || typeof r.sizeBytes !== 'number' || !Number.isSafeInteger(r.sizeBytes) || r.sizeBytes <= 0) throw new Error('图片资料无效。');
  return { id: text(r.id), originalName: text(r.originalName), contentType: contentType as ReviewImage['contentType'], sizeBytes: r.sizeBytes };
}

export const designerReviewRpcService: DesignerReviewService = Object.freeze(guardReviewWrites({
  async readCurrent(key) {
    const r = await rawSnapshot(key);
    if (!['in_progress', 'revision', 'awaiting_agent_confirmation', 'completed'].includes(String(r.status)) || !Number.isSafeInteger(r.draftRevision) || !Array.isArray(r.images) || typeof r.feedbackCount !== 'number') throw new Error('审核状态无效。');
    return { key, status: r.status, draftRevision: r.draftRevision, pendingSubmissionId: r.pendingSubmissionId, finalSubmissionId: r.finalSubmissionId, images: r.images.map(image), submittedNote: r.submittedNote, latestFeedback: r.latestFeedback, feedbackCount: r.feedbackCount } as ReviewSnapshot;
  },
  createUpload: designerReviewAssets.createUpload,
  transferUpload: designerReviewAssets.transferUpload,
  registerUpload: designerReviewAssets.registerUpload,
  cleanupUpload: designerReviewAssets.cleanupUpload,
  inspectUpload: designerReviewAssets.inspectUpload,
  deleteImage: designerReviewAssets.deleteImage,
  async submit(input) {
    const id = await rpc('submit_designer_review_current_set', { p_stage_id: input.key.stageId, p_expected_revision: input.expectedRevision, p_note: input.note, p_operation_id: input.operationId });
    return { submissionId: text(id) };
  },
  async requestChanges(input) {
    if (!input.feedback.trim()) throw new Error('请填写修改意见。');
    await rpc('return_designer_review_submission', { p_stage_id: input.key.stageId, p_expected_submission_id: input.expectedSubmissionId, p_feedback: input.feedback.trim() });
  },
  async confirmFinal(input) {
    await rpc('confirm_designer_review_submission', { p_stage_id: input.key.stageId, p_expected_submission_id: input.expectedSubmissionId });
  },
  async imageUrl(key, imageId, download) {
    const snapshot = await rawSnapshot(key);
    if (!Array.isArray(snapshot.images)) throw new Error('图片资料无效。');
    const match = snapshot.images.map(object).find(r => r.id === imageId);
    if (!match) throw new Error('图片不可用。');
    const name = text(match.originalName);
    const { data, error } = await supabase.storage.from('designer-stage-deliverables').createSignedUrl(text(match.storagePath), 60, download ? { download: name } : undefined);
    if (error) throw error;
    return { url: data.signedUrl, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  },
}, readReviewMode));
