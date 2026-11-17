import { useEffect, useState } from 'react';
import { historyImageUrl, readProductionHandoff, readReviewHistory, type HistoryImage, type ReviewVersion } from '../services/designer-review-history';
import type { ReviewStageKey } from '../services/designer-review-service';
import '../styles/designer-review-workspace.css';

function HistoryThumbnail({ image, resolve, onOpen }: { image: HistoryImage; resolve: (image: HistoryImage, download?: boolean) => Promise<string>; onOpen: () => void }) {
  const [url, setUrl] = useState(''); const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; setUrl(''); setFailed(false); void resolve(image).then(value => { if (active) setUrl(value); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, [image, resolve]);
  return <button className="designer-detail-image" type="button" onClick={onOpen} aria-label={`预览 ${image.originalName}`}>{url && !failed ? <img src={url} alt={image.originalName} onError={() => setFailed(true)} /> : <span>{failed ? '图片暂不可用，点击重试' : '正在读取图片…'}</span>}</button>;
}

export function ReviewVersionGallery({ versions, resolve = historyImageUrl }: { versions: ReviewVersion[]; resolve?: (image: HistoryImage, download?: boolean) => Promise<string> }) {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState('');
  async function open(image: HistoryImage, download = false) {
    try { setError(''); const url = await resolve(image, download); if (download) { const link = document.createElement('a'); link.href = url; link.download = image.originalName; link.click(); } else setPreview({ url, name: image.originalName }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '图片读取失败。'); }
  }
  return <div className="designer-detail-timeline">{versions.map(version => <section className="designer-deliverable-version" key={version.id}>
    <header><b>第 {version.version} 版 {version.isFinal ? '· 最终定稿' : ''}</b></header>
    <small>提交时间：{new Date(version.submittedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' })}</small>
    {version.note && <p>提交备注：{version.note}</p>}{version.feedback && <p>审核意见：{version.feedback}</p>}
    <div className="designer-detail-gallery">{version.images.map(image => <article className="designer-detail-file" key={image.id}><HistoryThumbnail image={image} resolve={resolve} onOpen={() => void open(image)} /><b>{image.originalName}</b><div><button type="button" onClick={() => void open(image)}>预览 / 放大</button><button type="button" onClick={() => void open(image, true)}>下载</button></div></article>)}</div>
  </section>)}{error && <p role="alert">{error}</p>}{preview && <div className="review-workspace-overlay" onClick={() => setPreview(null)}><div role="dialog" aria-label="图片预览" onClick={event => event.stopPropagation()}><button type="button" onClick={() => setPreview(null)}>关闭</button><img src={preview.url} alt={preview.name} /></div></div>}</div>;
}

export function DesignerReviewHistory({ requestId, stageId, itemId, finalOnly = false, revision }: ReviewStageKey & { finalOnly?: boolean; revision?: string }) {
  const [open, setOpen] = useState(false); const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<ReviewVersion[]>([]); const [error, setError] = useState('');
  useEffect(() => { if (!open) return; let alive = true; setVersions([]); setError(''); setLoading(true); const key = { requestId, stageId, itemId }; const promise = finalOnly ? readProductionHandoff(stageId).then(version => [{ ...version, isFinal: true }]) : readReviewHistory(key); void promise.then(data => { if (alive) setVersions(data); }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : '读取版本失败。'); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [requestId, stageId, itemId, finalOnly, revision, open]);
  return <section className="designer-workspace-history"><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}><span>{finalOnly ? '制作交接 · 最终定稿' : '历史版本'}</span><span>{open ? '收起' : '展开'}⌄</span></button>{open && (loading ? <div className="designer-detail-timeline">正在读取版本…</div> : error ? <div className="designer-detail-timeline" role="alert">版本暂不可用：{error}</div> : versions.length ? <ReviewVersionGallery versions={versions} /> : <div className="designer-detail-timeline">暂无提交版本。</div>)}</section>;
}
