import { supabase } from '../lib/supabase';
import type { CleanupReviewUpload, CreateReviewUpload, DeleteReviewImage, RegisterReviewUpload, ReviewImage, ReviewUploadInspection, ReviewUploadSession, TransferReviewUpload } from './designer-review-service';
import { requireActiveReviewStage } from './designer-review-write-guard';
import { readReviewMode } from './designer-review-mode';

// Server-side stage state authorizes each operation.
const bucket = 'designer-stage-deliverables';
type RpcResult = { data: unknown; error: { message: string } | null };
type RpcClient = { rpc(name: string, args: Record<string, unknown>): Promise<RpcResult> };
const rpcClient = supabase as unknown as RpcClient;
type Row = Record<string, unknown>;
const ext: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('服务器返回的数据无效。');
  return value as Row;
}
function str(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('服务器返回的标识无效。');
  return value;
}
async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await rpcClient.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
function validFile(file: File): string {
  const extension = ext[file.type];
  const suffix = file.name.split('.').pop()?.toLowerCase();
  if (!extension || (suffix !== extension && !(file.type === 'image/jpeg' && suffix === 'jpeg')) || file.size <= 0 || file.size > 50 * 1024 * 1024) {
    throw new Error('仅支持不超过 50MB 的 JPG、PNG 或 WebP 图片。');
  }
  return extension;
}

export const designerReviewAssets = {
  async createUpload(input: CreateReviewUpload): Promise<ReviewUploadSession> {
    await requireActiveReviewStage(readReviewMode, input.key);
    const extension = validFile(input.file);
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!user || !input.key.itemId) throw new Error('登录或项目资料无效。');
    const path = `${user.id}/${input.key.stageId}/${input.uploadTaskId}.${extension}`;
    const result = row(await call('create_designer_review_upload_session', {
      p_upload_task_id: input.uploadTaskId, p_request_id: input.key.requestId, p_stage_id: input.key.stageId, p_item_id: input.key.itemId,
      p_storage_path: path, p_original_name: input.file.name, p_content_type: input.file.type,
      p_size_bytes: input.file.size, p_file_fingerprint: `${input.file.name}:${input.file.size}:${input.file.type}:${input.file.lastModified}`,
      p_last_modified: input.file.lastModified, p_expected_revision: input.expectedRevision,
    }));
    if (result.storage_path !== path || result.upload_task_id !== input.uploadTaskId) throw new Error('上传会话不匹配。');
    return { uploadTaskId: input.uploadTaskId, storagePath: path, status: str(result.status) as ReviewUploadSession['status'], expiresAt: str(result.expires_at) };
  },
  async transferUpload(input: TransferReviewUpload): Promise<void> {
    await requireActiveReviewStage(readReviewMode, input.key);
    validFile(input.file);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!user || !input.key.itemId || !input.session.storagePath.startsWith(`${user.id}/${input.key.stageId}/`)) throw new Error('上传路径无效。');
    const { error } = await supabase.storage.from(bucket).upload(input.session.storagePath, input.file, { upsert: false, contentType: input.file.type });
    if (error) throw error;
  },
  async registerUpload(input: RegisterReviewUpload): Promise<ReviewImage> {
    await requireActiveReviewStage(readReviewMode, input.key);
    const result = row(await call('register_designer_review_upload', { p_upload_task_id: input.uploadTaskId, p_expected_revision: input.expectedRevision }));
    if (result.request_id !== input.key.requestId || result.stage_id !== input.key.stageId || result.request_item_id !== input.key.itemId) throw new Error('图片归属不匹配。');
    if (typeof result.size_bytes !== 'number' || typeof result.content_type !== 'string' || !ext[result.content_type]) throw new Error('图片资料无效。');
    return { id: str(result.id), originalName: str(result.original_name), contentType: result.content_type as ReviewImage['contentType'], sizeBytes: result.size_bytes };
  },
  async cleanupUpload(input: CleanupReviewUpload): Promise<void> {
    await requireActiveReviewStage(readReviewMode, input.key);
    if (!input.key.itemId) throw new Error('项目资料无效。');
    await call('request_designer_review_upload_cleanup', { p_upload_task_id: input.uploadTaskId, p_request_id: input.key.requestId, p_stage_id: input.key.stageId, p_item_id: input.key.itemId });
  },
  async inspectUpload(input: CleanupReviewUpload): Promise<ReviewUploadInspection> {
    if (!input.key.itemId) throw new Error('项目资料无效。');
    const result = row(await call('inspect_designer_review_upload', {
      p_upload_task_id: input.uploadTaskId, p_request_id: input.key.requestId,
      p_stage_id: input.key.stageId, p_item_id: input.key.itemId,
    }));
    const state = str(result.state);
    if (state === 'not_found') return { state, expectedRevision: null, objectExists: false };
    if (!['pending','uploading','uploaded','registering','consumed','cleanup_requested','cleanup_failed','cleaned','expired','cancelled'].includes(state)
      || result.uploadTaskId !== input.uploadTaskId || !Number.isSafeInteger(result.expectedRevision) || typeof result.objectExists !== 'boolean') throw new Error('上传会话状态无效。');
    return { state: state as ReviewUploadInspection['state'], expectedRevision: result.expectedRevision as number, objectExists: result.objectExists };
  },
  async deleteImage(input: DeleteReviewImage): Promise<void> {
    await requireActiveReviewStage(readReviewMode, input.key);
    if (!input.key.itemId) throw new Error('项目资料无效。');
    await call('remove_designer_review_image', { p_request_id: input.key.requestId, p_stage_id: input.key.stageId, p_item_id: input.key.itemId, p_deliverable_id: input.imageId, p_expected_revision: input.expectedRevision, p_operation_id: input.idempotencyKey });
  },
};
