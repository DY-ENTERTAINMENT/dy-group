import { useEffect, useRef, useState } from 'react';
import { SystemModal } from './SystemModal';
import { platformLabels, scoutService, type CreatorEntityPlatformEditValues, type CrossPlatformAssociationCandidate, type CrossPlatformAssociationPreflight } from '../services/scout.service';

type Props = { currentEntityId: string; currentProfile: CreatorEntityPlatformEditValues; onClose: () => void; onSuccess: () => void };
type DisplayProfile = { platform: 'tiktok' | 'douyin'; platformAccount: string; platformPublicId: string | null; platformUserId: string; revenueCycle: string | null; revenueInputMode: string | null };
const identity = (profile: DisplayProfile) => `${platformLabels[profile.platform]} · ${profile.platformAccount} · ${profile.platformPublicId || profile.platformUserId}`;
const settings = (profile: DisplayProfile) => `${profile.revenueCycle ?? 'weekly'} / ${profile.revenueInputMode ?? 'direct'}`;

export function CrossPlatformAssociationModal({ currentEntityId, currentProfile, onClose, onSuccess }: Props) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<CrossPlatformAssociationCandidate[]>([]);
  const [candidate, setCandidate] = useState<CrossPlatformAssociationCandidate | null>(null);
  const [retainedEntityId, setRetainedEntityId] = useState('');
  const [preflight, setPreflight] = useState<CrossPlatformAssociationPreflight | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const requestSequence = useRef(0);

  function clearPreflight() { setRetainedEntityId(''); setPreflight(null); setReason(''); setConfirming(false); setError(''); }

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) { setCandidates([]); setLoading(false); return undefined; }
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const results = await scoutService.searchCrossPlatformCreatorAssociationCandidates(currentProfile.id, normalizedQuery);
        if (sequence === requestSequence.current) setCandidates(results);
      } catch (searchError) {
        if (sequence === requestSequence.current) setError((searchError as Error).message || '搜索候选主播失败。');
      } finally { if (sequence === requestSequence.current) setLoading(false); }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [currentProfile.id, query]);

  async function runPreflight() {
    if (!candidate || !retainedEntityId) return;
    setLoading(true); setError('');
    try { setPreflight(await scoutService.previewCrossPlatformCreatorAssociation(retainedEntityId, candidate.id)); }
    catch (previewError) { setPreflight(null); setError((previewError as Error).message || '关联检查失败。'); }
    finally { setLoading(false); }
  }

  async function executeAssociation() {
    if (!candidate || !retainedEntityId || !preflight?.canAssociate || !confirming || !reason.trim() || submitting) return;
    setSubmitting(true); setError('');
    try { await scoutService.associateExistingCrossPlatformCreatorProfiles(retainedEntityId, candidate.id, reason); onSuccess(); }
    catch (associationError) { setPreflight(null); setConfirming(false); setError((associationError as Error).message || '关联执行失败；请重新检查。'); }
    finally { setSubmitting(false); }
  }

  return <>
    <SystemModal title="关联双平台账号" onClose={submitting ? () => undefined : onClose} footer={<button className="secondary-button compact-button" type="button" onClick={onClose} disabled={submitting}>关闭</button>}>
      <div className="form-grid">
        <p>当前 Profile：{platformLabels[currentProfile.platform]} · {currentProfile.platform_account} · {currentProfile.platform_public_id || currentProfile.platform_user_id}</p>
        <label className="form-field"><span>搜索另一平台主播（姓名、账号或平台 ID）</span><input value={query} onChange={(event) => { setQuery(event.target.value); setCandidate(null); clearPreflight(); }} placeholder="至少输入 2 个字符" /></label>
        {loading ? <p>搜索或检查中…</p> : null}
        {query.trim().length >= 2 && !loading && candidates.length === 0 ? <p>没有可关联的候选主播。</p> : null}
        <div className="staff-list-panel" style={{ maxHeight: 200, overflow: 'auto' }}>{candidates.map((row) => <button className="secondary-button compact-button" key={row.id} type="button" onClick={() => { setCandidate(row); clearPreflight(); }}>{platformLabels[row.platform]} · {row.creatorName} · {row.platformAccount} · {row.platformPublicId || row.platformUserId}{' · '}{row.managerName || '未分配经纪人'} · {row.regionName || '未分配区域'}{candidate?.id === row.id ? ' ✓' : ''}</button>)}</div>
        {candidate ? <><p>选择保留的主体。来源主体会标记为 merged；Profile ID、历史流水与累计状态均不会重写。</p><button className="secondary-button compact-button" type="button" onClick={() => { setRetainedEntityId(currentEntityId); setPreflight(null); setConfirming(false); }}>保留当前主体{retainedEntityId === currentEntityId ? ' ✓' : ''}</button><button className="secondary-button compact-button" type="button" onClick={() => { setRetainedEntityId(candidate.creatorEntityId); setPreflight(null); setConfirming(false); }}>保留候选主体{retainedEntityId === candidate.creatorEntityId ? ' ✓' : ''}</button><button className="primary-button compact-button" type="button" disabled={!retainedEntityId || loading} onClick={runPreflight}>检查关联条件</button></> : null}
        {preflight ? <section><h4>{preflight.canAssociate ? '检查通过' : '无法关联'}</h4><p>保留主体：{preflight.retainedEntity.displayName} · {preflight.retainedEntity.managerName || '—'} · {preflight.retainedEntity.regionName || '—'}</p><p>保留主体设置：重点关注 {preflight.retainedEntity.isPriority ? '是' : '否'}；运营状态 {preflight.retainedEntity.operationStatus || '—'}；原因 {preflight.retainedEntity.operationStatusReason || '—'}</p><p>来源主体：{preflight.sourceEntity.displayName} · {preflight.sourceEntity.managerName || '—'} · {preflight.sourceEntity.regionName || '—'}</p><p>来源主体设置：重点关注 {preflight.sourceEntity.isPriority ? '是' : '否'}；运营状态 {preflight.sourceEntity.operationStatus || '—'}；原因 {preflight.sourceEntity.operationStatusReason || '—'}</p><p>来源 Profile：{identity(preflight.sourceProfile)} · 设置 {settings(preflight.sourceProfile)}</p><p>保留主体 Profile：{preflight.retainedProfiles.map((profile) => `${identity(profile)} · 设置 ${settings(profile)}`).join('；') || '—'}</p>{preflight.blockers.map((blocker) => <p className="form-alert" key={blocker}>{blocker}</p>)}{preflight.warnings.map((warning) => <p key={warning}>注意：{warning}</p>)}<p>依赖：来源活跃直播间 {preflight.dependencies.sourceActiveRoomCount}；来源协作者 {preflight.dependencies.sourceActiveCollaboratorCount}；来源额外活跃 Profile {preflight.dependencies.sourceExtraActiveProfileCount}；活动 {preflight.dependencies.sourceActivityCount}；里程碑 {preflight.dependencies.sourceMilestoneCount}。</p>{preflight.canAssociate ? <><label className="form-field"><span>关联原因（必填）</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="primary-button compact-button" type="button" disabled={!reason.trim()} onClick={() => setConfirming(true)}>进入最终确认</button></> : null}</section> : null}
        {error ? <p className="form-alert">{error}</p> : null}
      </div>
    </SystemModal>
    {confirming && preflight && candidate ? <SystemModal title="确认执行关联" onClose={submitting ? () => undefined : () => setConfirming(false)} footer={<><button className="secondary-button compact-button" type="button" disabled={submitting} onClick={() => setConfirming(false)}>返回检查</button><button className="primary-button compact-button" type="button" disabled={submitting} onClick={executeAssociation}>确认执行关联</button></>}><p>将关联当前 {currentProfile.platform_account} 与候选 {candidate.platformAccount}。保留主体为 {preflight.retainedEntity.displayName}；来源主体将标记为 merged。</p><p>Profile ID 不变；历史流水、累计 baseline/raw history、直播间和协作者历史不会重写；操作不支持自动撤销。</p></SystemModal> : null}
  </>;
}
