import { useEffect, useState } from 'react';
import { leaveService } from '../services/leave.service';
import { SystemModal } from './SystemModal';

export function MedicalProofThumbnail({ attachment, label, emptyText = '—', errorText = '不可读取' }: { attachment: string | null; label: string; emptyText?: string; errorText?: string }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(Boolean(attachment));
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl('');
    setFailed(false);
    setLoading(Boolean(attachment));
    if (!attachment) return () => { active = false; };
    void leaveService.getMedicalAttachmentSignedUrl(attachment, 120)
      .then((signedUrl) => { if (active) setUrl(signedUrl); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attachment]);

  if (!attachment) return <span className="medical-proof-empty">{emptyText}</span>;
  if (loading) return <span className="medical-proof-state">加载中…</span>;
  if (failed || !url) return <span className="medical-proof-state">{errorText}</span>;
  return <><button type="button" className="medical-proof-thumbnail" onClick={() => setOpen(true)} aria-label={`查看${label}`}><img src={url} alt={label} loading="lazy" onError={() => setFailed(true)} /></button>{open ? <SystemModal title={label} ariaLabel={`${label}大图预览`} onClose={() => setOpen(false)} footer={<><a className="secondary-button compact-button" href={url} target="_blank" rel="noreferrer">打开原图</a><button className="secondary-button compact-button" type="button" onClick={() => setOpen(false)}>关闭</button></>}><img className="medical-proof-large" src={url} alt={label} /></SystemModal> : null}</>;
}
