import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Plus, RefreshCw, Send, X } from 'lucide-react';
import { MonthSelect } from '../components/MonthSelect';
import { SystemModal } from '../components/SystemModal';
import { useAuth } from '../hooks/useAuth';
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
  type AdjustmentType,
  type AgentOptions,
  type DesignFormValues,
  type DesignRequest,
  type DesignRequestType,
  type RevenueRecord,
} from '../services/agent.service';
import type { CreatorPlatform, CreatorProfile } from '../services/scout.service';

export type AgentPageMode = 'revenue' | 'creators' | 'adjustments' | 'design-requests' | 'management-revenue';

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
  const [revenues, setRevenues] = useState<RevenueRecord[]>([]);
  const [creators, setCreators] = useState<CreatorProfile[]>([]);
  const [selectedCreatorGroup, setSelectedCreatorGroup] = useState<CreatorProfileGroup | null>(null);
  const [adjustments, setAdjustments] = useState<AdjustmentRequest[]>([]);
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
      {mode === 'design-requests' ? <AgentDesignPanel loading={loading} unclaimed={unclaimedDesigns} inProgress={inProgressDesigns} requests={designRequests} onStatus={updateDesignStatus} /> : null}

      {selectedCreatorGroup ? (
        <CreatorDetailDrawer
          group={selectedCreatorGroup}
          onClose={() => setSelectedCreatorGroup(null)}
          onAdjustment={(creatorProfile) => openAdjustmentForCreator(selectedCreatorGroup, creatorProfile)}
        />
      ) : null}

      {adjustmentModalOpen ? <AdjustmentModal values={adjustmentForm} saving={saving} onChange={setAdjustmentForm} onClose={() => setAdjustmentModalOpen(false)} onSubmit={submitAdjustment} /> : null}
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

function AgentDesignPanel({ loading, unclaimed, inProgress, requests, onStatus }: { loading: boolean; unclaimed: number; inProgress: number; requests: DesignRequest[]; onStatus: (request: DesignRequest, status: 'confirming' | 'revision' | 'ok' | 'cancelled') => void }) {
  return <div className="staff-list-panel"><div className="agent-count-strip"><span>未接单 <b>{unclaimed}</b></span><span>制作中 <b>{inProgress}</b></span></div>{loading ? <div className="table-state">正在读取美工申请...</div> : <div className="staff-table-wrap"><table className="staff-table agent-table"><thead><tr><th>类型</th><th>主播</th><th>状态</th><th>美工</th><th>申请内容</th><th>操作</th></tr></thead><tbody>{requests.map((item) => <tr key={item.id}><td>{designTypeLabels[item.request_type]}</td><td>{item.creator_name || item.platform_user_id || '-'}</td><td>{designStatusLabels[item.status]}</td><td>{getEmployeeName(item.designer) || '-'}</td><td>{item.design_content || item.special_content || '-'}</td><td><div className="row-actions"><button className="icon-button" type="button" onClick={() => onStatus(item, 'confirming')} aria-label="跟主播确认中"><Send size={16} /></button><button className="icon-button" type="button" onClick={() => onStatus(item, 'revision')} aria-label="调整申请"><RefreshCw size={16} /></button><button className="icon-button accept-button" type="button" onClick={() => onStatus(item, 'ok')} aria-label="OK"><Check size={16} /></button><button className="icon-button reject-button" type="button" onClick={() => onStatus(item, 'cancelled')} aria-label="取消"><X size={16} /></button></div></td></tr>)}</tbody></table></div>}</div>;
}

function AdjustmentModal({ values, saving, onChange, onClose, onSubmit }: { values: AdjustmentFormValues; saving: boolean; onChange: (values: AdjustmentFormValues) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const needsEffective = ['to_online', 'to_company', 'to_5_1', 'change_bank'].includes(values.request_type);
  const needsBank = ['to_company', 'to_5_1', 'change_bank'].includes(values.request_type);
  const needsTarget = values.request_type === 'change_manager' || values.request_type === 'change_scout';
  return <SystemModal title="添加新申请" ariaLabel="主播资料调整申请" onClose={onClose} footer={<><button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button><button className="primary-button compact-button" type="submit" form="adjustment-form" disabled={saving}>提交</button></>}><form id="adjustment-form" onSubmit={onSubmit}><div className="form-grid"><SelectField label="平台" value={values.platform} onChange={(value) => onChange({ ...values, platform: value as CreatorPlatform })}><option value="tiktok">TikTok</option><option value="douyin">抖音</option></SelectField><SelectField label="可申请项目" value={values.request_type} onChange={(value) => onChange({ ...values, request_type: value as AdjustmentType })}>{adjustmentTypes.map((type) => <option key={type} value={type}>{adjustmentTypeLabels[type]}</option>)}</SelectField>{values.request_type !== 'special' ? <TextField label={values.platform === 'tiktok' ? 'TikTok ID' : '抖音 UID'} value={values.platform_user_id} onChange={(value) => onChange({ ...values, platform_user_id: value })} required /> : null}{needsEffective ? <TextField label="生效日期" type="date" value={values.effective_date} onChange={(value) => onChange({ ...values, effective_date: value })} /> : null}{needsBank ? <><TextField label="全名" value={values.full_name} onChange={(value) => onChange({ ...values, full_name: value })} /><TextField label="银行" value={values.bank_name} onChange={(value) => onChange({ ...values, bank_name: value })} /><TextField label="银行户口" value={values.bank_account} onChange={(value) => onChange({ ...values, bank_account: value })} /></> : null}{needsTarget ? <><TextField label={values.request_type === 'change_manager' ? '经纪人昵称' : '星探昵称'} value={values.target_nickname} onChange={(value) => onChange({ ...values, target_nickname: value })} /><TextField label={values.request_type === 'change_manager' ? '经纪人后台 Email' : '星探后台 Email'} value={values.target_email} onChange={(value) => onChange({ ...values, target_email: value })} /></> : null}<label className="form-field form-field-wide"><span>特殊申请 / 备注</span><textarea value={values.content} onChange={(event) => onChange({ ...values, content: event.target.value })} /></label></div></form></SystemModal>;
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

