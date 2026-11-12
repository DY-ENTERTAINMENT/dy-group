import type { DesignerReviewService, ReviewStageKey } from './designer-review-service';

export type ReviewMode = 'active' | 'paused' | 'off' | 'unknown';
export type ReadReviewMode = (key: ReviewStageKey) => Promise<ReviewMode>;

export function canStartReviewAction(role: 'designer' | 'agent', requiredRole: 'designer' | 'agent', paused: boolean, recoveryBlocked: boolean): boolean {
  return role === requiredRole && !paused && !recoveryBlocked;
}

export async function requireActiveReviewStage(readMode: ReadReviewMode, key: ReviewStageKey): Promise<void> {
  if (!key.requestId || !key.stageId || !key.itemId) throw new Error('项目资料无效，操作未执行。');
  let mode: ReviewMode = 'unknown';
  try { mode = await readMode(key); } catch { /* Fail closed on a failed refresh. */ }
  if (mode !== 'active') throw new Error('审核未启用、已暂停或状态无法确认，操作未执行。');
}

/** A fresh check precedes every mutation. The server remains the authorization boundary. */
export function guardReviewWrites(service: DesignerReviewService, readMode: ReadReviewMode): DesignerReviewService {
  return {
    readCurrent: key => service.readCurrent(key),
    inspectUpload: input => service.inspectUpload(input),
    imageUrl: (key, id, download) => service.imageUrl(key, id, download),
    createUpload: async input => { await requireActiveReviewStage(readMode, input.key); return service.createUpload(input); },
    transferUpload: async input => { await requireActiveReviewStage(readMode, input.key); return service.transferUpload(input); },
    registerUpload: async input => { await requireActiveReviewStage(readMode, input.key); return service.registerUpload(input); },
    cleanupUpload: async input => { await requireActiveReviewStage(readMode, input.key); return service.cleanupUpload(input); },
    deleteImage: async input => { await requireActiveReviewStage(readMode, input.key); return service.deleteImage(input); },
    submit: async input => { await requireActiveReviewStage(readMode, input.key); return service.submit(input); },
    requestChanges: async input => { await requireActiveReviewStage(readMode, input.key); return service.requestChanges(input); },
    confirmFinal: async input => { await requireActiveReviewStage(readMode, input.key); return service.confirmFinal(input); },
  };
}
