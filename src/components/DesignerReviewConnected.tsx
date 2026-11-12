import { useCallback, useEffect, useRef, useState } from 'react';
import { designerReviewService, type ReviewSnapshot, type ReviewStageKey } from '../services/designer-review-service';
import { DesignerReviewWorkspace, type ReviewPicture } from './DesignerReviewWorkspace';
import { planReviewUploadRecovery } from '../services/designer-review-upload-recovery';
import { canStartReviewAction } from '../services/designer-review-write-guard';

export type ReviewConnectedProps = { requestId: string; stageId: string; itemId: string; role: 'designer' | 'agent'; handoff?: 'production' | 'complete'; paused?: boolean };
type PendingDelete = { imageId: string; expectedRevision: number; idempotencyKey: string };
type PendingUpload = { uploadTaskId: string; expectedRevision: number; name: string; type: string; size: number; lastModified: number; sha256: string };

async function fileDigest(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function DesignerReviewConnected({ requestId, stageId, itemId, role, handoff, paused = false }: ReviewConnectedProps) {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [pictures, setPictures] = useState<ReviewPicture[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasPendingDelete, setHasPendingDelete] = useState(false);
  const [hasPendingUpload, setHasPendingUpload] = useState(false);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const lock = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const pendingDelete = useRef<PendingDelete | null>(null);
  const pendingUpload = useRef<PendingUpload | null>(null);
  const submitId = useRef<string | null>(null);
  const key: ReviewStageKey = { requestId, stageId, itemId };
  const refresh = useCallback(async () => {
    const next = await designerReviewService.readCurrent({ requestId, stageId, itemId });
    const urls = await Promise.all(next.images.map(async image => ({ id: image.id, name: image.originalName, url: (await designerReviewService.imageUrl({ requestId, stageId, itemId }, image.id, false)).url })));
    setSnapshot(next); setPictures(urls);
    return next;
  }, [requestId, stageId, itemId]);
  useEffect(() => {
    let active = true;
    setSnapshot(null); setPictures([]); setError(''); setRecoveryBlocked(false); pendingDelete.current = null; setHasPendingDelete(false); pendingUpload.current = null; setHasPendingUpload(false); submitId.current = null;
    try {
      const saved = sessionStorage.getItem(`designer-review-delete:${requestId}:${stageId}:${itemId}`);
      if (saved) {
        const pending = JSON.parse(saved) as PendingDelete;
        if (typeof pending.imageId === 'string' && typeof pending.idempotencyKey === 'string' && Number.isSafeInteger(pending.expectedRevision)) {
          pendingDelete.current = pending; setHasPendingDelete(true);
        } else throw new Error('Invalid delete recovery data');
      }
      const savedUpload = sessionStorage.getItem(`designer-review-upload:${requestId}:${stageId}:${itemId}`);
      if (savedUpload) {
        const pending = JSON.parse(savedUpload) as PendingUpload;
        if (typeof pending.uploadTaskId === 'string' && Number.isSafeInteger(pending.expectedRevision) && typeof pending.name === 'string' && typeof pending.type === 'string' && Number.isSafeInteger(pending.size) && Number.isSafeInteger(pending.lastModified) && /^[0-9a-f]{64}$/.test(pending.sha256)) {
          pendingUpload.current = pending; setHasPendingUpload(true);
        } else throw new Error('Invalid upload recovery data');
      }
    } catch { setRecoveryBlocked(true); setError('无法读取待处理操作，请联系管理员核对。'); }
    void refresh().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '读取失败。'); });
    const timer = window.setInterval(() => { if (!lock.current) void refresh().catch(() => {}); }, 45_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh, requestId, stageId, itemId]);
  async function run(action: () => Promise<void>, requiredRole: 'designer' | 'agent' = 'designer') {
    if (lock.current) return;
    if (!canStartReviewAction(role, requiredRole, pausedRef.current, recoveryBlocked)) { setError('当前状态或权限不允许操作。'); return; }
    lock.current = true; setBusy(true); setError('');
    try { await action(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作结果未确认，请刷新后重试。'); try { await refresh(); } catch { /* Retain the original failure. */ } }
    finally { lock.current = false; setBusy(false); }
  }
  async function upload(file: File | null, revision: number) {
    let pending = pendingUpload.current;
    if (!pending) {
      if (!file) throw new Error('请重新选择原文件。');
      if (file.size <= 0 || file.size > 50 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('仅支持不超过 50MB 的 JPG、PNG 或 WebP 图片。');
      pending = { uploadTaskId: crypto.randomUUID(), expectedRevision: revision, name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, sha256: await fileDigest(file) };
      try { sessionStorage.setItem(`designer-review-upload:${requestId}:${stageId}:${itemId}`, JSON.stringify(pending)); }
      catch { throw new Error('无法保存上传恢复编号，未执行上传。'); }
      pendingUpload.current = pending; setHasPendingUpload(true);
    }
    if (file && (file.name !== pending.name || file.type !== pending.type || file.size !== pending.size || file.lastModified !== pending.lastModified || await fileDigest(file) !== pending.sha256)) throw new Error('请重新选择之前上传的同一文件。');
    const inspection = await designerReviewService.inspectUpload({ key, uploadTaskId: pending.uploadTaskId });
    const action = planReviewUploadRecovery(inspection, pending.expectedRevision, Boolean(file));
    if (action === 'blocked') throw new Error('上传任务状态异常或版本变化，需要人工核对。');
    if (action === 'needs_file') throw new Error('文件尚未上传，请重新选择同一文件恢复。');
    if (action === 'create_and_transfer' || action === 'transfer') {
      if (!file) throw new Error('请重新选择原文件。');
      const session = await designerReviewService.createUpload({ key, uploadTaskId: pending.uploadTaskId, expectedRevision: pending.expectedRevision, file });
      await designerReviewService.transferUpload({ key, session, file });
    }
    await designerReviewService.registerUpload({ key, uploadTaskId: pending.uploadTaskId, expectedRevision: pending.expectedRevision });
    pendingUpload.current = null; setHasPendingUpload(false);
    try { sessionStorage.removeItem(`designer-review-upload:${requestId}:${stageId}:${itemId}`); } catch { /* Reconciliation remains idempotent. */ }
  }
  async function remove(imageId: string, revision: number) {
    if (pendingDelete.current && pendingDelete.current.imageId !== imageId) throw new Error('请先完成之前的删除重试。');
    const operation = pendingDelete.current ?? { imageId, expectedRevision: revision, idempotencyKey: crypto.randomUUID() };
    try { sessionStorage.setItem(`designer-review-delete:${requestId}:${stageId}:${itemId}`, JSON.stringify(operation)); }
    catch { throw new Error('无法保存删除重试编号，未执行删除。'); }
    pendingDelete.current = operation;
    setHasPendingDelete(true);
    await designerReviewService.deleteImage({ key, ...operation });
    await refresh();
    pendingDelete.current = null;
    setHasPendingDelete(false);
    try { sessionStorage.removeItem(`designer-review-delete:${requestId}:${stageId}:${itemId}`); } catch { /* Retrying the completed task is safe. */ }
  }
  const status = snapshot?.status === 'completed' ? 'final' : snapshot?.status === 'awaiting_agent_confirmation' ? 'review' : snapshot?.status === 'revision' ? 'revision' : 'draft';
  return <>
    <DesignerReviewWorkspace role={role} status={status} pictures={pictures} note={note}
      submittedNote={snapshot?.submittedNote ?? null} feedback={snapshot?.latestFeedback ?? null}
      revisionCount={snapshot?.feedbackCount ?? 0} handoff={handoff}
      disabledReason={paused ? '审核已暂停，当前只可查看。' : busy ? '正在处理…' : recoveryBlocked ? '待处理操作需要核对。' : !snapshot ? '正在读取或服务不可用。' : undefined}
      onNoteChange={setNote}
      onAdd={files => void run(async () => { let current = await refresh(); for (const file of files) { await upload(file, current.draftRevision); current = await refresh(); } })}
      onRemove={picture => void run(async () => { if (!snapshot) throw new Error('请刷新后重试。'); await remove(picture.id, snapshot.draftRevision); })}
      onReplace={(picture, file) => void run(async () => { if (!snapshot) throw new Error('请刷新后重试。'); await upload(file, snapshot.draftRevision); const current = await refresh(); await remove(picture.id, current.draftRevision); })}
      onSubmit={() => void run(async () => { if (!snapshot) throw new Error('请刷新后重试。'); const operationId = submitId.current ?? crypto.randomUUID(); submitId.current = operationId; await designerReviewService.submit({ key, expectedRevision: snapshot.draftRevision, operationId, note: note || null }); submitId.current = null; })}
      onReturn={feedback => void run(async () => { if (!snapshot?.pendingSubmissionId) throw new Error('待审版本已变化。'); await designerReviewService.requestChanges({ key, expectedSubmissionId: snapshot.pendingSubmissionId, feedback }); }, 'agent')}
      onConfirm={() => void run(async () => { if (!snapshot?.pendingSubmissionId) throw new Error('待审版本已变化。'); await designerReviewService.confirmFinal({ key, expectedSubmissionId: snapshot.pendingSubmissionId }); }, 'agent')}
    />
    {error ? <p role="alert">{error}</p> : null}
    {hasPendingDelete ? <button type="button" disabled={paused || busy || recoveryBlocked} onClick={() => void run(async () => { const pending = pendingDelete.current; if (pending) await remove(pending.imageId, pending.expectedRevision); })}>使用原操作重试删除</button> : null}
    {hasPendingUpload && role === 'designer' ? <button type="button" disabled={paused || busy || recoveryBlocked} onClick={() => void run(async () => { const pending = pendingUpload.current; if (pending) await upload(null, pending.expectedRevision); })}>检查并恢复上次上传</button> : null}
  </>;
}
