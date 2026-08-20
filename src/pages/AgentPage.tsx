import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
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
      if (!regionId && nextOptions.currentEmployee?.region_id && mode === 'creators') setRegionId(nextOptions.currentEmployee.region_id);

      if (mode === 'revenue' || mode === 'management-revenue') {
        setRevenues(await agentService.listRevenueData({ profileId: profile?.id, month, platform, regionId: defaultRegion, management: isManagement }));
      }
      if (mode === 'creators' && profile?.id) {
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
        <button className="secondary-action" type="button" onClick={loadData} disabled={loading}><RefreshCw size={17} /><span>刷新</span></button>
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

function TextField({ label, value, onChange, type = 'text', required }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return <label className="form-field"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>;
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

function formatDate(value: string) {
  return value ? new Date(value).toLocaleDateString('zh-MY') : '-';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return '未知错误';
}

