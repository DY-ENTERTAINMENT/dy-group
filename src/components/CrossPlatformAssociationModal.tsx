import { useEffect, useRef, useState } from 'react';
import { SystemModal } from './SystemModal';
import { platformLabels, scoutService, type CreatorEntityPlatformEditValues, type CrossPlatformAssociationCandidate, type CrossPlatformAssociationPreflight } from '../services/scout.service';

type Props = { currentEntityId: string; currentProfile: CreatorEntityPlatformEditValues; onClose: () => void; onSuccess: () => void };
type DisplayProfile = { platform: 'tiktok' | 'douyin'; platformAccount: string; platformPublicId: string | null; platformUserId: string; revenueCycle: string | null; revenueInputMode: string | null };

const identity = (profile: DisplayProfile) => `${platformLabels[profile.platform]} · ${profile.platformAccount} · ${profile.platformPublicId || profile.platformUserId}`;
const currentDisplayProfile = (profile: CreatorEntityPlatformEditValues): DisplayProfile => ({
  platform: profile.platform,
  platformAccount: profile.platform_account,
  platformPublicId: profile.platform_public_id || null,
  platformUserId: profile.platform_user_id,
  revenueCycle: profile.revenue_cycle ?? null,
  revenueInputMode: profile.revenue_input_mode ?? null,
});

function ProfileDetails({ profile, creatorName, managerName, regionName }: { profile: DisplayProfile; creatorName: string; managerName: string | null; regionName: string | null }) {
  const isTikTok = profile.platform === 'tiktok';
  return <div className="cross-platform-association-profile">
    <strong>{platformLabels[profile.platform]} · {creatorName}</strong>
    <span>{isTikTok ? 'TikTok 用户名' : '抖音用户名'}：{profile.platformAccount || '—'}</span>
    <span>{isTikTok ? 'TikTok ID' : '抖音号'}：{isTikTok ? profile.platformUserId : profile.platformPublicId || '—'}</span>
    <span>{isTikTok ? 'TikTok User ID' : '抖音 UID'}：{isTikTok ? profile.platformPublicId || '—' : profile.platformUserId}</span>
    <span>区域：{regionName || '未分配区域'}</span>
    <span>当前主经纪人：{managerName || '未分配经纪人'}</span>
  </div>;
}

export function CrossPlatformAssociationModal({ currentEntityId, currentProfile, onClose, onSuccess }: Props) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<CrossPlatformAssociationCandidate[]>([]);
  const [candidate, setCandidate] = useState<CrossPlatformAssociationCandidate | null>(null);
  const [preflight, setPreflight] = useState<CrossPlatformAssociationPreflight | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const requestSequence = useRef(0);
  const targetPlatform = currentProfile.platform === 'tiktok' ? 'douyin' : 'tiktok';
  const targetLabel = platformLabels[targetPlatform];
  const searchPlaceholder = targetPlatform === 'douyin'
    ? '搜索主播名字 / 抖音用户名 / 抖音号 / UID'
    : '搜索主播名字 / TikTok 用户名 / TikTok ID / User ID';

  function clearPreflight() { setPreflight(null); setReason(''); setConfirming(false); setError(''); }

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
    if (!candidate) return;
    setLoading(true); setError('');
    try { setPreflight(await scoutService.previewCrossPlatformCreatorAssociation(currentEntityId, candidate.id)); }
    catch (previewError) { setPreflight(null); setError((previewError as Error).message || '关联预览失败。'); }
    finally { setLoading(false); }
  }

  async function executeAssociation() {
    if (!candidate || !preflight?.canAssociate || !confirming || !reason.trim() || submitting) return;
    setSubmitting(true); setError('');
    try { await scoutService.associateExistingCrossPlatformCreatorProfiles(currentEntityId, candidate.id, reason); onSuccess(); }
    catch (associationError) { setPreflight(null); setConfirming(false); setError((associationError as Error).message || '关联执行失败；请重新预览。'); }
    finally { setSubmitting(false); }
  }

  return <>
    <SystemModal title={`关联现有${targetLabel}账号`} onClose={submitting ? () => undefined : onClose} footer={<button className="secondary-button compact-button" type="button" onClick={onClose} disabled={submitting}>关闭</button>}>
      <div className="form-grid">
        <p>当前账号：{platformLabels[currentProfile.platform]} · {currentProfile.platform_account} · {currentProfile.platform_public_id || currentProfile.platform_user_id}</p>
        <label className="form-field"><span>搜索现有{targetLabel}账号</span><input value={query} onChange={(event) => { setQuery(event.target.value); setCandidate(null); clearPreflight(); }} placeholder={searchPlaceholder} /></label>
        {loading ? <p>搜索或预览中…</p> : null}
        {query.trim().length >= 2 && !loading && candidates.length === 0 ? <p>没有可关联的候选主播。</p> : null}
        {candidates.length ? <div className="staff-list-panel cross-platform-association-candidate-list">{candidates.map((row) => <article className="cross-platform-association-candidate" key={row.id}>
          <ProfileDetails profile={row} creatorName={row.creatorName} managerName={row.managerName} regionName={row.regionName} />
          <div><span className="creator-management-badge creator-management-badge--operation-normal">活跃</span><button className="secondary-button compact-button" type="button" onClick={() => { clearPreflight(); setCandidate(row); }}>选择{candidate?.id === row.id ? ' ✓' : ''}</button></div>
        </article>)}</div> : null}
        {candidate ? <section className="cross-platform-association-preview-intro"><p>已选择：{identity(candidate)}。将保留当前主播身份，并先检查所有安全条件。</p><button className="primary-button compact-button" type="button" disabled={loading} onClick={runPreflight}>预览关联</button></section> : null}
        {preflight ? <section className="cross-platform-association-preview"><h4>{preflight.canAssociate ? '关联预览' : '无法关联'}</h4>
          <div className="cross-platform-association-comparison"><div><p>当前账号</p><ProfileDetails profile={currentDisplayProfile(currentProfile)} creatorName={preflight.retainedEntity.displayName} managerName={preflight.retainedEntity.managerName} regionName={preflight.retainedEntity.regionName} /></div><strong className="cross-platform-association-arrow">↕</strong><div><p>将关联</p><ProfileDetails profile={preflight.sourceProfile} creatorName={preflight.sourceEntity.displayName} managerName={preflight.sourceEntity.managerName} regionName={preflight.sourceEntity.regionName} /></div></div>
          <p>关联后两个平台账号将属于同一个主播身份，平台资料及流水仍分别保存。</p>
          {preflight.blockers.map((blocker) => <p className="form-alert" key={blocker}>{blocker}</p>)}
          {preflight.warnings.map((warning) => <p key={warning}>注意：{warning}</p>)}
          <p>依赖：来源活跃直播间 {preflight.dependencies.sourceActiveRoomCount}；来源协作者 {preflight.dependencies.sourceActiveCollaboratorCount}；来源额外活跃 Profile {preflight.dependencies.sourceExtraActiveProfileCount}；活动 {preflight.dependencies.sourceActivityCount}；里程碑 {preflight.dependencies.sourceMilestoneCount}。</p>
          {preflight.canAssociate ? <><label className="form-field"><span>关联原因（必填）</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="primary-button compact-button" type="button" disabled={!reason.trim()} onClick={() => setConfirming(true)}>确认关联</button></> : null}
        </section> : null}
        {error ? <p className="form-alert">{error}</p> : null}
      </div>
    </SystemModal>
    {confirming && preflight && candidate ? <SystemModal title="确认关联" onClose={submitting ? () => undefined : () => setConfirming(false)} footer={<><button className="secondary-button compact-button" type="button" disabled={submitting} onClick={() => setConfirming(false)}>返回预览</button><button className="primary-button compact-button" type="button" disabled={submitting} onClick={executeAssociation}>确认关联</button></>}><p>将关联当前 {currentProfile.platform_account} 与候选 {candidate.platformAccount}。来源主体将标记为 merged。</p><p>Profile ID、平台资料与历史流水均不会重写；操作不支持自动撤销。</p></SystemModal> : null}
  </>;
}
