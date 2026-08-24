import { useEffect, useLayoutEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Plus, RefreshCw, Send, X } from 'lucide-react';
import { MonthSelect } from '../components/MonthSelect';
import { SystemModal } from '../components/SystemModal';
import { useAuth } from '../hooks/useAuth';
import { usePermissions } from '../hooks/usePermissions';
import tiktokLogoUrl from '../assets/icons/tiktok-logo.png';
import douyinLogoUrl from '../assets/icons/douyin-logo.png';
import {
  adjustmentStatusLabels,
  adjustmentTypeLabels,
  agentService,
  createRevenueBreakdown,
  creatorTypeLabels,
  designStatusLabels,
  designTypeLabels,
  getEmployeeName,
  platformLabels,
  printMethodLabels,
  type AdjustmentFormValues,
  type AdjustmentRequest,
  type AdjustmentReviewRequest,
  type AdjustmentTargetEmployee,
  type AdjustmentType,
  type AgentOptions,
  type DesignFormValues,
  type DesignRequest,
  type DesignRequestType,
  type RevenueRecord,
  type WeeklyRevenueRecord,
} from '../services/agent.service';
import type { CreatorPlatform, CreatorProfile } from '../services/scout.service';

export type AgentPageMode = 'revenue' | 'creators' | 'adjustments' | 'design-requests' | 'management-revenue' | 'management-adjustments';

const currentMonth = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);

const emptyAdjustment: AdjustmentFormValues = {
  platform: 'tiktok',
  platform_user_id: '',
  request_type: 'to_online',
  effective_date: today,
  full_name: '',
  bank_name: '',
  bank_account: '',
  target_nickname: '',
  target_email: '',
  content: '',
};

const emptyDesign: DesignFormValues = {
  request_type: 'banner',
  platform: 'tiktok',
  platform_user_id: '',
  creator_name: '',
  platform_account: '',
  fan_nickname: '',
  fan_level: '',
  design_content: '',
  design_elements: '',
  print_method: 'print',
  special_content: '',
  reference_urls: '',
};

const adjustmentTypes: AdjustmentType[] = ['to_online', 'to_company', 'to_5_1', 'change_manager', 'change_scout', 'change_bank', 'special'];
const designTypes: DesignRequestType[] = ['banner', 'standee', 'poster', 'special'];

export function AgentPage({ mode }: { mode: AgentPageMode }) {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const isManagement = mode === 'management-revenue';
  const [options, setOptions] = useState<AgentOptions>({ regions: [], employees: [], currentEmployee: null });
  const [month, setMonth] = useState(currentMonth);
  const [platform, setPlatform] = useState('tiktok');
  const [regionId, setRegionId] = useState('');
  const [creatorSearch, setCreatorSearch] = useState('');
  const [creatorPlatform, setCreatorPlatform] = useState('');
  const [creatorType, setCreatorType] = useState('');
  const [creatorStatus, setCreatorStatus] = useState('');
  const [creatorCompleteness, setCreatorCompleteness] = useState('');
  const [reviewStatus, setReviewStatus] = useState('pending');
  const [reviewPlatform, setReviewPlatform] = useState('');
  const [reviewType, setReviewType] = useState('');
  const [reviewSearch, setReviewSearch] = useState('');
  const [revenues, setRevenues] = useState<RevenueRecord[]>([]);
  const [creators, setCreators] = useState<CreatorProfile[]>([]);
  const [selectedCreatorGroup, setSelectedCreatorGroup] = useState<CreatorProfileGroup | null>(null);
  const [adjustments, setAdjustments] = useState<AdjustmentRequest[]>([]);
  const [adjustmentReviews, setAdjustmentReviews] = useState<AdjustmentReviewRequest[]>([]);
  const [selectedAdjustmentReview, setSelectedAdjustmentReview] = useState<AdjustmentReviewRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<{ request: AdjustmentReviewRequest; status: 'approved' | 'rejected'; note: string } | null>(null);
  const [designRequests, setDesignRequests] = useState<DesignRequest[]>([]);
  const [adjustmentForm, setAdjustmentForm] = useState<AdjustmentFormValues>(emptyAdjustment);
  const [designForm, setDesignForm] = useState<DesignFormValues>(emptyDesign);
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [designModalOpen, setDesignModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const revenueBreakdown = useMemo(() => createRevenueBreakdown(revenues), [revenues]);
  const pendingAdjustments = adjustments.filter((item) => item.status === 'pending').length;
  const unclaimedDesigns = designRequests.filter((item) => item.status === 'unclaimed').length;
  const inProgressDesigns = designRequests.filter((item) => item.status === 'in_progress' || item.status === 'revision').length;
  const canReviewAdjustments = permissions.canUse('management-streamer-stats');

  useLayoutEffect(() => {
    if (mode === 'revenue') setMonth(currentMonth);
  }, [mode]);

  useEffect(() => {
    void loadData();
  }, [mode, profile?.id, month, platform, regionId]);

  async function loadData() {
    if (!profile?.id && !isManagement) return;
    setLoading(true);
    setError('');
    try {
      const nextOptions = await agentService.getOptions(profile?.id);
      setOptions(nextOptions);
      const defaultRegion = regionId || nextOptions.currentEmployee?.region_id || '';
      if (!regionId && nextOptions.currentEmployee?.region_id && (mode === 'revenue' || mode === 'creators')) setRegionId(nextOptions.currentEmployee.region_id);

      if (mode === 'management-revenue') {
        setRevenues(await agentService.listRevenueData({ profileId: profile?.id, month, platform, regionId: defaultRegion, management: isManagement }));
      }
      if ((mode === 'revenue' || mode === 'creators') && profile?.id) {
        setCreators(await agentService.listManagedCreators(profile.id, { regionId: defaultRegion }));
      }
      if (mode === 'adjustments' && profile?.id) {
        setAdjustments(await agentService.listAdjustments(profile.id));
      }
      if (mode === 'management-adjustments') {
        setAdjustmentReviews(await agentService.listAdjustmentReviews());
      }
      if (mode === 'design-requests' && profile?.id) {
        setDesignRequests(await agentService.listDesignRequests({ profileId: profile.id, mode: 'agent' }));
      }
    } catch (loadError) {
      setError(`读取经纪人资料失败：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile?.id) return;
    const missingTargetEmail = getMissingTargetEmailMessage(adjustmentForm.request_type, adjustmentForm.target_email);
    if (missingTargetEmail) {
      setError(missingTargetEmail);
      return;
    }
    if (requiresTargetEmail(adjustmentForm.request_type) && !adjustmentForm.target_nickname.trim()) {
      setError(adjustmentForm.request_type === 'change_manager' ? '目标经纪人昵称必须填写。' : '目标星探昵称必须填写。');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await agentService.createAdjustment(profile.id, adjustmentForm);
      setMessage('资料调整申请已提交。');
      setAdjustmentModalOpen(false);
      setAdjustmentForm(emptyAdjustment);
      await loadData();
    } catch (saveError) {
      setError(`提交申请失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function submitDesign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile?.id) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await agentService.createDesignRequest(profile.id, designForm);
      setMessage('美工申请已提交。');
      setDesignModalOpen(false);
      setDesignForm(emptyDesign);
      await loadData();
    } catch (saveError) {
      setError(`提交美工申请失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function updateDesignStatus(request: DesignRequest, status: 'confirming' | 'revision' | 'ok' | 'cancelled') {
    const revisionNote = status === 'revision' ? window.prompt('请输入调整内容') ?? '' : undefined;
    setError('');
    try {
      await agentService.updateDesignStatus(request.id, status, { revisionNote });
      await loadData();
    } catch (statusError) {
      setError(`更新美工申请失败：${getErrorMessage(statusError)}`);
    }
  }

  async function submitAdjustmentReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile?.id || !reviewAction) return;
    if (reviewAction.request.status !== 'pending') {
      setError('这笔申请已审批，不能重复操作。');
      setReviewAction(null);
      return;
    }
    if (reviewAction.status === 'rejected' && !reviewAction.note.trim()) {
      setError('拒绝原因必须填写。');
      return;
    }
    const missingTargetEmail = reviewAction.status === 'approved' ? getMissingTargetEmailReviewMessage(reviewAction.request) : '';
    if (missingTargetEmail) {
      setError(missingTargetEmail);
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      await agentService.reviewAdjustmentRequest(profile.id, {
        id: reviewAction.request.id,
        status: reviewAction.status,
        reviewNote: reviewAction.note,
      });
      setMessage(reviewAction.status === 'approved' ? '资料调整申请已通过。' : '资料调整申请已拒绝。');
      setReviewAction(null);
      await loadData();
    } catch (reviewError) {
      setError(`审批申请失败：${getErrorMessage(reviewError)}`);
    } finally {
      setSaving(false);
    }
  }

  function openAdjustmentForCreator(group: CreatorProfileGroup, creatorProfile?: CreatorProfile) {
    const targetCreator = creatorProfile ?? group.profiles[0];
    if (!targetCreator) return;

    setAdjustmentForm({
      ...emptyAdjustment,
      platform: targetCreator.platform,
      platform_user_id: targetCreator.platform_user_id,
      content: `主播：${group.displayName}`,
    });
    setAdjustmentModalOpen(true);
  }

  return (
    <section className="agent-page">
      <div className="toolbar-actions staff-actions-row">
        {mode === 'adjustments' ? (
          <button className="secondary-action" type="button" onClick={() => setAdjustmentModalOpen(true)}><Plus size={17} /><span>添加新申请</span></button>
        ) : null}
        {mode === 'design-requests' ? (
          <button className="secondary-action" type="button" onClick={() => setDesignModalOpen(true)}><Plus size={17} /><span>添加新申请</span></button>
        ) : null}
        {mode === 'revenue' ? null : <button className="secondary-action" type="button" onClick={loadData} disabled={loading}><RefreshCw size={17} /><span>刷新</span></button>}
      </div>

      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      {mode === 'revenue' || mode === 'management-revenue' ? (
        <RevenuePanel isManagement={isManagement} loading={loading} month={month} platform={platform} regionId={regionId} options={options} breakdown={revenueBreakdown} onMonth={setMonth} onPlatform={setPlatform} onRegion={setRegionId} />
      ) : null}

      {mode === 'creators' ? (
        <CreatorDataPanel
          loading={loading}
          search={creatorSearch}
          platform={creatorPlatform}
          creatorType={creatorType}
          status={creatorStatus}
          completeness={creatorCompleteness}
          regionId={regionId}
          options={options}
          creators={creators}
          onSearch={setCreatorSearch}
          onPlatform={setCreatorPlatform}
          onCreatorType={setCreatorType}
          onStatus={setCreatorStatus}
          onCompleteness={setCreatorCompleteness}
          onRegion={setRegionId}
          onView={setSelectedCreatorGroup}
          onAdjustment={openAdjustmentForCreator}
        />
      ) : null}

      {mode === 'adjustments' ? <AdjustmentPanel loading={loading} pendingCount={pendingAdjustments} adjustments={adjustments} /> : null}
      {mode === 'management-adjustments' ? (
        <AdjustmentReviewPanel
          loading={loading}
          requests={adjustmentReviews}
          status={reviewStatus}
          platform={reviewPlatform}
          requestType={reviewType}
          search={reviewSearch}
          canReview={canReviewAdjustments}
          onStatus={setReviewStatus}
          onPlatform={setReviewPlatform}
          onRequestType={setReviewType}
          onSearch={setReviewSearch}
          onView={setSelectedAdjustmentReview}
          onAction={(request, status) => setReviewAction({ request, status, note: '' })}
        />
      ) : null}
      {mode === 'design-requests' ? <AgentDesignPanel loading={loading} unclaimed={unclaimedDesigns} inProgress={inProgressDesigns} requests={designRequests} onStatus={updateDesignStatus} /> : null}

      {selectedCreatorGroup ? (
        <CreatorDetailDrawer
          group={selectedCreatorGroup}
          onClose={() => setSelectedCreatorGroup(null)}
          onAdjustment={(creatorProfile) => openAdjustmentForCreator(selectedCreatorGroup, creatorProfile)}
        />
      ) : null}

      {adjustmentModalOpen ? <AdjustmentModal values={adjustmentForm} saving={saving} currentRegionId={options.currentEmployee?.region_id ?? ''} onChange={setAdjustmentForm} onClose={() => setAdjustmentModalOpen(false)} onSubmit={submitAdjustment} /> : null}
      {selectedAdjustmentReview ? <AdjustmentReviewDrawer request={selectedAdjustmentReview} onClose={() => setSelectedAdjustmentReview(null)} /> : null}
      {reviewAction ? <AdjustmentReviewActionModal action={reviewAction} saving={saving} onChange={(note) => setReviewAction({ ...reviewAction, note })} onClose={() => setReviewAction(null)} onSubmit={submitAdjustmentReview} /> : null}
      {designModalOpen ? <DesignModal values={designForm} saving={saving} onChange={setDesignForm} onClose={() => setDesignModalOpen(false)} onSubmit={submitDesign} /> : null}
    </section>
  );
}

function RevenuePanel(props: {
  isManagement: boolean;
  loading: boolean;
  month: string;
  platform: string;
  regionId: string;
  options: AgentOptions;
  breakdown: ReturnType<typeof createRevenueBreakdown>;
  onMonth: (value: string) => void;
  onPlatform: (value: string) => void;
  onRegion: (value: string) => void;
}) {
  const showTikTok = !props.platform || props.platform === 'tiktok';
  const showDouyin = !props.platform || props.platform === 'douyin';

  return (
    <div className="staff-list-panel">
      <AgentFilters {...props} />
      <div className="scout-stat-grid agent-revenue-card-grid">
        {props.loading ? (
          <div className="table-state">正在统计流水...</div>
        ) : (
          <>
            {showTikTok ? <RevenueCard title="TikTok" summary={props.breakdown.tiktok} logoUrl={tiktokLogoUrl} unit="钻石" platform="tiktok" /> : null}
            {showDouyin ? <RevenueCard title="抖音" summary={props.breakdown.douyin} logoUrl={douyinLogoUrl} unit="音浪" platform="douyin" /> : null}
          </>
        )}
      </div>
    </div>
  );
}

function RevenueCard({ title, summary, logoUrl, unit, platform }: { title: string; summary: { total: number; plusFiveOne: number; nonFiveOne: number }; logoUrl: string; unit: string; platform: 'tiktok' | 'douyin' }) {
  return (
    <section className={`scout-stat-card agent-revenue-card agent-revenue-card--${platform}`}>
      <h4 className="agent-revenue-card-title">
        <img src={logoUrl} alt="" aria-hidden="true" />
        <span>{title}</span>
      </h4>
      <strong className="agent-revenue-card-total">
        <span>{formatRevenueAmount(summary.total)}</span>
        <small>{unit}</small>
      </strong>
      <div className="agent-revenue-card-breakdown">
        <div className="agent-revenue-card-metric">
          <span>5+1</span>
          <b>{formatRevenueAmount(summary.plusFiveOne)}</b>
        </div>
        <div className="agent-revenue-card-metric">
          <span>非5+1</span>
          <b>{formatRevenueAmount(summary.nonFiveOne)}</b>
        </div>
      </div>
    </section>
  );
}

function formatRevenueAmount(value: number) {
  return (Number(value) || 0).toLocaleString('en-MY', { maximumFractionDigits: 2 });
}

function AgentFilters(props: { month: string; platform: string; regionId: string; options: AgentOptions; onMonth: (value: string) => void; onPlatform: (value: string) => void; onRegion: (value: string) => void }) {
  return <div className="scout-filters"><label className="form-field"><span>年月份</span><MonthSelect value={props.month} onChange={props.onMonth} /></label><SelectField label="平台" value={props.platform} onChange={props.onPlatform}><option value="tiktok">TikTok</option><option value="douyin">抖音</option><option value="">全部</option></SelectField><SelectField label="区域" value={props.regionId} onChange={props.onRegion}><option value="">全部</option>{props.options.regions.map((region) => <option key={region.id} value={region.id}>{region.code}</option>)}</SelectField></div>;
}

function CreatorDataPanel(props: {
  loading: boolean;
  search: string;
  platform: string;
  creatorType: string;
  status: string;
  completeness: string;
  regionId: string;
  options: AgentOptions;
  creators: CreatorProfile[];
  onSearch: (value: string) => void;
  onPlatform: (value: string) => void;
  onCreatorType: (value: string) => void;
  onStatus: (value: string) => void;
  onCompleteness: (value: string) => void;
  onRegion: (value: string) => void;
  onView: (group: CreatorProfileGroup) => void;
  onAdjustment: (group: CreatorProfileGroup, creatorProfile?: CreatorProfile) => void;
}) {
  const creatorGroups = useMemo(() => {
    const groups = groupCreatorProfiles(props.creators);
    return filterCreatorGroups(groups, {
      search: props.search,
      platform: props.platform,
      creatorType: props.creatorType,
      status: props.status,
      completeness: props.completeness,
    });
  }, [props.completeness, props.creatorType, props.creators, props.platform, props.search, props.status]);
  const summary = useMemo(() => summarizeCreatorGroups(creatorGroups), [creatorGroups]);

  return (
    <div className="staff-list-panel agent-creator-panel">
      <CreatorSummaryStrip summary={summary} />
      <CreatorManagementFilters {...props} />
      {props.loading ? (
        <div className="table-state">正在读取主播数据...</div>
      ) : creatorGroups.length === 0 ? (
        <div className="table-state">暂无主播资料。</div>
      ) : (
        <>
          <div className="staff-table-wrap agent-creator-table-wrap">
            <table className="staff-table agent-table agent-creator-table">
              <thead>
                <tr>
                  <th>主播</th>
                  <th>平台账号</th>
                  <th>区域</th>
                  <th>状态</th>
                  <th>资料完整度</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {creatorGroups.map((group) => (
                  <tr key={group.id}>
                    <td><strong className="agent-creator-name">{group.displayName}</strong></td>
                    <td><CreatorPlatformLines profiles={group.profiles} /></td>
                    <td>{group.regionName}</td>
                    <td><CreatorStatusBadge status={group.status} /></td>
                    <td><CompletenessBadge completeness={group.completeness} /></td>
                    <td>
                      <div className="agent-creator-actions">
                        <button className="secondary-button compact-button" type="button" onClick={() => props.onView(group)}>查看资料</button>
                        <button className="secondary-button compact-button" type="button" onClick={() => props.onAdjustment(group)}>申请修改</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="agent-creator-mobile-list">
            {creatorGroups.map((group) => (
              <article key={group.id} className="agent-creator-mobile-card">
                <div className="agent-creator-mobile-head">
                  <strong>{group.displayName}</strong>
                  <CreatorStatusBadge status={group.status} />
                </div>
                <CreatorPlatformLines profiles={group.profiles} />
                <div className="agent-creator-mobile-meta">
                  <span>区域：{group.regionName}</span>
                  <CompletenessBadge completeness={group.completeness} />
                </div>
                <div className="agent-creator-actions">
                  <button className="secondary-button compact-button" type="button" onClick={() => props.onView(group)}>查看资料</button>
                  <button className="secondary-button compact-button" type="button" onClick={() => props.onAdjustment(group)}>申请修改</button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type CreatorGroupStatus = 'active' | 'invalid' | 'mixed';
type CreatorCompleteness = 'complete' | 'missing' | 'critical';

type CreatorProfileGroup = {
  id: string;
  displayName: string;
  profiles: CreatorProfile[];
  platforms: Set<CreatorPlatform>;
  regionName: string;
  scoutName: string;
  managerName: string;
  status: CreatorGroupStatus;
  completeness: CreatorCompleteness;
};

type CreatorGroupSummary = {
  total: number;
  tiktok: number;
  douyin: number;
  dualPlatform: number;
  incomplete: number;
};

function CreatorSummaryStrip({ summary }: { summary: CreatorGroupSummary }) {
  return (
    <div className="agent-creator-summary-grid">
      <CreatorSummaryCard title="我的主播" value={summary.total} />
      <CreatorSummaryCard title="TikTok" value={summary.tiktok} logoUrl={tiktokLogoUrl} />
      <CreatorSummaryCard title="抖音" value={summary.douyin} logoUrl={douyinLogoUrl} />
      <CreatorSummaryCard title="双平台" value={summary.dualPlatform} />
      <CreatorSummaryCard title="待补资料" value={summary.incomplete} tone={summary.incomplete > 0 ? 'warning' : 'default'} />
    </div>
  );
}

function CreatorSummaryCard({ title, value, logoUrl, tone = 'default' }: { title: string; value: number; logoUrl?: string; tone?: 'default' | 'warning' }) {
  return (
    <article className={`agent-creator-summary-card agent-creator-summary-card--${tone}`}>
      <div className="agent-creator-summary-title">{logoUrl ? <img src={logoUrl} alt="" aria-hidden="true" /> : null}<span>{title}</span></div>
      <strong>{value.toLocaleString('en-MY')}</strong>
    </article>
  );
}

function CreatorManagementFilters(props: {
  search: string;
  platform: string;
  creatorType: string;
  status: string;
  completeness: string;
  regionId: string;
  options: AgentOptions;
  onSearch: (value: string) => void;
  onPlatform: (value: string) => void;
  onCreatorType: (value: string) => void;
  onStatus: (value: string) => void;
  onCompleteness: (value: string) => void;
  onRegion: (value: string) => void;
}) {
  return (
    <div className="scout-filters agent-creator-filters">
      <label className="form-field agent-creator-search-field">
        <span>搜索</span>
        <input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="主播名 / UID / 平台账号" />
      </label>
      <SelectField label="平台" value={props.platform} onChange={props.onPlatform}>
        <option value="">全部</option>
        <option value="tiktok">TikTok</option>
        <option value="douyin">抖音</option>
        <option value="dual_platform">双平台</option>
      </SelectField>
      <SelectField label="类型" value={props.creatorType} onChange={props.onCreatorType}>
        <option value="">全部</option>
        <option value="5+1">5+1</option>
        <option value="non_5_1">非5+1</option>
      </SelectField>
      <SelectField label="状态" value={props.status} onChange={props.onStatus}>
        <option value="">全部</option>
        <option value="active">在职</option>
        <option value="invalid">无效</option>
        <option value="mixed">状态不同</option>
      </SelectField>
      <SelectField label="资料完整度" value={props.completeness} onChange={props.onCompleteness}>
        <option value="">全部</option>
        <option value="complete">完整</option>
        <option value="missing">待补资料</option>
        <option value="critical">重要资料缺失</option>
      </SelectField>
      <SelectField label="区域" value={props.regionId} onChange={props.onRegion}>
        <option value="">全部</option>
        {props.options.regions.map((region) => <option key={region.id} value={region.id}>{region.code}</option>)}
      </SelectField>
    </div>
  );
}

function CreatorPlatformLines({ profiles }: { profiles: CreatorProfile[] }) {
  return (
    <div className="agent-creator-platform-lines">
      {sortCreatorProfiles(profiles).map((creator) => (
        <div key={creator.id} className="agent-creator-platform-line">
          <span className="agent-creator-platform-name">
            <img src={creator.platform === 'tiktok' ? tiktokLogoUrl : douyinLogoUrl} alt="" aria-hidden="true" />
            <span>{platformLabels[creator.platform]}</span>
          </span>
          <span className="agent-creator-platform-uid">{creator.platform_user_id}</span>
          <CreatorTypeBadge type={creator.creator_type} />
        </div>
      ))}
    </div>
  );
}

function CreatorTypeBadge({ type }: { type: CreatorProfile['creator_type'] }) {
  const isPlus = type === '5+1';
  return <span className={`agent-creator-type-badge agent-creator-type-badge--${isPlus ? 'plus' : 'standard'}`}>{isPlus ? '5+1' : '非5+1'}</span>;
}

function CreatorStatusBadge({ status }: { status: CreatorGroupStatus }) {
  return <span className={`agent-creator-status-badge agent-creator-status-badge--${status}`}>{getCreatorStatusLabel(status)}</span>;
}

function CompletenessBadge({ completeness }: { completeness: CreatorCompleteness }) {
  return <span className={`agent-creator-completeness-badge agent-creator-completeness-badge--${completeness}`}>{getCompletenessLabel(completeness)}</span>;
}

function CreatorDetailDrawer({ group, onClose, onAdjustment }: { group: CreatorProfileGroup; onClose: () => void; onAdjustment: (creatorProfile?: CreatorProfile) => void }) {
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="agent-creator-drawer" role="dialog" aria-modal="true" aria-label="主播资料" onMouseDown={(event) => event.stopPropagation()}>
        <div className="agent-creator-drawer-header">
          <div>
            <span>主播资料</span>
            <h3>{group.displayName}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="agent-creator-drawer-body">
          <DrawerSection title="基本资料">
            <div className="agent-creator-drawer-grid">
              <DrawerField label="主播名" value={group.displayName} />
              <DrawerField label="区域" value={group.regionName} />
              <DrawerField label="经纪人" value={group.managerName} />
              <DrawerField label="星探" value={group.scoutName} />
              <DrawerField label="主播状态" value={<CreatorStatusBadge status={group.status} />} />
              <DrawerField label="资料完整度" value={<CompletenessBadge completeness={group.completeness} />} />
            </div>
          </DrawerSection>
          {sortCreatorProfiles(group.profiles).map((creator) => (
            <DrawerSection key={creator.id} title={`${platformLabels[creator.platform]} 平台资料`}>
              <div className="agent-creator-drawer-platform-title">
                <img src={creator.platform === 'tiktok' ? tiktokLogoUrl : douyinLogoUrl} alt="" aria-hidden="true" />
                <strong>{platformLabels[creator.platform]}</strong>
                <CreatorTypeBadge type={creator.creator_type} />
              </div>
              <div className="agent-creator-drawer-grid">
                <DrawerField label="UID" value={creator.platform_user_id} />
                <DrawerField label="平台账号" value={creator.platform_account} />
                <DrawerField label="入会日期" value={creator.joined_date} />
                <DrawerField label="主播形式" value={creatorTypeLabels[creator.creator_type]} />
                <DrawerField label="账号状态" value={<CreatorStatusBadge status={(creator.status ?? 'active') as CreatorGroupStatus} />} />
                <DrawerField label="公会状态" value={getOptionalCreatorField(creator, 'membership_status') || '-'} />
                <DrawerField label="退出日期" value={getOptionalCreatorField(creator, 'exited_date') || '-'} />
                <DrawerField label="退出原因" value={getOptionalCreatorField(creator, 'exited_reason') || '-'} />
                <DrawerField label="银行" value={creator.bank_name || '-'} />
                <DrawerField label="银行户口" value={creator.bank_account || '-'} />
              </div>
              <button className="secondary-button compact-button" type="button" onClick={() => onAdjustment(creator)}>申请修改资料</button>
            </DrawerSection>
          ))}
        </div>
      </aside>
    </div>
  );
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="agent-creator-drawer-section"><h4>{title}</h4>{children}</section>;
}

function DrawerField({ label, value }: { label: string; value: ReactNode }) {
  return <div className="agent-creator-drawer-field"><span>{label}</span><strong>{value || '-'}</strong></div>;
}

function AdjustmentPanel({ loading, pendingCount, adjustments }: { loading: boolean; pendingCount: number; adjustments: AdjustmentRequest[] }) {
  return <div className="staff-list-panel"><div className="agent-count-strip"><span>审核中 <b>{pendingCount}</b></span></div>{loading ? <div className="table-state">正在读取申请...</div> : <div className="staff-table-wrap"><table className="staff-table agent-table"><thead><tr><th>平台</th><th>主播</th><th>调整项目</th><th>申请日期</th><th>申请状态</th></tr></thead><tbody>{adjustments.map((item) => <tr key={item.id}><td>{platformLabels[item.platform]}</td><td>{item.creator?.creator_name ?? item.platform_user_id ?? '-'}</td><td>{adjustmentTypeLabels[item.request_type]}</td><td>{formatDate(item.created_at)}</td><td>{adjustmentStatusLabels[item.status]}</td></tr>)}</tbody></table></div>}</div>;
}

function AdjustmentReviewPanel(props: {
  loading: boolean;
  requests: AdjustmentReviewRequest[];
  status: string;
  platform: string;
  requestType: string;
  search: string;
  canReview: boolean;
  onStatus: (value: string) => void;
  onPlatform: (value: string) => void;
  onRequestType: (value: string) => void;
  onSearch: (value: string) => void;
  onView: (request: AdjustmentReviewRequest) => void;
  onAction: (request: AdjustmentReviewRequest, status: 'approved' | 'rejected') => void;
}) {
  const filteredRequests = useMemo(() => filterAdjustmentReviews(props.requests, props), [props]);
  const summary = useMemo(() => summarizeAdjustmentReviews(props.requests), [props.requests]);

  return (
    <div className="staff-list-panel adjustment-review-panel">
      <div className="adjustment-review-summary-grid">
        <ReviewSummaryCard title="待审核" value={summary.pending} tone="pending" />
        <ReviewSummaryCard title="已通过" value={summary.approved} tone="approved" />
        <ReviewSummaryCard title="已拒绝" value={summary.rejected} tone="rejected" />
        <ReviewSummaryCard title="本月申请" value={summary.currentMonth} />
      </div>
      <div className="scout-filters adjustment-review-filters">
        <SelectField label="状态" value={props.status} onChange={props.onStatus}>
          <option value="pending">待审核</option>
          <option value="approved">已通过</option>
          <option value="rejected">已拒绝</option>
          <option value="">全部</option>
        </SelectField>
        <SelectField label="平台" value={props.platform} onChange={props.onPlatform}>
          <option value="">全部</option>
          <option value="tiktok">TikTok</option>
          <option value="douyin">抖音</option>
        </SelectField>
        <SelectField label="申请类型" value={props.requestType} onChange={props.onRequestType}>
          <option value="">全部</option>
          {adjustmentTypes.map((type) => <option key={type} value={type}>{adjustmentTypeLabels[type]}</option>)}
        </SelectField>
        <label className="form-field adjustment-review-search-field">
          <span>搜索</span>
          <input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="主播名 / UID / 经纪人" />
        </label>
      </div>
      {props.loading ? (
        <div className="table-state">正在读取审批申请...</div>
      ) : filteredRequests.length === 0 ? (
        <div className="table-state">暂无资料调整申请。</div>
      ) : (
        <>
          <div className="staff-table-wrap adjustment-review-table-wrap">
            <table className="staff-table agent-table adjustment-review-table">
              <thead>
                <tr>
                  <th>主播</th>
                  <th>平台 / UID</th>
                  <th>申请项目</th>
                  <th>目标资料</th>
                  <th>申请人</th>
                  <th>申请时间</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((request) => (
                  <tr key={request.id}>
                    <td><strong>{getAdjustmentCreatorName(request)}</strong></td>
                    <td><ReviewPlatformLabel request={request} /></td>
                    <td>{adjustmentTypeLabels[request.request_type]}</td>
                    <td>{formatAdjustmentTarget(request)}</td>
                    <td>{getAdjustmentRequesterName(request)}</td>
                    <td>{formatDate(request.created_at)}</td>
                    <td><AdjustmentStatusBadge status={request.status} /></td>
                    <td><ReviewActions request={request} canReview={props.canReview} onView={props.onView} onAction={props.onAction} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="adjustment-review-mobile-list">
            {filteredRequests.map((request) => (
              <article className="adjustment-review-mobile-card" key={request.id}>
                <div className="adjustment-review-mobile-head">
                  <strong>{getAdjustmentCreatorName(request)}</strong>
                  <AdjustmentStatusBadge status={request.status} />
                </div>
                <ReviewPlatformLabel request={request} />
                <div className="adjustment-review-mobile-meta">
                  <span>{adjustmentTypeLabels[request.request_type]}</span>
                  <span>{formatAdjustmentTarget(request)}</span>
                  <span>申请人：{getAdjustmentRequesterName(request)}</span>
                  <span>申请时间：{formatDate(request.created_at)}</span>
                </div>
                <ReviewActions request={request} canReview={props.canReview} onView={props.onView} onAction={props.onAction} />
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ReviewSummaryCard({ title, value, tone = 'default' }: { title: string; value: number; tone?: 'default' | AdjustmentReviewRequest['status'] }) {
  return <article className={`adjustment-review-summary-card adjustment-review-summary-card--${tone}`}><span>{title}</span><strong>{value.toLocaleString('en-MY')}</strong></article>;
}

function ReviewPlatformLabel({ request }: { request: AdjustmentReviewRequest }) {
  const logoUrl = request.platform === 'tiktok' ? tiktokLogoUrl : douyinLogoUrl;
  return (
    <span className="adjustment-review-platform">
      <img src={logoUrl} alt="" aria-hidden="true" />
      <span>{platformLabels[request.platform]}</span>
      <b>{request.platform_user_id ?? '-'}</b>
    </span>
  );
}

function ReviewActions({ request, canReview, onView, onAction }: { request: AdjustmentReviewRequest; canReview: boolean; onView: (request: AdjustmentReviewRequest) => void; onAction: (request: AdjustmentReviewRequest, status: 'approved' | 'rejected') => void }) {
  const missingTargetEmail = getMissingTargetEmailReviewMessage(request);
  return (
    <div className="adjustment-review-actions">
      <button className="secondary-button compact-button" type="button" onClick={() => onView(request)}>查看详情</button>
      {request.status === 'pending' && canReview ? (
        <>
          {missingTargetEmail ? <span className="adjustment-review-action-note">{missingTargetEmail}</span> : <button className="secondary-button compact-button accept-button" type="button" onClick={() => onAction(request, 'approved')}>通过</button>}
          <button className="secondary-button compact-button reject-button" type="button" onClick={() => onAction(request, 'rejected')}>拒绝</button>
        </>
      ) : null}
    </div>
  );
}

function AdjustmentStatusBadge({ status }: { status: AdjustmentReviewRequest['status'] }) {
  return <span className={`adjustment-review-status adjustment-review-status--${status}`}>{adjustmentStatusLabels[status]}</span>;
}

function AdjustmentReviewDrawer({ request, onClose }: { request: AdjustmentReviewRequest; onClose: () => void }) {
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="adjustment-review-drawer" role="dialog" aria-modal="true" aria-label="主播资料调整审批详情" onMouseDown={(event) => event.stopPropagation()}>
        <div className="adjustment-review-drawer-header">
          <div>
            <span>资料调整审批</span>
            <h3>{getAdjustmentCreatorName(request)}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="adjustment-review-drawer-body">
          <DrawerSection title="主播资料">
            <div className="agent-creator-drawer-grid">
              <DrawerField label="主播名" value={getAdjustmentCreatorName(request)} />
              <DrawerField label="平台" value={platformLabels[request.platform]} />
              <DrawerField label="UID" value={request.platform_user_id ?? '-'} />
              <DrawerField label="平台账号" value={request.creator?.platform_account ?? '-'} />
            </div>
          </DrawerSection>
          <DrawerSection title="申请内容">
            <div className="agent-creator-drawer-grid">
              <DrawerField label="申请类型" value={adjustmentTypeLabels[request.request_type]} />
              <DrawerField label="目标资料" value={formatAdjustmentTarget(request)} />
              {request.request_type === 'change_manager' ? <DrawerField label="目标经纪人昵称" value={request.target_nickname ?? '-'} /> : null}
              {request.request_type === 'change_manager' ? <DrawerField label="目标经纪人后台 Email" value={request.target_email ?? '-'} /> : null}
              {request.request_type === 'change_scout' ? <DrawerField label="目标星探昵称" value={request.target_nickname ?? '-'} /> : null}
              {request.request_type === 'change_scout' ? <DrawerField label="目标星探后台 Email" value={request.target_email ?? '-'} /> : null}
              {['to_company', 'to_5_1', 'change_bank'].includes(request.request_type) ? <DrawerField label="银行" value={request.bank_name ?? '-'} /> : null}
              {['to_company', 'to_5_1', 'change_bank'].includes(request.request_type) ? <DrawerField label="银行户口" value={request.bank_account ?? '-'} /> : null}
              <DrawerField label="申请备注" value={request.content ?? '-'} />
            </div>
          </DrawerSection>
          <DrawerSection title="申请记录">
            <div className="agent-creator-drawer-grid">
              <DrawerField label="申请人" value={getAdjustmentRequesterName(request)} />
              <DrawerField label="申请时间" value={formatDate(request.created_at)} />
              <DrawerField label="状态" value={<AdjustmentStatusBadge status={request.status} />} />
              {request.reviewed_at ? <DrawerField label="审批时间" value={formatDate(request.reviewed_at)} /> : null}
              {request.reviewer ? <DrawerField label="审批人" value={request.reviewer.nickname || request.reviewer.full_name || request.reviewer.email || '-'} /> : null}
              {request.review_note ? <DrawerField label="审批备注" value={request.review_note} /> : null}
            </div>
          </DrawerSection>
        </div>
      </aside>
    </div>
  );
}

function AdjustmentReviewActionModal({ action, saving, onChange, onClose, onSubmit }: { action: { request: AdjustmentReviewRequest; status: 'approved' | 'rejected'; note: string }; saving: boolean; onChange: (note: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const approving = action.status === 'approved';
  const missingTargetEmail = approving ? getMissingTargetEmailReviewMessage(action.request) : '';
  return (
    <SystemModal
      title={approving ? '确认通过资料调整申请？' : '确认拒绝资料调整申请？'}
      ariaLabel={approving ? '确认通过资料调整申请' : '确认拒绝资料调整申请'}
      onClose={onClose}
      footer={<><button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button><button className="primary-button compact-button" type="submit" form="adjustment-review-action-form" disabled={saving || Boolean(missingTargetEmail)}>{approving ? '确认通过' : '确认拒绝'}</button></>}
    >
      <form id="adjustment-review-action-form" className="adjustment-review-confirm" onSubmit={onSubmit}>
        <div className="adjustment-review-confirm-summary">
          <strong>{getAdjustmentCreatorName(action.request)}</strong>
          <span>{platformLabels[action.request.platform]} / {action.request.platform_user_id ?? '-'}</span>
          <span>{adjustmentTypeLabels[action.request.request_type]}</span>
          <span>{formatAdjustmentTarget(action.request)}</span>
        </div>
        {missingTargetEmail ? <p className="form-alert">{missingTargetEmail}</p> : null}
        {approving && action.request.request_type === 'change_manager' ? <p className="form-alert">审批通过后，系统将执行主播经纪人归属同步。</p> : null}
        <label className="form-field form-field-wide">
          <span>{approving ? '审批备注' : '拒绝原因'}</span>
          <textarea value={action.note} onChange={(event) => onChange(event.target.value)} required={!approving} />
        </label>
      </form>
    </SystemModal>
  );
}

function AgentDesignPanel({ loading, unclaimed, inProgress, requests, onStatus }: { loading: boolean; unclaimed: number; inProgress: number; requests: DesignRequest[]; onStatus: (request: DesignRequest, status: 'confirming' | 'revision' | 'ok' | 'cancelled') => void }) {
  return <div className="staff-list-panel"><div className="agent-count-strip"><span>未接单 <b>{unclaimed}</b></span><span>制作中 <b>{inProgress}</b></span></div>{loading ? <div className="table-state">正在读取美工申请...</div> : <div className="staff-table-wrap"><table className="staff-table agent-table"><thead><tr><th>类型</th><th>主播</th><th>状态</th><th>美工</th><th>申请内容</th><th>操作</th></tr></thead><tbody>{requests.map((item) => <tr key={item.id}><td>{designTypeLabels[item.request_type]}</td><td>{item.creator_name || item.platform_user_id || '-'}</td><td>{designStatusLabels[item.status]}</td><td>{getEmployeeName(item.designer) || '-'}</td><td>{item.design_content || item.special_content || '-'}</td><td><div className="row-actions"><button className="icon-button" type="button" onClick={() => onStatus(item, 'confirming')} aria-label="跟主播确认中"><Send size={16} /></button><button className="icon-button" type="button" onClick={() => onStatus(item, 'revision')} aria-label="调整申请"><RefreshCw size={16} /></button><button className="icon-button accept-button" type="button" onClick={() => onStatus(item, 'ok')} aria-label="OK"><Check size={16} /></button><button className="icon-button reject-button" type="button" onClick={() => onStatus(item, 'cancelled')} aria-label="取消"><X size={16} /></button></div></td></tr>)}</tbody></table></div>}</div>;
}

function AdjustmentModal({
  values,
  saving,
  currentRegionId,
  onChange,
  onClose,
  onSubmit,
}: {
  values: AdjustmentFormValues;
  saving: boolean;
  currentRegionId: string;
  onChange: (values: AdjustmentFormValues) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const needsEffective = ['to_online', 'to_company', 'to_5_1', 'change_bank'].includes(values.request_type);
  const needsBank = ['to_company', 'to_5_1', 'change_bank'].includes(values.request_type);
  const needsTarget = values.request_type === 'change_manager' || values.request_type === 'change_scout';
  function updateRequestType(value: string) {
    onChange({ ...values, request_type: value as AdjustmentType, target_nickname: '', target_email: '' });
  }

  function updateTarget(employee: AdjustmentTargetEmployee | null) {
    onChange({
      ...values,
      target_nickname: employee ? employee.nickname || employee.full_name : '',
      target_email: employee?.email ?? '',
    });
  }

  return (
    <SystemModal
      title="添加新申请"
      ariaLabel="主播资料调整申请"
      onClose={onClose}
      footer={<><button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button><button className="primary-button compact-button" type="submit" form="adjustment-form" disabled={saving}>提交</button></>}
    >
      <form id="adjustment-form" onSubmit={onSubmit}>
        <div className="form-grid">
          <SelectField label="平台" value={values.platform} onChange={(value) => onChange({ ...values, platform: value as CreatorPlatform })}>
            <option value="tiktok">TikTok</option>
            <option value="douyin">抖音</option>
          </SelectField>
          <SelectField label="可申请项目" value={values.request_type} onChange={updateRequestType}>
            {adjustmentTypes.map((type) => <option key={type} value={type}>{adjustmentTypeLabels[type]}</option>)}
          </SelectField>
          {values.request_type !== 'special' ? <TextField label={values.platform === 'tiktok' ? 'TikTok ID' : '抖音 UID'} value={values.platform_user_id} onChange={(value) => onChange({ ...values, platform_user_id: value })} required /> : null}
          {needsEffective ? <TextField label="生效日期" type="date" value={values.effective_date} onChange={(value) => onChange({ ...values, effective_date: value })} /> : null}
          {needsBank ? (
            <>
              <TextField label="全名" value={values.full_name} onChange={(value) => onChange({ ...values, full_name: value })} />
              <TextField label="银行" value={values.bank_name} onChange={(value) => onChange({ ...values, bank_name: value })} />
              <TextField label="银行户口" value={values.bank_account} onChange={(value) => onChange({ ...values, bank_account: value })} />
            </>
          ) : null}
          {needsTarget ? (
            <AdjustmentTargetEmployeeSearch
              label={values.request_type === 'change_manager' ? '目标经纪人' : '目标星探'}
              targetType={values.request_type === 'change_manager' ? 'manager' : 'scout'}
              selectedTargetEmail={values.target_email}
              currentRegionId={currentRegionId}
              onSelect={updateTarget}
            />
          ) : null}
          <label className="form-field form-field-wide">
            <span>特殊申请 / 备注</span>
            <textarea value={values.content} onChange={(event) => onChange({ ...values, content: event.target.value })} />
          </label>
        </div>
      </form>
    </SystemModal>
  );
}

function AdjustmentTargetEmployeeSearch({
  label,
  targetType,
  selectedTargetEmail,
  currentRegionId,
  onSelect,
}: {
  label: string;
  targetType: 'manager' | 'scout';
  selectedTargetEmail: string;
  currentRegionId: string;
  onSelect: (employee: AdjustmentTargetEmployee | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [employees, setEmployees] = useState<AdjustmentTargetEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const selectedEmployee = employees.find((employee) => employee.email?.toLowerCase() === selectedTargetEmail.toLowerCase()) ?? null;
  const selectedLabel = selectedEmployee ? formatAdjustmentTargetEmployee(selectedEmployee) : '';

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setEmployees([]);

    agentService.listAdjustmentTargetEmployees(targetType)
      .then((items) => {
        if (!active) return;
        setEmployees(items);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(`读取候选员工失败：${getErrorMessage(loadError)}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [targetType]);

  useEffect(() => {
    if (selectedLabel) setQuery(selectedLabel);
    if (!selectedTargetEmail) setQuery('');
  }, [selectedLabel, selectedTargetEmail]);

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return employees
      .filter((employee) => {
        if (!normalizedQuery || selectedLabel === query) return true;
        return [
          employee.nickname ?? '',
          employee.full_name,
          employee.employee_code ?? '',
        ].join(' ').toLowerCase().includes(normalizedQuery);
      })
      .sort((first, second) => {
        const firstSameRegion = currentRegionId && first.region_id === currentRegionId ? 0 : 1;
        const secondSameRegion = currentRegionId && second.region_id === currentRegionId ? 0 : 1;
        if (firstSameRegion !== secondSameRegion) return firstSameRegion - secondSameRegion;
        return formatAdjustmentTargetEmployee(first).localeCompare(formatAdjustmentTargetEmployee(second), 'zh-Hans');
      })
      .slice(0, 8);
  }, [currentRegionId, employees, query, selectedLabel]);

  function handleQueryChange(value: string) {
    setQuery(value);
    setOpen(true);
    if (selectedEmployee && value !== selectedLabel) onSelect(null);
  }

  function selectEmployee(employee: AdjustmentTargetEmployee) {
    setQuery(formatAdjustmentTargetEmployee(employee));
    setOpen(false);
    onSelect(employee.email ? employee : null);
  }

  return (
    <label className="form-field form-field-wide agent-adjustment-target-field">
      <span>{label}</span>
      <div className="agent-adjustment-target-combobox">
        <input
          value={query}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => handleQueryChange(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="搜索姓名 / 昵称 / 员工编号"
          required
        />
        {selectedEmployee ? <span className="agent-adjustment-target-selected">已选择：{formatAdjustmentTargetEmployee(selectedEmployee)}</span> : null}
        {error ? <span className="agent-adjustment-target-error">{error}</span> : null}
        {open ? (
          <div className="agent-adjustment-target-dropdown" role="listbox">
            {loading ? <div className="agent-adjustment-target-empty">正在读取候选员工...</div> : null}
            {!loading && filteredEmployees.length === 0 ? <div className="agent-adjustment-target-empty">没有符合条件的员工</div> : null}
            {!loading && filteredEmployees.map((employee) => (
              <button
                key={employee.id}
                className="agent-adjustment-target-option"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectEmployee(employee)}
                role="option"
                aria-selected={employee.id === selectedEmployee?.id}
              >
                {formatAdjustmentTargetEmployee(employee)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </label>
  );
}

function DesignModal({ values, saving, onChange, onClose, onSubmit }: { values: DesignFormValues; saving: boolean; onChange: (values: DesignFormValues) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const isSpecial = values.request_type === 'special';
  const isPoster = values.request_type === 'poster';
  return <SystemModal title="添加新申请" ariaLabel="美工申请" onClose={onClose} footer={<><button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button><button className="primary-button compact-button" type="submit" form="design-form" disabled={saving}>提交</button></>}><form id="design-form" onSubmit={onSubmit}><div className="form-grid"><SelectField label="申请类型" value={values.request_type} onChange={(value) => onChange({ ...values, request_type: value as DesignRequestType })}>{designTypes.map((type) => <option key={type} value={type}>{designTypeLabels[type]}</option>)}</SelectField>{!isSpecial ? <><SelectField label="平台" value={values.platform} onChange={(value) => onChange({ ...values, platform: value as CreatorPlatform })}><option value="tiktok">TikTok</option><option value="douyin">抖音</option></SelectField><TextField label={values.platform === 'tiktok' ? 'TikTok ID' : '抖音 UID'} value={values.platform_user_id} onChange={(value) => onChange({ ...values, platform_user_id: value })} /><TextField label={values.platform === 'tiktok' ? 'TikTok 名字' : '抖音名字'} value={values.creator_name} onChange={(value) => onChange({ ...values, creator_name: value })} /><TextField label={values.platform === 'tiktok' ? 'TikTok 用户名' : '抖音号'} value={values.platform_account} onChange={(value) => onChange({ ...values, platform_account: value })} /></> : null}{!isSpecial && !isPoster ? <><TextField label="粉丝昵称" value={values.fan_nickname} onChange={(value) => onChange({ ...values, fan_nickname: value })} /><TextField label="粉丝灯牌等级 / 财富等级" value={values.fan_level} onChange={(value) => onChange({ ...values, fan_level: value })} /><SelectField label="打印方式" value={values.print_method} onChange={(value) => onChange({ ...values, print_method: value as DesignFormValues['print_method'] })}>{Object.entries(printMethodLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</SelectField></> : null}{!isSpecial ? <TextField label={isPoster ? '海报内容' : '设计内容'} value={values.design_content} onChange={(value) => onChange({ ...values, design_content: value })} /> : null}{isPoster ? <TextField label="设计元素" value={values.design_elements} onChange={(value) => onChange({ ...values, design_elements: value })} /> : null}{isSpecial ? <label className="form-field form-field-wide"><span>自由需求说明</span><textarea value={values.special_content} onChange={(event) => onChange({ ...values, special_content: event.target.value })} /></label> : null}<label className="form-field form-field-wide"><span>参考图片链接（每行一个，未来可接文件上传）</span><textarea value={values.reference_urls} onChange={(event) => onChange({ ...values, reference_urls: event.target.value })} /></label></div></form></SystemModal>;
}

type OperationStatus = 'missing' | 'filled';
type OperationCellStatus = OperationStatus | 'future';
type OperationPlatformFilter = '' | CreatorPlatform | 'dual_platform';
type OperationQuickRange = 'previous' | 'month' | 'last30' | 'custom' | 'year';
type RevenuePeriodRange = {
  startIso: string;
  endIso: string;
  label: string;
  shortLabel: string;
};
type OperationDateRange = {
  startIso: string;
  endIso: string;
};
type OperationFilters = {
  quickRange: OperationQuickRange;
  status: '' | OperationStatus;
  platform: OperationPlatformFilter;
  creatorType: '' | '5+1' | 'non_5_1';
  search: string;
  periodStart: string;
  customStart: string;
  customEnd: string;
};
type OperationRow = {
  creator: CreatorProfile;
  record: WeeklyRevenueRecord | null;
  status: OperationStatus;
  period: RevenuePeriodRange;
};
type OperationCellProfile = {
  creator: CreatorProfile;
  record: WeeklyRevenueRecord | null;
  status: OperationCellStatus;
  period: RevenuePeriodRange;
};
type OperationPeriodCell = {
  period: RevenuePeriodRange;
  profiles: OperationCellProfile[];
  status: OperationCellStatus;
};
type OperationMonthSummaryEntry = {
  platform: CreatorPlatform;
  total: number;
  hasRecord: boolean;
};
type OperationStreamerRow = {
  id: string;
  displayName: string;
  regionLabel: string;
  profiles: CreatorProfile[];
  periods: OperationPeriodCell[];
  status: OperationStatus;
  latestNote: string;
  monthSummary: OperationMonthSummaryEntry[];
};

const operationQuickRangeOptions: { value: OperationQuickRange; label: string }[] = [
  { value: 'previous', label: '上周期' },
  { value: 'month', label: '本月' },
  { value: 'last30', label: '近30天' },
  { value: 'custom', label: '自定义' },
  { value: 'year', label: '本年' },
];

function AgentPeriodRevenuePanel(props: {
  loading: boolean;
  month: string;
  regionId: string;
  options: AgentOptions;
  creators: CreatorProfile[];
  onMonth: (value: string) => void;
  onRegion: (value: string) => void;
  onRefresh: () => void;
}) {
  const currentPeriod = useMemo(() => getRevenuePeriodForDate(new Date()), []);
  const todayIso = useMemo(() => formatLocalDate(new Date()), []);
  const defaultPeriodStart = useMemo(() => getDefaultPeriodStartForMonth(props.month, currentPeriod.startIso), [currentPeriod.startIso, props.month]);
  const monthDateRange = useMemo(() => getMonthDateRange(props.month), [props.month]);
  const currentPreviousPeriod = useMemo(() => getPreviousRevenuePeriod(currentPeriod.startIso), [currentPeriod.startIso]);
  const [filters, setFilters] = useState<OperationFilters>({
    quickRange: 'month',
    status: '',
    platform: '',
    creatorType: '',
    search: '',
    periodStart: defaultPeriodStart,
    customStart: monthDateRange.startIso,
    customEnd: monthDateRange.endIso,
  });
  const [recordsByPeriod, setRecordsByPeriod] = useState<Record<string, Record<string, WeeklyRevenueRecord>>>({});
  const [previousRecords, setPreviousRecords] = useState<Record<string, WeeklyRevenueRecord>>({});
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [featureUnavailable, setFeatureUnavailable] = useState(false);
  const [message, setMessage] = useState('');
  const [activeRow, setActiveRow] = useState<OperationRow | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const sortedCreators = useMemo(() => sortOperationCreators(props.creators), [props.creators]);
  const effectiveDateRange = useMemo(() => getOperationEffectiveDateRange(filters.quickRange, {
    monthDateRange,
    previousPeriod: currentPreviousPeriod,
    customStart: filters.customStart,
    customEnd: filters.customEnd,
    todayIso,
  }), [currentPreviousPeriod, filters.customEnd, filters.customStart, filters.quickRange, monthDateRange, todayIso]);
  const effectivePeriodOptions = useMemo(() => getRevenuePeriodsForDateRange(effectiveDateRange), [effectiveDateRange]);
  const selectedPeriod = useMemo(() => effectivePeriodOptions.find((period) => period.startIso === filters.periodStart) ?? effectivePeriodOptions[0], [effectivePeriodOptions, filters.periodStart]);

  useEffect(() => {
    if (effectivePeriodOptions.length === 0) return;
    setFilters((current) => effectivePeriodOptions.some((period) => period.startIso === current.periodStart) ? current : { ...current, periodStart: effectivePeriodOptions[0].startIso });
  }, [effectivePeriodOptions]);

  useEffect(() => {
    setPage(1);
  }, [effectiveDateRange, filters, pageSize, props.month, props.regionId]);

  useEffect(() => {
    let active = true;
    const creatorProfileIds = sortedCreators.map((creator) => creator.id);
    setMessage('');
    setRecordsByPeriod({});
    setPreviousRecords({});
    if (creatorProfileIds.length === 0 || effectivePeriodOptions.length === 0) return;

    setWeeklyLoading(true);
    setFeatureUnavailable(false);
    Promise.all([
      Promise.all(effectivePeriodOptions.map((period) => agentService.listWeeklyRevenueRecords({ creatorProfileIds, weekStartDate: period.startIso }))),
      agentService.listWeeklyRevenueRecords({ creatorProfileIds, weekStartDate: currentPreviousPeriod.startIso }),
    ])
      .then(([periodItems, previousItems]) => {
        if (!active) return;
        setRecordsByPeriod(Object.fromEntries(effectivePeriodOptions.map((period, index) => [
          period.startIso,
          Object.fromEntries((periodItems[index] ?? []).map((item) => [item.creator_profile_id, item])),
        ])));
        setPreviousRecords(Object.fromEntries(previousItems.map((item) => [item.creator_profile_id, item])));
      })
      .catch(() => {
        if (!active) return;
        setFeatureUnavailable(true);
      })
      .finally(() => {
        if (active) setWeeklyLoading(false);
      });

    return () => {
      active = false;
    };
  }, [currentPreviousPeriod.startIso, effectivePeriodOptions, sortedCreators]);

  const currentRows = useMemo(
    () => buildOperationStreamerRows(sortedCreators, effectivePeriodOptions, recordsByPeriod, filters, todayIso),
    [effectivePeriodOptions, filters, recordsByPeriod, sortedCreators, todayIso],
  );
  const filteredCurrentRows = useMemo(() => filterOperationStreamerRows(currentRows, filters).sort(sortOperationStreamerRows), [currentRows, filters]);
  const summary = useMemo(() => summarizeOperationStreamerRows(currentRows), [currentRows]);
  const previousMissingCount = useMemo(() => sortedCreators.filter((creator) => !previousRecords[creator.id]).length, [previousRecords, sortedCreators]);
  const pageCount = Math.max(1, Math.ceil(filteredCurrentRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paginatedCurrentRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredCurrentRows.slice(start, start + pageSize);
  }, [filteredCurrentRows, pageSize, safePage]);

  function updateFilter<Key extends keyof OperationFilters>(key: Key, value: OperationFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function updateMonth(value: string) {
    props.onMonth(value);
    setFilters((current) => ({ ...current, periodStart: getDefaultPeriodStartForMonth(value, currentPeriod.startIso) }));
  }

  function updateQuickRange(value: OperationQuickRange) {
    if (value === 'previous') {
      const previousMonth = currentPreviousPeriod.startIso.slice(0, 7);
      props.onMonth(previousMonth);
      setFilters((current) => ({ ...current, quickRange: value, status: 'missing', periodStart: currentPreviousPeriod.startIso }));
      return;
    }
    if (value === 'month') {
      const currentMonth = currentPeriod.startIso.slice(0, 7);
      props.onMonth(currentMonth);
      setFilters((current) => ({ ...current, quickRange: value, periodStart: getDefaultPeriodStartForMonth(currentMonth, currentPeriod.startIso) }));
      return;
    }
    if (value === 'custom') {
      setFilters((current) => ({
        ...current,
        quickRange: value,
        customStart: current.customStart || monthDateRange.startIso,
        customEnd: current.customEnd || monthDateRange.endIso,
      }));
      return;
    }
    setFilters((current) => ({ ...current, quickRange: value }));
  }

  function viewPreviousMissing() {
    updateQuickRange('previous');
  }

  function updateRecord(record: WeeklyRevenueRecord) {
    setRecordsByPeriod((current) => ({
      ...current,
      [record.week_start_date]: {
        ...(current[record.week_start_date] ?? {}),
        [record.creator_profile_id]: record,
      },
    }));
    setMessage('周期流水已保存。');
    setActiveRow(null);
  }

  return (
    <div className="staff-list-panel agent-operation-page agent-period-workbench">
      {message ? <p className="form-success agent-operation-alert">{message}</p> : null}
      {featureUnavailable ? <p className="form-alert agent-operation-alert">周期流水数据库 003 尚未启用，暂不能保存新周期流水。</p> : null}

      {featureUnavailable ? null : (
        <>
          <div className="agent-operation-kpi-grid">
            <OperationKpiCard label="流水概览" value={<KpiOverview tiktokTotal={summary.tiktokTotal} douyinTotal={summary.douyinTotal} />} detail={`${summary.rows} 位主播`} tone="overview" />
            <OperationKpiCard label="TikTok 总钻石" value={formatRevenueAmount(summary.tiktokTotal)} detail="钻石" tone="tiktok" icon={<img src={tiktokLogoUrl} alt="" aria-hidden="true" />} />
            <OperationKpiCard label="抖音总音浪" value={formatRevenueAmount(summary.douyinTotal)} detail="音浪" tone="douyin" icon={<img src={douyinLogoUrl} alt="" aria-hidden="true" />} />
            <OperationKpiCard label="已填写" value={summary.filled} detail="可填写周期" tone="filled" />
            <OperationKpiCard label="未填写" value={summary.missing} detail="可填写周期" tone="missing" />
          </div>

          <div className={`agent-period-previous-alert agent-period-previous-alert--${previousMissingCount > 0 ? 'missing' : 'filled'}`}>
            <div>
              <i aria-hidden="true">!</i>
              <span>{previousMissingCount > 0 ? `上周期 ${currentPreviousPeriod.label} 还有 ${previousMissingCount} 个平台账号未填写流水` : '上周期流水已全部填写'}</span>
            </div>
            {previousMissingCount > 0 ? <button className="secondary-button compact-button" type="button" onClick={viewPreviousMissing}>查看未填写</button> : null}
          </div>

          <OperationFilterBar
            filters={filters}
            effectiveDateRange={effectiveDateRange}
            regionId={props.regionId}
            regions={props.options.regions}
            onQuickRange={updateQuickRange}
            onFilter={updateFilter}
            onRegion={props.onRegion}
            onRefresh={props.onRefresh}
            refreshing={props.loading || weeklyLoading}
          />

          <CurrentOperationTable
            loading={props.loading || weeklyLoading}
            rows={paginatedCurrentRows}
            allRows={filteredCurrentRows}
            periods={effectivePeriodOptions}
            selectedPeriodStart={selectedPeriod?.startIso ?? ''}
            page={safePage}
            pageCount={pageCount}
            pageSize={pageSize}
            total={filteredCurrentRows.length}
            onOpen={setActiveRow}
            onPage={setPage}
            onPageSize={setPageSize}
          />
        </>
      )}

      {!featureUnavailable && activeRow ? (
        <WeeklyRevenueModal
          row={activeRow}
          onClose={() => setActiveRow(null)}
          onSubmitted={updateRecord}
        />
      ) : null}
    </div>
  );
}

function KpiOverview({ tiktokTotal, douyinTotal }: { tiktokTotal: number; douyinTotal: number }) {
  return (
    <span className="agent-period-kpi-overview">
      <span><em>TikTok</em><b>{formatRevenueAmount(tiktokTotal)}</b><small>钻石</small></span>
      <span><em>抖音</em><b>{formatRevenueAmount(douyinTotal)}</b><small>音浪</small></span>
    </span>
  );
}

function OperationKpiCard({ label, value, detail, tone, icon }: { label: string; value: ReactNode; detail?: string; tone?: OperationStatus | 'overview' | 'tiktok' | 'douyin'; icon?: ReactNode }) {
  return <article className={`agent-operation-kpi-card ${tone ? `agent-operation-kpi-card--${tone}` : ''}`}><div className="agent-period-kpi-head"><span>{label}</span>{icon ? <i>{icon}</i> : null}</div><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</article>;
}

function OperationFilterBar(props: {
  filters: OperationFilters;
  effectiveDateRange: OperationDateRange;
  regionId: string;
  regions: AgentOptions['regions'];
  onQuickRange: (value: OperationQuickRange) => void;
  onFilter: <Key extends keyof OperationFilters>(key: Key, value: OperationFilters[Key]) => void;
  onRegion: (value: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const dateRangeLabel = formatDateRangeText(props.effectiveDateRange.startIso, props.effectiveDateRange.endIso);

  return (
    <div className="agent-operation-filter-panel">
      <div className="agent-operation-filter-row agent-operation-filter-row--primary">
        <div className="agent-operation-quick-range" role="group" aria-label="时间范围">
          <span>时间范围</span>
          <div>
            {operationQuickRangeOptions.map((option) => (
              <button
                key={option.value}
                className={props.filters.quickRange === option.value ? 'active' : ''}
                type="button"
                onClick={() => props.onQuickRange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <label className={`form-field agent-operation-date-range ${props.filters.quickRange === 'custom' ? 'agent-operation-date-range--custom' : ''}`}>
          <span>日期范围</span>
          {props.filters.quickRange === 'custom' ? (
            <div>
              <input type="date" value={props.filters.customStart} onChange={(event) => props.onFilter('customStart', event.target.value)} />
              <b>~</b>
              <input type="date" value={props.filters.customEnd} onChange={(event) => props.onFilter('customEnd', event.target.value)} />
            </div>
          ) : (
            <input readOnly value={dateRangeLabel} aria-label="日期范围" />
          )}
        </label>
        <SelectField label="平台" value={props.filters.platform} onChange={(value) => props.onFilter('platform', value as OperationFilters['platform'])}>
          <option value="">全部平台</option>
          <option value="tiktok">TikTok</option>
          <option value="douyin">抖音</option>
          <option value="dual_platform">双平台</option>
        </SelectField>
        <SelectField label="类型" value={props.filters.creatorType} onChange={(value) => props.onFilter('creatorType', value as OperationFilters['creatorType'])}>
          <option value="">全部类型</option>
          <option value="5+1">5+1</option>
          <option value="non_5_1">非5+1</option>
        </SelectField>
        <SelectField label="区域" value={props.regionId} onChange={props.onRegion}>
          <option value="">全部</option>
          {props.regions.map((region) => <option key={region.id} value={region.id}>{region.code}</option>)}
        </SelectField>
        <SelectField label="状态" value={props.filters.status} onChange={(value) => props.onFilter('status', value as OperationFilters['status'])}>
          <option value="">全部</option>
          <option value="missing">未填写</option>
          <option value="filled">已填写</option>
        </SelectField>
      </div>
      <div className="agent-operation-filter-row agent-operation-filter-row--secondary">
        <TextField label="搜索" value={props.filters.search} onChange={(value) => props.onFilter('search', value)} placeholder="搜索主播名 / 平台 UID / 平台账号" />
        <button className="secondary-button compact-button agent-operation-refresh-button" type="button" onClick={props.onRefresh} disabled={props.refreshing}><RefreshCw size={15} /><span>刷新</span></button>
      </div>
    </div>
  );
}

function CurrentOperationTable(props: {
  loading: boolean;
  rows: OperationStreamerRow[];
  allRows: OperationStreamerRow[];
  periods: RevenuePeriodRange[];
  selectedPeriodStart: string;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onOpen: (row: OperationRow) => void;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}) {
  const { loading, rows, allRows, periods, selectedPeriodStart, page, pageCount, pageSize, total, onOpen, onPage, onPageSize } = props;
  if (loading) return <div className="table-state agent-operation-state">正在读取周期流水...</div>;
  if (allRows.length === 0) return <div className="table-state agent-operation-state">没有符合条件的主播。</div>;

  return (
    <>
      <div className="staff-table-wrap agent-operation-table-wrap">
        <table className="staff-table agent-table agent-period-table">
          <colgroup>
            <col className="agent-period-col-creator" />
            <col className="agent-period-col-platform" />
            <col className="agent-period-col-type" />
            {periods.map((period) => <col key={period.startIso} className="agent-period-col-period" />)}
            <col className="agent-period-col-month" />
            <col className="agent-period-col-status" />
            <col className="agent-period-col-note" />
            <col className="agent-period-col-action" />
          </colgroup>
          <thead>
            <tr>
              <th>主播</th>
              <th>平台</th>
              <th>类型</th>
              {periods.map((period) => <th key={period.startIso} className={period.startIso === selectedPeriodStart ? 'agent-period-head-selected' : ''}>{formatOperationPeriodHeader(period, periods)}</th>)}
              <th>本月情况</th>
              <th>状态</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>{rows.map((row) => <OperationTableRow key={row.id} row={row} selectedPeriodStart={selectedPeriodStart} onOpen={onOpen} />)}</tbody>
        </table>
      </div>
      <div className="agent-operation-mobile-list">
        {rows.map((row) => <OperationMobileCard key={row.id} row={row} selectedPeriodStart={selectedPeriodStart} onOpen={onOpen} />)}
      </div>
      <OperationPagination page={page} pageCount={pageCount} pageSize={pageSize} total={total} onPage={onPage} onPageSize={onPageSize} />
    </>
  );
}

function OperationTableRow({ row, selectedPeriodStart, onOpen }: { row: OperationStreamerRow; selectedPeriodStart: string; onOpen: (row: OperationRow) => void }) {
  const actionRow = getOperationRowAction(row);
  return (
    <tr>
      <td><strong className="agent-period-creator-name">{row.displayName}</strong><small>{row.regionLabel}</small></td>
      <td><OperationPlatformList profiles={row.profiles} /></td>
      <td><OperationTypeList profiles={row.profiles} /></td>
      {row.periods.map((cell) => <PeriodRevenueCell key={cell.period.startIso} cell={cell} selected={cell.period.startIso === selectedPeriodStart} onOpen={onOpen} />)}
      <td><OperationMonthSummary entries={row.monthSummary} /></td>
      <td><OperationRowStatusBadge status={row.status} /></td>
      <td className="agent-period-note">{row.latestNote || '-'}</td>
      <td>{actionRow ? <button className="secondary-button compact-button" type="button" onClick={() => onOpen(actionRow)}>{row.status === 'missing' ? '填写' : '查看'}</button> : '-'}</td>
    </tr>
  );
}

function OperationMobileCard({ row, selectedPeriodStart, onOpen }: { row: OperationStreamerRow; selectedPeriodStart: string; onOpen: (row: OperationRow) => void }) {
  const actionRow = getOperationRowAction(row);
  return (
    <article className="agent-operation-mobile-card agent-period-mobile-card">
      <div className="agent-operation-mobile-head">
        <div><strong>{row.displayName}</strong><span>{row.regionLabel}</span></div>
        <OperationStatusBadge status={row.status} />
      </div>
      <div className="agent-period-mobile-meta">
        <OperationPlatformList profiles={row.profiles} />
        <OperationTypeList profiles={row.profiles} />
      </div>
      <div className="agent-period-mobile-periods">
        {row.periods.map((cell) => (
          <section key={cell.period.startIso} className={`agent-period-mobile-period agent-period-mobile-period--${cell.status} ${cell.period.startIso === selectedPeriodStart ? 'agent-period-mobile-period--selected' : ''}`}>
            <span>{formatOperationPeriodHeader(cell.period, row.periods.map((period) => period.period))}</span>
            <div>{cell.profiles.map((profile) => <PeriodRevenueEntry key={`${profile.creator.id}-${profile.period.startIso}`} item={profile} onOpen={onOpen} />)}</div>
          </section>
        ))}
      </div>
      <div className="agent-period-mobile-summary">
        <span>本月情况</span>
        <OperationMonthSummary entries={row.monthSummary} />
      </div>
      <p>备注：{row.latestNote || '-'}</p>
      {actionRow ? <button className="secondary-button compact-button" type="button" onClick={() => onOpen(actionRow)}>{row.status === 'missing' ? '填写' : '查看'}</button> : null}
    </article>
  );
}

function PeriodRevenueCell({ cell, selected, onOpen }: { cell: OperationPeriodCell; selected: boolean; onOpen: (row: OperationRow) => void }) {
  return (
    <td className={`agent-period-cell agent-period-cell--${cell.status} ${selected ? 'agent-period-cell--selected' : ''}`}>
      <div className="agent-period-cell-stack">
        {cell.profiles.map((item) => <PeriodRevenueEntry key={`${item.creator.id}-${item.period.startIso}`} item={item} onOpen={onOpen} />)}
      </div>
    </td>
  );
}

function PeriodRevenueEntry({ item, onOpen }: { item: OperationCellProfile; onOpen: (row: OperationRow) => void }) {
  const content = (
    <>
      <span>{platformLabels[item.creator.platform]}</span>
      <strong className="agent-period-revenue-amount"><b>{item.record ? formatRevenueAmount(item.record.revenue_amount) : '-'}</b>{item.record ? <em>{getRecordRevenueUnitLabel(item.record)}</em> : null}</strong>
      <small>{getOperationCellStatusLabel(item.status)}</small>
      {item.status === 'future' ? <em>{formatFutureStartHint(item.period.startIso)}</em> : null}
    </>
  );
  if (item.status === 'future') return <div className={`agent-period-entry agent-period-entry--future agent-period-entry--${item.creator.platform}`}>{content}</div>;
  return (
    <button
      className={`agent-period-entry agent-period-entry--${item.status} agent-period-entry--${item.creator.platform}`}
      type="button"
      onClick={() => onOpen({ creator: item.creator, record: item.record, status: item.status === 'filled' ? 'filled' : 'missing', period: item.period })}
    >
      {content}
    </button>
  );
}

function OperationPlatformList({ profiles }: { profiles: CreatorProfile[] }) {
  return <div className="agent-period-platform-list">{profiles.map((creator) => <PlatformPill key={creator.id} platform={creator.platform} />)}</div>;
}

function OperationTypeList({ profiles }: { profiles: CreatorProfile[] }) {
  return <div className="agent-period-type-list">{profiles.map((creator) => <CreatorTypeBadge key={creator.id} type={creator.creator_type} />)}</div>;
}

function OperationMonthSummary({ entries }: { entries: OperationMonthSummaryEntry[] }) {
  const filledEntries = entries.filter((entry) => entry.hasRecord);
  if (filledEntries.length === 0) return <span className="agent-period-empty">-</span>;
  return (
    <div className="agent-period-month-summary">
      {filledEntries.map((entry) => (
        <span key={entry.platform} className={`agent-period-month-summary-line agent-period-month-summary-line--${entry.platform}`}>
          {filledEntries.length > 1 ? <em>{platformLabels[entry.platform]}</em> : null}
          <b>{formatRevenueAmount(entry.total)}</b>
          <small>{getCreatorRevenueUnitLabel(entry.platform)}</small>
        </span>
      ))}
    </div>
  );
}

function OperationPagination({ page, pageCount, pageSize, total, onPage, onPageSize }: { page: number; pageCount: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (pageSize: number) => void }) {
  return (
    <div className="agent-period-pagination">
      <span>共 {total} 位主播</span>
      <label>
        每页
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
          <option value={10}>10</option>
          <option value={20}>20</option>
        </select>
      </label>
      <div>
        <button className="secondary-button compact-button" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
        <span>{page} / {pageCount}</span>
        <button className="secondary-button compact-button" type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>下一页</button>
      </div>
    </div>
  );
}

function WeeklyRevenueModal({ row, onClose, onSubmitted }: { row: OperationRow; onClose: () => void; onSubmitted: (record: WeeklyRevenueRecord) => void }) {
  const [amount, setAmount] = useState(row.record && row.status !== 'missing' ? formatAmountInput(row.record.revenue_amount) : '');
  const [agentNote, setAgentNote] = useState(row.record?.agent_note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const readOnly = row.status === 'filled';
  const unitLabel = getCreatorRevenueUnitLabel(row.creator.platform);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    const parsedAmount = parseWeeklyAmount(amount);
    if (parsedAmount.error) {
      setError(parsedAmount.error);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const record = await agentService.submitWeeklyRevenue({
        recordId: row.record?.id,
        creatorProfileId: row.creator.id,
        weekStartDate: row.period.startIso,
        weekEndDate: row.period.endIso,
        revenueAmount: parsedAmount.value,
        agentNote,
      });
      onSubmitted(record);
    } catch (saveError) {
      setError(`提交失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SystemModal
      title={readOnly ? '查看周期流水' : '填写周期流水'}
      ariaLabel="周期流水"
      onClose={onClose}
      footer={<><button className="secondary-button compact-button" type="button" onClick={onClose}>关闭</button>{readOnly ? null : <button className="primary-button compact-button" type="submit" form="weekly-operation-form" disabled={saving}>保存</button>}</>}
    >
      <form id="weekly-operation-form" className="weekly-operation-form" onSubmit={submit}>
        <div className="agent-operation-modal-head">
          <PlatformPill platform={row.creator.platform} />
          <OperationStatusBadge status={row.status} />
        </div>
        <div className="agent-operation-detail-grid">
          <DrawerField label="主播" value={row.creator.creator_name || '-'} />
          <DrawerField label="平台" value={platformLabels[row.creator.platform]} />
          <DrawerField label="UID" value={row.creator.platform_user_id} />
          <DrawerField label="平台账号" value={row.creator.platform_account || '-'} />
          <DrawerField label="周期" value={row.period.label} />
          <DrawerField label="单位" value={unitLabel} />
        </div>
        <label className="form-field agent-weekly-revenue-field">
          <span>流水</span>
          <div className="agent-weekly-revenue-input-row">
            <input inputMode="decimal" min="0" readOnly={readOnly} type="number" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="尚未填写" />
            <b>{unitLabel}</b>
          </div>
        </label>
        <label className="form-field agent-weekly-revenue-note">
          <span>备注</span>
          <textarea readOnly={readOnly} value={agentNote} onChange={(event) => setAgentNote(event.target.value)} placeholder="选填" />
        </label>
        {error ? <p className="form-alert agent-operation-alert">{error}</p> : null}
      </form>
    </SystemModal>
  );
}

function PlatformPill({ platform }: { platform: CreatorPlatform }) {
  return (
    <span className="agent-operation-platform-pill">
      <img src={platform === 'tiktok' ? tiktokLogoUrl : douyinLogoUrl} alt="" aria-hidden="true" />
      <span>{platformLabels[platform]}</span>
    </span>
  );
}

function OperationStatusBadge({ status }: { status: OperationCellStatus }) {
  const labels: Record<OperationCellStatus, string> = { missing: '未填写', filled: '已填写', future: '未开始' };
  return <span className={`agent-weekly-status-badge agent-weekly-status-badge--${status}`}>{labels[status]}</span>;
}

function OperationRowStatusBadge({ status }: { status: OperationStatus }) {
  const labels: Record<OperationStatus, string> = { missing: '未完成', filled: '已完成' };
  return <span className={`agent-weekly-status-badge agent-weekly-status-badge--${status}`}>{labels[status]}</span>;
}


function TextField({ label, value, onChange, type = 'text', required, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return <label className="form-field"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} placeholder={placeholder} /></label>;
}

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="form-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

function groupCreatorProfiles(creators: CreatorProfile[]): CreatorProfileGroup[] {
  const groups = new Map<string, CreatorProfile[]>();
  creators.forEach((creator) => {
    const key = creator.creator_entity_id ? `entity:${creator.creator_entity_id}` : `profile:${creator.id}`;
    groups.set(key, [...(groups.get(key) ?? []), creator]);
  });

  return Array.from(groups.entries()).map(([id, profiles]) => {
    const sortedProfiles = sortCreatorProfiles(profiles);
    const completeness = getCreatorCompleteness(sortedProfiles);
    return {
      id,
      displayName: getConsistentValue(sortedProfiles, (creator) => creator.creator_name),
      profiles: sortedProfiles,
      platforms: new Set(sortedProfiles.map((creator) => creator.platform)),
      regionName: getConsistentValue(sortedProfiles, (creator) => creator.region?.code ?? creator.region?.name ?? ''),
      scoutName: getConsistentValue(sortedProfiles, (creator) => getEmployeeName(creator.scout)),
      managerName: getConsistentValue(sortedProfiles, (creator) => getEmployeeName(creator.manager)),
      status: getCreatorGroupStatus(sortedProfiles),
      completeness,
    };
  });
}

function filterCreatorGroups(groups: CreatorProfileGroup[], filters: { search: string; platform: string; creatorType: string; status: string; completeness: string }) {
  const normalizedSearch = filters.search.trim().toLowerCase();
  return groups.filter((group) => {
    if (normalizedSearch) {
      const searchable = [
        group.displayName,
        ...group.profiles.flatMap((creator) => [creator.creator_name, creator.platform_user_id, creator.platform_account]),
      ].join(' ').toLowerCase();
      if (!searchable.includes(normalizedSearch)) return false;
    }

    if (filters.platform === 'dual_platform') {
      if (!(group.platforms.has('tiktok') && group.platforms.has('douyin'))) return false;
    } else if (filters.platform && !group.platforms.has(filters.platform as CreatorPlatform)) {
      return false;
    }

    if (filters.creatorType === '5+1' && !group.profiles.some((creator) => creator.creator_type === '5+1')) return false;
    if (filters.creatorType === 'non_5_1' && !group.profiles.some((creator) => creator.creator_type !== '5+1')) return false;
    if (filters.status && group.status !== filters.status) return false;
    if (filters.completeness && group.completeness !== filters.completeness) return false;
    return true;
  });
}

function summarizeCreatorGroups(groups: CreatorProfileGroup[]): CreatorGroupSummary {
  return groups.reduce<CreatorGroupSummary>((summary, group) => {
    summary.total += 1;
    if (group.platforms.has('tiktok')) summary.tiktok += 1;
    if (group.platforms.has('douyin')) summary.douyin += 1;
    if (group.platforms.has('tiktok') && group.platforms.has('douyin')) summary.dualPlatform += 1;
    if (group.completeness !== 'complete') summary.incomplete += 1;
    return summary;
  }, { total: 0, tiktok: 0, douyin: 0, dualPlatform: 0, incomplete: 0 });
}

function getCreatorCompleteness(profiles: CreatorProfile[]): CreatorCompleteness {
  const hasCriticalMissing = profiles.some((creator) =>
    !creator.creator_name
    || !creator.region_id
    || !creator.manager_employee_id
    || !creator.scout_employee_id
    || !creator.platform
    || !creator.platform_user_id
    || !creator.platform_account
    || !creator.joined_date
    || !creator.creator_type,
  );
  if (hasCriticalMissing) return 'critical';

  const hasMissingBank = profiles.some((creator) =>
    (creator.creator_type === '5+1' || creator.creator_type === 'company')
    && (!creator.bank_name || !creator.bank_account),
  );
  return hasMissingBank ? 'missing' : 'complete';
}

function sortCreatorProfiles(creators: CreatorProfile[]) {
  const platformOrder: Record<CreatorPlatform, number> = { tiktok: 0, douyin: 1 };
  return [...creators].sort((first, second) => platformOrder[first.platform] - platformOrder[second.platform]);
}

function getCreatorGroupStatus(creators: CreatorProfile[]): CreatorGroupStatus {
  const statuses = new Set(creators.map((creator) => creator.status ?? 'active'));
  return statuses.size === 1 ? ([...statuses][0] as CreatorGroupStatus) : 'mixed';
}

function getCreatorStatusLabel(status: CreatorGroupStatus) {
  if (status === 'invalid') return '无效';
  if (status === 'mixed') return '状态不同';
  return '在职';
}

function getCompletenessLabel(completeness: CreatorCompleteness) {
  if (completeness === 'complete') return '完整';
  if (completeness === 'critical') return '重要资料缺失';
  return '待补资料';
}

function getConsistentValue(creators: CreatorProfile[], getValue: (creator: CreatorProfile) => string) {
  const values = Array.from(new Set(creators.map((creator) => getValue(creator).trim()).filter(Boolean)));
  if (values.length === 0) return '-';
  if (values.length > 1) return '资料不同';
  return values[0];
}

function getOptionalCreatorField(creator: CreatorProfile, field: string) {
  const value = (creator as unknown as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

function filterAdjustmentReviews(requests: AdjustmentReviewRequest[], filters: { status: string; platform: string; requestType: string; search: string }) {
  const normalizedSearch = filters.search.trim().toLowerCase();
  return requests.filter((request) => {
    if (filters.status && request.status !== filters.status) return false;
    if (filters.platform && request.platform !== filters.platform) return false;
    if (filters.requestType && request.request_type !== filters.requestType) return false;
    if (!normalizedSearch) return true;

    return [
      getAdjustmentCreatorName(request),
      request.platform_user_id ?? '',
      request.creator?.platform_account ?? '',
      request.target_nickname ?? '',
      request.target_email ?? '',
      getAdjustmentRequesterName(request),
    ].join(' ').toLowerCase().includes(normalizedSearch);
  });
}

function summarizeAdjustmentReviews(requests: AdjustmentReviewRequest[]) {
  return requests.reduce(
    (summary, request) => {
      summary[request.status] += 1;
      if (String(request.created_at).startsWith(currentMonth)) summary.currentMonth += 1;
      return summary;
    },
    { pending: 0, approved: 0, rejected: 0, currentMonth: 0 },
  );
}

function getAdjustmentCreatorName(request: AdjustmentReviewRequest) {
  return request.creator?.creator_name || request.platform_user_id || '-';
}

function getAdjustmentRequesterName(request: AdjustmentReviewRequest) {
  return request.requester?.nickname || request.requester?.full_name || request.requester?.email || '-';
}

function formatAdjustmentTarget(request: AdjustmentReviewRequest) {
  if (request.request_type === 'change_manager') return request.target_nickname || request.target_email || '转经纪人';
  if (request.request_type === 'change_scout') return request.target_nickname || request.target_email || '转星探';
  if (request.request_type === 'change_bank') return [request.bank_name, request.bank_account].filter(Boolean).join(' / ') || '更换银行户口';
  if (request.request_type === 'to_online') return '转线上';
  if (request.request_type === 'to_company') return '转公司提';
  if (request.request_type === 'to_5_1') return '转5+1';
  return request.content || '特殊申请';
}

function formatAdjustmentTargetEmployee(employee: AdjustmentTargetEmployee) {
  const code = employee.employee_code ? `（${employee.employee_code}）` : '';
  if (employee.nickname && employee.nickname !== employee.full_name) return `${employee.nickname} · ${employee.full_name}${code}`;
  return `${employee.full_name}${code}`;
}

function requiresTargetEmail(requestType: AdjustmentType) {
  return requestType === 'change_manager' || requestType === 'change_scout';
}

function getMissingTargetEmailMessage(requestType: AdjustmentType, targetEmail: string | null | undefined) {
  if (!requiresTargetEmail(requestType) || targetEmail?.trim()) return '';
  return requestType === 'change_manager' ? '目标经纪人 Email 缺失，请填写后再提交。' : '目标星探 Email 缺失，请填写后再提交。';
}

function getMissingTargetEmailReviewMessage(request: AdjustmentReviewRequest) {
  if (!requiresTargetEmail(request.request_type) || request.target_email?.trim()) return '';
  return request.request_type === 'change_manager' ? '目标经纪人 Email 缺失，请申请人重新提交。' : '目标星探 Email 缺失，请申请人重新提交。';
}

function getRevenuePeriodForDate(date: Date): RevenuePeriodRange {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const day = target.getDate();
  const startDay = day >= 29 ? 29 : Math.floor((day - 1) / 7) * 7 + 1;
  return createRevenuePeriod(target.getFullYear(), target.getMonth(), startDay);
}

function getRevenuePeriodOptions(month: string): RevenuePeriodRange[] {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return [];
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return [1, 8, 15, 22, 29].filter((startDay) => startDay <= lastDay).map((startDay) => createRevenuePeriod(year, monthIndex, startDay));
}

function getDefaultPeriodStartForMonth(month: string, currentPeriodStartIso: string) {
  const options = getRevenuePeriodOptions(month);
  return options.find((period) => period.startIso === currentPeriodStartIso)?.startIso ?? options[0]?.startIso ?? '';
}

function getMonthDateRange(month: string) {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return { startIso: '', endIso: '' };
  return {
    startIso: formatLocalDate(new Date(year, monthIndex, 1)),
    endIso: formatLocalDate(new Date(year, monthIndex + 1, 0)),
  };
}

function getOperationEffectiveDateRange(quickRange: OperationQuickRange, input: {
  monthDateRange: { startIso: string; endIso: string };
  previousPeriod: RevenuePeriodRange;
  customStart: string;
  customEnd: string;
  todayIso: string;
}): OperationDateRange {
  if (quickRange === 'previous') return { startIso: input.previousPeriod.startIso, endIso: input.previousPeriod.endIso };
  if (quickRange === 'last30') {
    const endDate = parseIsoDate(input.todayIso);
    const startDate = parseIsoDate(input.todayIso);
    startDate.setDate(startDate.getDate() - 29);
    return { startIso: formatLocalDate(startDate), endIso: formatLocalDate(endDate) };
  }
  if (quickRange === 'year') {
    const year = parseIsoDate(input.todayIso).getFullYear();
    return { startIso: `${year}-01-01`, endIso: `${year}-12-31` };
  }
  if (quickRange === 'custom') return normalizeOperationDateRange(input.customStart, input.customEnd, input.monthDateRange);
  return input.monthDateRange;
}

function normalizeOperationDateRange(startIso: string, endIso: string, fallback: OperationDateRange): OperationDateRange {
  if (!isValidIsoDate(startIso) || !isValidIsoDate(endIso)) return fallback;
  return startIso <= endIso ? { startIso, endIso } : { startIso: endIso, endIso: startIso };
}

function getRevenuePeriodsForDateRange(range: OperationDateRange): RevenuePeriodRange[] {
  if (!isValidIsoDate(range.startIso) || !isValidIsoDate(range.endIso)) return [];
  const normalizedRange = normalizeOperationDateRange(range.startIso, range.endIso, range);
  const periods = new Map<string, RevenuePeriodRange>();
  const cursor = parseIsoDate(normalizedRange.startIso);
  cursor.setDate(1);
  const end = parseIsoDate(normalizedRange.endIso);
  end.setDate(1);

  while (cursor <= end) {
    const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    getRevenuePeriodOptions(month)
      .filter((period) => doDateRangesOverlap(period.startIso, period.endIso, normalizedRange.startIso, normalizedRange.endIso))
      .forEach((period) => periods.set(period.startIso, period));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return Array.from(periods.values()).sort((first, second) => first.startIso.localeCompare(second.startIso));
}

function doDateRangesOverlap(firstStart: string, firstEnd: string, secondStart: string, secondEnd: string) {
  return firstStart <= secondEnd && firstEnd >= secondStart;
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseIsoDate(value);
  return !Number.isNaN(date.getTime()) && formatLocalDate(date) === value;
}

function getPreviousRevenuePeriod(periodStartIso: string): RevenuePeriodRange {
  const startDate = parseIsoDate(periodStartIso);
  startDate.setDate(startDate.getDate() - 1);
  return getRevenuePeriodForDate(startDate);
}

function createRevenuePeriod(year: number, monthIndex: number, startDay: number): RevenuePeriodRange {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const safeStartDay = Math.min(startDay, lastDay);
  const endDay = safeStartDay === 29 ? lastDay : Math.min(safeStartDay + 6, lastDay);
  const start = new Date(year, monthIndex, safeStartDay);
  const end = new Date(year, monthIndex, endDay);
  return {
    startIso: formatLocalDate(start),
    endIso: formatLocalDate(end),
    label: `${formatDateForPeriod(start)} - ${formatDateForPeriod(end)}`,
    shortLabel: safeStartDay === endDay ? String(safeStartDay).padStart(2, '0') : `${String(safeStartDay).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
  };
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatAmountInput(value: number) {
  return Number.isInteger(value) ? String(value) : String(value);
}

function parseWeeklyAmount(value: string): { value: number; error: '' } | { value: 0; error: string } {
  const trimmedValue = value.trim();
  if (!trimmedValue) return { value: 0, error: '流水必须填写；如果确认没有流水，请填写 0。' };
  const parsedValue = Number(trimmedValue);
  if (!Number.isFinite(parsedValue)) return { value: 0, error: '流水必须是有效数字。' };
  if (parsedValue < 0) return { value: 0, error: '流水不能小于 0。' };
  return { value: parsedValue, error: '' };
}

function sortOperationCreators(creators: CreatorProfile[]) {
  const platformOrder: Record<CreatorPlatform, number> = { tiktok: 0, douyin: 1 };
  return [...creators].sort((first, second) => {
    if (first.creator_entity_id && first.creator_entity_id === second.creator_entity_id) {
      return platformOrder[first.platform] - platformOrder[second.platform];
    }
    const firstName = first.creator_name || first.platform_user_id || '';
    const secondName = second.creator_name || second.platform_user_id || '';
    const nameCompare = firstName.localeCompare(secondName, 'zh-Hans');
    if (nameCompare !== 0) return nameCompare;
    return platformOrder[first.platform] - platformOrder[second.platform];
  });
}

function getOperationStatus(record: WeeklyRevenueRecord | null): OperationStatus {
  return record ? 'filled' : 'missing';
}

function buildOperationStreamerRows(
  creators: CreatorProfile[],
  periods: RevenuePeriodRange[],
  recordsByPeriod: Record<string, Record<string, WeeklyRevenueRecord>>,
  filters: OperationFilters,
  todayIso: string,
): OperationStreamerRow[] {
  const groups = groupOperationProfiles(creators);
  const normalizedSearch = filters.search.trim().toLowerCase();
  return groups.flatMap((profiles) => {
    const hasTikTok = profiles.some((profile) => profile.platform === 'tiktok');
    const hasDouyin = profiles.some((profile) => profile.platform === 'douyin');
    if (filters.platform === 'dual_platform' && (!hasTikTok || !hasDouyin)) return [];

    let visibleProfiles = profiles;
    if (filters.platform && filters.platform !== 'dual_platform') {
      visibleProfiles = visibleProfiles.filter((profile) => profile.platform === filters.platform);
    }
    if (filters.creatorType === '5+1') {
      visibleProfiles = visibleProfiles.filter((profile) => profile.creator_type === '5+1');
    }
    if (filters.creatorType === 'non_5_1') {
      visibleProfiles = visibleProfiles.filter((profile) => profile.creator_type !== '5+1');
    }
    if (visibleProfiles.length === 0) return [];

    if (normalizedSearch && !matchesOperationSearch(visibleProfiles, normalizedSearch)) return [];

    const rowPeriods = periods.map((period) => {
      const isFuture = isRevenuePeriodFuture(period, todayIso);
      const cellProfiles = visibleProfiles.map((creator) => {
        const record = recordsByPeriod[period.startIso]?.[creator.id] ?? null;
        const status: OperationCellStatus = record ? 'filled' : isFuture ? 'future' : 'missing';
        return { creator, record, status, period };
      });
      return {
        period,
        profiles: cellProfiles,
        status: getOperationCellStatus(cellProfiles),
      };
    });
    const rowStatus: OperationStatus = rowPeriods.some((period) => period.profiles.some((profile) => profile.status === 'missing')) ? 'missing' : 'filled';
    return [{
      id: getOperationGroupKey(visibleProfiles[0]),
      displayName: getOperationDisplayName(visibleProfiles),
      regionLabel: getOperationRegionLabel(visibleProfiles),
      profiles: visibleProfiles,
      periods: rowPeriods,
      status: rowStatus,
      latestNote: getOperationLatestNote(rowPeriods),
      monthSummary: summarizeOperationMonth(rowPeriods),
    }];
  });
}

function groupOperationProfiles(creators: CreatorProfile[]) {
  const groups = new Map<string, CreatorProfile[]>();
  creators.forEach((creator) => {
    const key = getOperationGroupKey(creator);
    groups.set(key, [...(groups.get(key) ?? []), creator]);
  });
  return Array.from(groups.values()).map(sortOperationCreators);
}

function getOperationGroupKey(creator: CreatorProfile) {
  return creator.creator_entity_id ? `entity:${creator.creator_entity_id}` : `profile:${creator.id}`;
}

function matchesOperationSearch(profiles: CreatorProfile[], normalizedSearch: string) {
  return profiles.some((profile) => [
    profile.creator_name,
    profile.platform_user_id,
    profile.platform_account,
    profile.region?.code,
    profile.region?.name,
  ].join(' ').toLowerCase().includes(normalizedSearch));
}

function isRevenuePeriodFuture(period: RevenuePeriodRange, todayIso: string) {
  return period.startIso > todayIso;
}

function getOperationCellStatus(profiles: OperationCellProfile[]): OperationCellStatus {
  if (profiles.every((profile) => profile.status === 'future')) return 'future';
  if (profiles.some((profile) => profile.status === 'missing')) return 'missing';
  return 'filled';
}

function getOperationCellStatusLabel(status: OperationCellStatus) {
  const labels: Record<OperationCellStatus, string> = { missing: '未填写', filled: '已填写', future: '未开始' };
  return labels[status];
}

function formatFutureStartHint(startIso: string) {
  return `${parseIsoDate(startIso).getDate()}号开始可填写`;
}

function getOperationDisplayName(profiles: CreatorProfile[]) {
  return profiles.find((profile) => profile.creator_name)?.creator_name || profiles[0]?.platform_user_id || '-';
}

function getOperationRegionLabel(profiles: CreatorProfile[]) {
  const labels = uniqueValues(profiles.map((profile) => profile.region?.code ?? profile.region?.name ?? '').filter(Boolean));
  return labels.length > 0 ? labels.join(' / ') : '-';
}

function getOperationLatestNote(periods: OperationPeriodCell[]) {
  const records = periods.flatMap((period) => period.profiles.map((profile) => profile.record).filter((record): record is WeeklyRevenueRecord => Boolean(record?.agent_note)));
  const latestRecord = records.sort((first, second) => getOperationRecordTime(second) - getOperationRecordTime(first))[0];
  return latestRecord?.agent_note ?? '';
}

function getOperationRecordTime(record: WeeklyRevenueRecord) {
  return new Date(record.submitted_at ?? record.created_at).getTime();
}

function summarizeOperationMonth(periods: OperationPeriodCell[]): OperationMonthSummaryEntry[] {
  const summary: Record<CreatorPlatform, OperationMonthSummaryEntry> = {
    tiktok: { platform: 'tiktok', total: 0, hasRecord: false },
    douyin: { platform: 'douyin', total: 0, hasRecord: false },
  };
  periods.forEach((period) => {
    period.profiles.forEach((profile) => {
      if (!profile.record) return;
      summary[profile.creator.platform].total += profile.record.revenue_amount;
      summary[profile.creator.platform].hasRecord = true;
    });
  });
  return [summary.tiktok, summary.douyin];
}

function summarizeOperationStreamerRows(rows: OperationStreamerRow[]) {
  return rows.reduce(
    (summary, row) => {
      summary.rows += 1;
      row.periods.forEach((period) => {
        period.profiles.forEach((profile) => {
          if (profile.status === 'future') return;
          if (profile.status === 'filled') {
            summary.filled += 1;
            if (profile.record) {
              if (profile.creator.platform === 'tiktok') summary.tiktokTotal += profile.record.revenue_amount;
              if (profile.creator.platform === 'douyin') summary.douyinTotal += profile.record.revenue_amount;
            }
            return;
          }
          summary.missing += 1;
        });
      });
      return summary;
    },
    { rows: 0, missing: 0, filled: 0, tiktokTotal: 0, douyinTotal: 0 },
  );
}

function filterOperationStreamerRows(rows: OperationStreamerRow[], filters: OperationFilters) {
  if (!filters.status) return rows;
  return rows.filter((row) => row.status === filters.status);
}


function sortOperationStreamerRows(first: OperationStreamerRow, second: OperationStreamerRow) {
  const statusOrder: Record<OperationStatus, number> = { missing: 0, filled: 1 };
  if (statusOrder[first.status] !== statusOrder[second.status]) return statusOrder[first.status] - statusOrder[second.status];
  return first.displayName.localeCompare(second.displayName, 'zh-Hans');
}


function getOperationRowAction(row: OperationStreamerRow): OperationRow | null {
  const missingProfile = row.periods.flatMap((period) => period.profiles).find((profile) => profile.status === 'missing');
  if (missingProfile) return { creator: missingProfile.creator, record: null, status: 'missing', period: missingProfile.period };
  const filledProfile = row.periods.flatMap((period) => period.profiles).find((profile) => profile.status === 'filled');
  if (filledProfile) return { creator: filledProfile.creator, record: filledProfile.record, status: 'filled', period: filledProfile.period };
  return null;
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values));
}


function getCreatorRevenueUnitLabel(platform: CreatorPlatform) {
  return platform === 'tiktok' ? '钻石' : '音浪';
}

function getRecordRevenueUnitLabel(record: WeeklyRevenueRecord) {
  return record.revenue_unit === 'diamond' ? '钻石' : '音浪';
}

function formatRevenueWithUnit(record: WeeklyRevenueRecord) {
  return `${formatRevenueAmount(record.revenue_amount)} ${getRecordRevenueUnitLabel(record)}`;
}

function getWeekLabel(startDate: string, endDate: string) {
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

function formatDate(value: string) {
  return value ? new Date(value).toLocaleDateString('zh-MY') : '-';
}

function formatDateForPeriod(date: Date) {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateRangeText(startIso: string, endIso: string) {
  return `${formatDateForPeriod(parseIsoDate(startIso))} ~ ${formatDateForPeriod(parseIsoDate(endIso))}`;
}

function formatOperationPeriodHeader(period: RevenuePeriodRange, periods: RevenuePeriodRange[]) {
  const monthCount = new Set(periods.map((item) => item.startIso.slice(0, 7))).size;
  if (monthCount <= 1) return period.shortLabel;
  const date = parseIsoDate(period.startIso);
  return `${String(date.getMonth() + 1).padStart(2, '0')}月 ${period.shortLabel}`;
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-MY') : '-';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return '未知错误';
}

