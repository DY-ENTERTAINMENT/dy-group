import { useEffect, useState } from 'react';
import { Check, RefreshCw, Upload } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { agentService, designStatusLabels, designTypeLabels, getEmployeeName, type DesignRequest } from '../services/agent.service';

export type DesignerPageMode = 'intake' | 'progress';

export function DesignerPage({ mode }: { mode: DesignerPageMode }) {
  const { profile } = useAuth();
  const [requests, setRequests] = useState<DesignRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void loadData();
  }, [mode, profile?.id]);

  async function loadData() {
    if (!profile?.id && mode === 'progress') return;
    setLoading(true);
    setError('');
    try {
      setRequests(await agentService.listDesignRequests({ designerProfileId: profile?.id, mode }));
    } catch (loadError) {
      setError(`读取美工申请失败：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  async function claim(request: DesignRequest) {
    if (!profile?.id) return;
    setError('');
    setMessage('');
    try {
      await agentService.claimDesignRequest(profile.id, request.id);
      setMessage('已接单。');
      await loadData();
    } catch (claimError) {
      setError(`接单失败：${getErrorMessage(claimError)}`);
    }
  }

  async function uploadDesign(request: DesignRequest) {
    const designUrls = window.prompt('请输入设计图链接（多张可换行）', request.design_urls.join('\n'));
    if (designUrls === null) return;
    setError('');
    try {
      await agentService.updateDesignStatus(request.id, 'in_progress', { designUrls });
      await loadData();
    } catch (uploadError) {
      setError(`上传设计图失败：${getErrorMessage(uploadError)}`);
    }
  }

  async function complete(request: DesignRequest) {
    setError('');
    try {
      await agentService.updateDesignStatus(request.id, 'completed');
      await loadData();
    } catch (completeError) {
      setError(`完成申请失败：${getErrorMessage(completeError)}`);
    }
  }

  return (
    <section className="designer-page">
      <div className="toolbar-actions staff-actions-row">
        <button className="secondary-action" type="button" onClick={loadData} disabled={loading}><RefreshCw size={17} /><span>刷新</span></button>
      </div>
      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}
      <div className="staff-list-panel">
        {loading ? <div className="table-state">正在读取美工申请...</div> : requests.length === 0 ? <div className="table-state">暂无申请。</div> : <DesignRequestTable mode={mode} requests={requests} onClaim={claim} onUpload={uploadDesign} onComplete={complete} />}
      </div>
    </section>
  );
}

function DesignRequestTable({ mode, requests, onClaim, onUpload, onComplete }: { mode: DesignerPageMode; requests: DesignRequest[]; onClaim: (request: DesignRequest) => void; onUpload: (request: DesignRequest) => void; onComplete: (request: DesignRequest) => void }) {
  return <div className="staff-table-wrap"><table className="staff-table agent-table"><thead><tr><th>主播资料</th><th>申请类型</th><th>申请内容</th><th>接单美工</th><th>设计图</th><th>状态</th><th>操作</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td><strong>{request.creator_name || request.platform_user_id || '特殊申请'}</strong><span>{request.platform_account || '-'}</span></td><td>{designTypeLabels[request.request_type]}</td><td>{request.design_content || request.special_content || request.design_elements || '-'}</td><td>{getEmployeeName(request.designer) || '-'}</td><td>{request.design_urls.length > 0 ? request.design_urls.map((url) => <a key={url} className="text-link-button" href={url} target="_blank" rel="noreferrer">设计图</a>) : '-'}</td><td>{designStatusLabels[request.status]}</td><td><div className="row-actions">{mode === 'intake' ? <button className="secondary-action compact-button" type="button" onClick={() => onClaim(request)}>接单</button> : <><button className="icon-button" type="button" onClick={() => onUpload(request)} aria-label="上传设计图"><Upload size={16} /></button><button className="icon-button accept-button" type="button" onClick={() => onComplete(request)} aria-label="完成"><Check size={16} /></button></>}</div></td></tr>)}</tbody></table></div>;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return '未知错误';
}
