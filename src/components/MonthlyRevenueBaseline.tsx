import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SystemModal } from './SystemModal';
import { useAuth } from '../hooks/useAuth';
import { permissionRuntimeService } from '../services/permission-runtime.service';
import { revenueCycleService, type RevenueMonthContext } from '../services/revenue-cycle.service';
import { malaysiaMonth } from '../services/revenue-cycle-display';

export function MonthlyRevenueBaseline({ profileId, creatorName, month, onVerified }: {
  profileId: string; creatorName: string; month: string; onVerified: () => void;
}) {
  const { profile } = useAuth();
  const [allowed, setAllowed] = useState(false);
  const [context, setContext] = useState<RevenueMonthContext>();
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [alreadyExists, setAlreadyExists] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let active = true;
    setAllowed(false); setContext(undefined); setOpen(false); setAlreadyExists(false);
    Promise.all([
      permissionRuntimeService.hasExplicitPermission('agent-creator-revenue-settings', 'use'),
      revenueCycleService.monthContext([profileId], month),
    ]).then(([permission, contexts]) => { if (active) { setAllowed(permission); setContext(contexts[0]); } }).catch(() => { /* Fail closed; original roster remains visible. */ });
    return () => { active = false; };
  }, [profile?.id, profileId, month]);
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy.current || saving || !allowed || alreadyExists || context?.cycle_source !== 'LEGACY_UNKNOWN' || month !== malaysiaMonth()) return;
    busy.current = true;
    setSaving(true); setError('');
    let saved = false;
    try {
      // The existing RPC independently enforces explicit permission, entity scope,
      // region scope, current-month evidence, and absence of any existing history.
      await revenueCycleService.initializeCurrentMonthlyBaseline({ profileId, month, evidence, confirmed });
      saved = true; setAlreadyExists(true);
      const contexts = await revenueCycleService.monthContext([profileId], month);
      setContext(contexts[0]); setOpen(false); onVerified();
    } catch (failure) {
      const code = typeof failure === 'object' && failure !== null && 'code' in failure ? String(failure.code) : '';
      if (code === '23505') { setAlreadyExists(true); onVerified(); setError('已有周期历史，不能重复初始化。请刷新查看有效周期。'); }
      else if (code === '42501') setError('没有此主播的周期核验权限或区域管理权限。');
      else if (saved) { onVerified(); setError('核验已保存，刷新有效周期失败。请关闭并刷新名单。'); }
      else setError(failure instanceof Error ? failure.message : '核验失败，请刷新后检查；不会自动重试或修改原周期。');
    } finally { busy.current = false; setSaving(false); }
  }
  if (!allowed || !context || context.cycle_source !== 'LEGACY_UNKNOWN' || month !== malaysiaMonth()) return null;
  return <>
    <button className="secondary-button compact-button" type="button" disabled={alreadyExists} onClick={() => { setEvidence(''); setConfirmed(false); setError(''); setOpen(true); }}>核验本月月流水周期</button>
    {open ? <SystemModal title="核验本月月流水周期" ariaLabel="核验本月月流水周期" onClose={() => { if (!saving) setOpen(false); }} footer={<><button className="secondary-button compact-button" disabled={saving} onClick={() => setOpen(false)}>关闭</button><button className="primary-button compact-button" type="submit" form={'baseline-' + profileId} disabled={saving || alreadyExists || !confirmed || evidence.trim().length < 20}>{saving ? '核验中…' : '确认本月核验'}</button></>}>
      <form id={'baseline-' + profileId} onSubmit={verify}>
        <p>{creatorName} · 当前资料设置：月流水</p><p>核验月份：{month}（MYT 本月）</p>
        <p className="field-help">仅建立本月基线；更早月份仍未核验。原有 monthly 设置保持不变。</p>
        <label className="form-field"><span>核验依据（至少 20 字）</span><textarea required minLength={20} disabled={saving || alreadyExists} value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="填写核对的真实资料、来源及确认结果" /></label>
        <label><input type="checkbox" checked={confirmed} disabled={saving || alreadyExists} onChange={event => setConfirmed(event.target.checked)} />我已核对真实资料，确认该主播本月使用月流水。</label>
        {error ? <p className="form-alert">{error}</p> : null}
      </form>
    </SystemModal> : null}
  </>;
}
