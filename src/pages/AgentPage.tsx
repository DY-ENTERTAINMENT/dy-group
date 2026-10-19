import { useEffect, useLayoutEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, CalendarCheck, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Eye, FileWarning, Leaf, Layers3, Plus, RefreshCw, Search, Send, Settings, Trash2, UserRound, X } from 'lucide-react';
import { useRef } from 'react';
import { revenueCycleService, type RevenueMonthContext, type MonthlyRevenueRecord } from '../services/revenue-cycle.service';
import { rosterCycle, canWriteMonthly, isVerifiedMonthly, malaysiaMonth } from '../services/revenue-cycle-display';
import { MonthlyRevenueBaseline } from '../components/MonthlyRevenueBaseline';
import { MonthSelect } from '../components/MonthSelect';
import { SystemModal } from '../components/SystemModal';
import { AgentDesignerRequests } from '../components/DesignerRequestWorkflow';
import { useAuth } from '../hooks/useAuth';
import { usePermissions } from '../hooks/usePermissions';
import { profileService } from '../services/profile.service';
import tiktokLogoUrl from '../assets/icons/tiktok-logo.png';
import douyinLogoUrl from '../assets/icons/douyin-logo.png';
import {
  adjustmentStatusLabels,
  adjustmentTypeLabels,
  agentService,
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
  type AgentPlatformRevenueKpiSummary,
  type AgentOfflineRevenueKpiSummary,
  type DesignFormValues,
  type DesignRequest,
  type DesignRequestType,
  type ManagementRevenueManagerOption,
  type ManagementRevenueRecord,
  type PersonalManagerCreatorProfile,
  type RevenueRepresentativeOption,
  type RevenuePeriodSetting,
  type RevenuePeriodSettingSaveInput,
  type WeeklyRevenueRecord,
} from '../services/agent.service';
import { getEligibleManagementAgents } from '../services/management-agent-ranking-eligibility';
import type { CreatorPlatform, CreatorProfile } from '../services/scout.service';
import { creatorCalendarMilestoneLabels, getCreatorMilestones, type CreatorCalendarMilestoneType } from '../utils/creator-calendar';
import { createUuidV4 } from '../utils/uuid';
import { creatorActivityService, creatorActivityTypeLabels, type CreatorActivityForm } from '../services/creator-activity.service';
import type { CreatorActivity, CreatorActivityType } from '../types/database';

export type AgentPageMode = 'revenue' | 'creators' | 'adjustments' | 'design-requests' | 'management-revenue' | 'management-adjustments';

const currentMonth = getMalaysiaDate(new Date()).slice(0, 7);
const today = new Date().toISOString().slice(0, 10);

function getMalaysiaDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function formatMonthLabel(month: string) {
  const [year, monthNumber] = month.split('-');
  return `${year}年${Number(monthNumber)}月`;
}

function parseCreatorEntityKey(value: string) {
  const match = /^entity:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(value);
  if (!match) throw new Error('请选择有效的主播。');
  return match[1];
}

const emptyAdjustment: AdjustmentFormValues = {
  platform: 'tiktok',
  platform_user_id: '',
  request_type: 'to_online',
  effective_date: today,
  full_name: '',
  bank_account_name: '',
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
  const [regionId, setRegionId] = useState('');
  const [creatorSearch, setCreatorSearch] = useState('');
  const [creatorPlatform, setCreatorPlatform] = useState('');
  const [creatorType, setCreatorType] = useState('');
  const [creatorStatus, setCreatorStatus] = useState('');
  const [creatorCompleteness, setCreatorCompleteness] = useState('');
  const [creatorView, setCreatorView] = useState<'profiles' | 'calendar'>('profiles');
  const [calendarMonth, setCalendarMonth] = useState(currentMonth);
  const [calendarType, setCalendarType] = useState<'' | CreatorCalendarMilestoneType>('');
  const [calendarActivityType, setCalendarActivityType] = useState<'' | CreatorActivityType>('');
  const [calendarInfoOpen, setCalendarInfoOpen] = useState(false);
  const [calendarActivities, setCalendarActivities] = useState<CreatorActivity[]>([]);
  const [activityForm, setActivityForm] = useState<CreatorActivityForm>({ creator_entity_id: '', title: '', activity_date: today, activity_time: '', activity_type: 'guild_activity', agent_remark: '' });
  const [editingActivity, setEditingActivity] = useState<CreatorActivity | null>(null);
  const [selectedMilestone, setSelectedMilestone] = useState<CreatorCalendarEvent | null>(null);
  const [milestoneRemark, setMilestoneRemark] = useState('');
  const [reviewStatus, setReviewStatus] = useState('pending');
  const [reviewPlatform, setReviewPlatform] = useState('');
  const [reviewType, setReviewType] = useState('');
  const [reviewSearch, setReviewSearch] = useState('');
  const [creators, setCreators] = useState<PersonalManagerCreatorProfile[]>([]);
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

  const pendingAdjustments = adjustments.filter((item) => item.status === 'pending').length;
  const unclaimedDesigns = designRequests.filter((item) => item.status === 'unclaimed').length;
  const inProgressDesigns = designRequests.filter((item) => item.status === 'in_progress' || item.status === 'revision').length;
  const canReviewAdjustments = permissions.canUse('creator-adjustment-review');

  useLayoutEffect(() => {
    if (mode === 'revenue') setMonth(currentMonth);
  }, [mode]);

  useEffect(() => {
    void loadData();
  }, [mode, permissions.isSuperAdmin, profile?.id, month, regionId]);

  const dataSequence = useRef(0);
  useLayoutEffect(() => { dataSequence.current += 1; return () => { dataSequence.current += 1; }; }, [mode, permissions.isSuperAdmin, profile?.id, month, regionId]);
  async function loadData() {
    if (!profile?.id && !isManagement) return;
    const sequence = ++dataSequence.current; const current = () => sequence === dataSequence.current;
    setLoading(true);
    setError('');
    try {
      const nextOptions = await agentService.getOptions(profile?.id);
      if (!current()) return; setOptions(nextOptions);
      const useGlobalRevenueScope = mode === 'revenue' && permissions.isSuperAdmin;
      const defaultRegion = regionId || (useGlobalRevenueScope ? '' : nextOptions.currentEmployee?.region_id || '');
      if (!useGlobalRevenueScope && !regionId && nextOptions.currentEmployee?.region_id && (mode === 'revenue' || mode === 'creators')) setRegionId(nextOptions.currentEmployee.region_id);

      if (mode === 'revenue' && profile?.id) {
        { const result = await agentService.listPersonalManagerWeeklyRevenueProfiles({ regionId: defaultRegion }); if (current()) setCreators(result); }
      }
      if (mode === 'creators') {
        { const result = await agentService.listPersonalManagerCreatorProfiles({ regionId: defaultRegion }); if (current()) setCreators(result); }
        { const result = await creatorActivityService.listMine(calendarMonth); if (current()) setCalendarActivities(result); }
      }
      if (mode === 'adjustments' && profile?.id) {
        { const result = await agentService.listAdjustments(profile.id); if (current()) setAdjustments(result); }
      }
      if (mode === 'management-adjustments') {
        { const result = await agentService.listAdjustmentReviews(); if (current()) setAdjustmentReviews(result); }
      }
      if (mode === 'design-requests' && profile?.id) {
        { const result = await agentService.listDesignRequests({ profileId: profile.id, mode: 'agent' }); if (current()) setDesignRequests(result); }
      }
    } catch (loadError) {
      if (current()) setError(`读取经纪人资料失败：${getErrorMessage(loadError)}`);
    } finally {
      if (current()) setLoading(false);
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
  async function saveActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const creatorEntityId = parseCreatorEntityKey(activityForm.creator_entity_id);
      const values = { ...activityForm, creator_entity_id: creatorEntityId };
      if (editingActivity) await creatorActivityService.update(editingActivity.id, values); else await creatorActivityService.create(values);
      setCalendarInfoOpen(false); setEditingActivity(null); setActivityForm({ creator_entity_id: '', title: '', activity_date: today, activity_time: '', activity_type: 'guild_activity', agent_remark: '' }); setCalendarActivities(await creatorActivityService.listMine(calendarMonth));
    } catch (e) { setError(`保存活动失败：${getErrorMessage(e)}`); } finally { setSaving(false); }
  }
  async function saveMilestone() { if (!selectedMilestone) return; setSaving(true); try { await creatorActivityService.saveMilestoneNote(parseCreatorEntityKey(selectedMilestone.group.id), selectedMilestone.type, selectedMilestone.date, milestoneRemark); setSelectedMilestone(null); } catch (e) { setError(`保存节点备注失败：${getErrorMessage(e)}`); } finally { setSaving(false); } }
  async function openMilestone(event: CreatorCalendarEvent) { setError(''); try { const note = await creatorActivityService.getMilestoneNote(parseCreatorEntityKey(event.group.id), event.type, event.date); setMilestoneRemark(note?.agent_remark ?? ''); setSelectedMilestone(event); } catch (e) { setError(`读取节点备注失败：${getErrorMessage(e)}`); } }

  return (
    <section className="agent-page">
      <div className="toolbar-actions staff-actions-row">
        {mode === 'adjustments' ? (
          <button className="secondary-action" type="button" onClick={() => setAdjustmentModalOpen(true)}><Plus size={17} /><span>添加新申请</span></button>
        ) : null}
        {mode === 'revenue' || mode === 'management-revenue' || mode === 'creators' || mode === 'design-requests' ? null : <button className="secondary-action" type="button" onClick={loadData} disabled={loading}><RefreshCw size={17} /><span>刷新</span></button>}
      </div>

      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      {mode === 'revenue' ? (
        <AgentPeriodRevenuePanel loading={loading} month={month} regionId={regionId} options={options} creators={creators} onMonth={setMonth} onRegion={setRegionId} onRefresh={loadData} />
      ) : null}

      {mode === 'management-revenue' ? (
        <RevenuePanel loading={loading} options={options} />
      ) : null}

      {mode === 'creators' ? (
        <>
          <div className="agent-creator-view-bar">
            <div className="agent-creator-view-tabs" role="tablist" aria-label="主播数据视图">
              <button className={creatorView === 'profiles' ? 'active' : ''} type="button" role="tab" aria-selected={creatorView === 'profiles'} onClick={() => setCreatorView('profiles')}>主播资料</button>
              <button className={creatorView === 'calendar' ? 'active' : ''} type="button" role="tab" aria-selected={creatorView === 'calendar'} onClick={() => setCreatorView('calendar')}><CalendarDays size={16} />主播日历</button>
            </div>
            <button className="secondary-action agent-creator-refresh" type="button" onClick={loadData} disabled={loading}><RefreshCw size={17} /><span>刷新</span></button>
          </div>
          {creatorView === 'profiles' ? <CreatorDataPanel
          loading={loading}
          search={creatorSearch}
          platform={creatorPlatform}
          creatorType={creatorType}
          status={creatorStatus}
          completeness={creatorCompleteness}
          regionId={regionId}
          options={options}
          creators={creators}
          currentEmployeeId={options.currentEmployee?.id ?? null}
          onSearch={setCreatorSearch}
          onPlatform={setCreatorPlatform}
          onCreatorType={setCreatorType}
          onStatus={setCreatorStatus}
          onCompleteness={setCreatorCompleteness}
          onRegion={setRegionId}
          onReset={() => {
            setCreatorSearch('');
            setCreatorPlatform('');
            setCreatorType('');
            setCreatorStatus('');
            setCreatorCompleteness('');
            setRegionId('');
          }}
          onView={setSelectedCreatorGroup}
          onAdjustment={openAdjustmentForCreator}
          /> : <CreatorCalendarPanel
            loading={loading}
            creators={creators}
            currentEmployeeId={options.currentEmployee?.id ?? null}
            activities={calendarActivities}
            month={calendarMonth}
            type={calendarType}
            activityType={calendarActivityType}
            onMonth={setCalendarMonth}
            onType={setCalendarType}
            onActivityType={setCalendarActivityType}
            onView={setSelectedCreatorGroup}
            onActivity={(activity) => { setEditingActivity(activity); setActivityForm({ creator_entity_id: `entity:${activity.creator_entity_id}`, title: activity.title, activity_date: activity.activity_date, activity_time: activity.activity_time?.slice(0, 5) ?? '', activity_type: activity.activity_type, agent_remark: activity.agent_remark ?? '' }); setCalendarInfoOpen(true); }}
            onMilestone={(event) => void openMilestone(event)}
            onAddActivity={() => setCalendarInfoOpen(true)}
          />}
        </>
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
      {mode === 'design-requests' ? <AgentDesignerRequests /> : null}

      {selectedCreatorGroup ? (
        <CreatorDetailDrawer
          group={selectedCreatorGroup}
          currentEmployeeId={options.currentEmployee?.id ?? null}
          onClose={() => setSelectedCreatorGroup(null)}
          onAdjustment={(creatorProfile) => openAdjustmentForCreator(selectedCreatorGroup, creatorProfile)}
        />
      ) : null}

      {calendarInfoOpen ? <SystemModal title={editingActivity ? '编辑活动' : '新增活动'} ariaLabel="活动" onClose={() => { setCalendarInfoOpen(false); setEditingActivity(null); }} footer={<><button className="secondary-button compact-button" type="button" onClick={() => setCalendarInfoOpen(false)}>取消</button><button className="primary-button compact-button" type="submit" form="creator-activity-form" disabled={saving}>{saving ? '保存中...' : '保存'}</button></>}><form id="creator-activity-form" onSubmit={saveActivity}><div className="form-grid single"><label className="form-field"><span>主播</span><select disabled={Boolean(editingActivity)} required value={activityForm.creator_entity_id} onChange={(e) => setActivityForm({ ...activityForm, creator_entity_id: e.target.value })}><option value="">请选择</option>{groupCreatorProfiles(creators, options.currentEmployee?.id ?? null).map((group) => <option key={group.id} value={group.id}>{group.displayName}</option>)}</select></label><label className="form-field"><span>活动名称</span><input required value={activityForm.title} onChange={(e) => setActivityForm({ ...activityForm, title: e.target.value })} /></label><label className="form-field"><span>活动日期</span><input required type="date" value={activityForm.activity_date} onChange={(e) => setActivityForm({ ...activityForm, activity_date: e.target.value })} /></label><label className="form-field"><span>活动时间</span><input type="time" value={activityForm.activity_time} onChange={(e) => setActivityForm({ ...activityForm, activity_time: e.target.value })} /></label><label className="form-field"><span>活动类型</span><select value={activityForm.activity_type} onChange={(e) => setActivityForm({ ...activityForm, activity_type: e.target.value as CreatorActivityForm['activity_type'] })}>{Object.entries(creatorActivityTypeLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="form-field"><span>经纪人备注</span><textarea value={activityForm.agent_remark} onChange={(e) => setActivityForm({ ...activityForm, agent_remark: e.target.value })} /></label>{editingActivity ? <label className="form-field"><span>组长备注</span><textarea readOnly value={editingActivity.lead_remark ?? ''} /></label> : null}</div></form></SystemModal> : null}
      {selectedMilestone ? <SystemModal title={creatorCalendarMilestoneLabels[selectedMilestone.type as CreatorCalendarMilestoneType]} subtitle={selectedMilestone.group.displayName} ariaLabel="节点详情" onClose={() => setSelectedMilestone(null)} footer={<><button className="secondary-button compact-button" type="button" onClick={() => setSelectedCreatorGroup(selectedMilestone.group)}>查看主播资料</button><button className="primary-button compact-button" type="button" disabled={saving} onClick={() => void saveMilestone()}>保存备注</button></>}><label className="form-field"><span>经纪人备注</span><textarea value={milestoneRemark} onChange={(e) => setMilestoneRemark(e.target.value)} /></label></SystemModal> : null}

      {adjustmentModalOpen ? <AdjustmentModal values={adjustmentForm} saving={saving} currentRegionId={options.currentEmployee?.region_id ?? ''} onChange={setAdjustmentForm} onClose={() => setAdjustmentModalOpen(false)} onSubmit={submitAdjustment} /> : null}
      {selectedAdjustmentReview ? <AdjustmentReviewDrawer request={selectedAdjustmentReview} onClose={() => setSelectedAdjustmentReview(null)} /> : null}
      {reviewAction ? <AdjustmentReviewActionModal action={reviewAction} saving={saving} onChange={(note) => setReviewAction({ ...reviewAction, note })} onClose={() => setReviewAction(null)} onSubmit={submitAdjustmentReview} /> : null}
      {designModalOpen && mode !== 'design-requests' ? <DesignModal values={designForm} saving={saving} onChange={setDesignForm} onClose={() => setDesignModalOpen(false)} onSubmit={submitDesign} /> : null}
    </section>
  );
}

type ManagementRevenuePanelFilters = {
  startMonth: string;
  endMonth: string;
  managerEmployeeId: string;
  creatorSearch: string;
  platform: '' | CreatorPlatform;
  creatorType: '' | '5+1' | 'non_5_1';
  regionId: string;
  revenueCycle: '' | 'weekly' | 'monthly' | 'none';
};

type ManagementRankingView = CreatorPlatform;

type ManagementCreatorRevenueRow = {
  id: string;
  displayName: string;
  records: ManagementRevenueRecord[];
  platforms: CreatorPlatform[];
  managers: string[];
  types: string[];
  regions: string[];
  tiktokTotal: number;
  douyinTotal: number;
  periodCount: number;
};

type ManagementCreatorPlatformRevenueRow = {
  platform: CreatorPlatform;
  uid: string;
  manager: string;
  type: string;
  region: string;
  amount: number;
  unit: string;
};

const managementMonthShortcutOptions: { value: 'current' | 'previous' | 'last3' | 'last6' | 'year'; label: string }[] = [
  { value: 'current', label: '本月' },
  { value: 'previous', label: '上月' },
  { value: 'last3', label: '近3个月' },
  { value: 'last6', label: '近6个月' },
  { value: 'year', label: '本年' },
];

function managementRevenueMonthDateRange(startMonth: string, endMonth: string) {
  const [safeStart, safeEnd] = startMonth <= endMonth ? [startMonth, endMonth] : [endMonth, startMonth];
  const [endYear, endMonthNumber] = safeEnd.split('-').map(Number);
  return {
    startDate: `${safeStart}-01`,
    endDate: `${safeEnd}-${String(new Date(endYear, endMonthNumber, 0).getDate()).padStart(2, '0')}`,
  };
}

function RevenuePanel(props: { loading: boolean; options: AgentOptions }) {
  const permissions = usePermissions();
  const [filters, setFilters] = useState<ManagementRevenuePanelFilters>(() => ({
    startMonth: currentMonth,
    endMonth: currentMonth,
    managerEmployeeId: '',
    creatorSearch: '',
    platform: '',
    creatorType: '',
    regionId: '',
    revenueCycle: '',
  }));
  const [managerSearch, setManagerSearch] = useState('');
  const [records, setRecords] = useState<ManagementRevenueRecord[]>([]);
  const [managerEmployees, setManagerEmployees] = useState<RevenueRepresentativeOption[]>([]);
  const [offlineManagerEmployees, setOfflineManagerEmployees] = useState<ManagementRevenueManagerOption[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState('');
  const recordsRequestSequence = useRef(0);
  const recordsPanelMounted = useRef(false);
  const [platformKpiRows, setPlatformKpiRows] = useState<Record<CreatorPlatform, AgentPlatformRevenueKpiSummary[]>>({ tiktok: [], douyin: [] });
  const [platformKpiLoading, setPlatformKpiLoading] = useState<Record<CreatorPlatform, boolean>>({ tiktok: false, douyin: false });
  const [platformKpiError, setPlatformKpiError] = useState<Record<CreatorPlatform, string>>({ tiktok: '', douyin: '' });
  const [platformKpiSavingId, setPlatformKpiSavingId] = useState('');
  const platformKpiSaveInFlightRef = useRef(false);
  const platformKpiScopeRef = useRef({ month: filters.endMonth, active: true });
  if (platformKpiScopeRef.current.month !== filters.endMonth) {
    platformKpiScopeRef.current = { month: filters.endMonth, active: true };
  }
  const [offlineRows, setOfflineRows] = useState<AgentOfflineRevenueKpiSummary[]>([]);
  const [offlineLoading, setOfflineLoading] = useState(false);
  const [offlineError, setOfflineError] = useState('');
  const [offlineSavingId, setOfflineSavingId] = useState('');
  const [currentUserJobTitle, setCurrentUserJobTitle] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [selectedCreatorRow, setSelectedCreatorRow] = useState<ManagementCreatorRevenueRow | null>(null);
  const [agentRankingView, setAgentRankingView] = useState<ManagementRankingView>('tiktok');
  const [creatorRankingView, setCreatorRankingView] = useState<ManagementRankingView>('tiktok');
  const [tablePage, setTablePage] = useState(1);
  const tablePageSize = 20;
  const managerOptionDateRange = useMemo(
    () => managementRevenueMonthDateRange(filters.startMonth, filters.endMonth),
    [filters.endMonth, filters.startMonth],
  );
  const eligibleAgentRankingRoster = useMemo(() => {
    const eligibleAgents = getEligibleManagementAgents(
      props.options.employees,
      platformKpiRows.tiktok,
      platformKpiRows.douyin,
    );
    const employeeRegions = new Map(props.options.employees.map((employee) => [employee.id, employee.region_id]));
    return eligibleAgents.filter((agent) => {
      if (filters.managerEmployeeId && agent.id !== filters.managerEmployeeId) return false;
      if (filters.regionId && employeeRegions.get(agent.id) !== filters.regionId) return false;
      return true;
    });
  }, [filters.managerEmployeeId, filters.regionId, platformKpiRows, props.options.employees]);
  const visibleOfflineRows = useMemo(() => {
    const employeeRegions = new Map(offlineManagerEmployees.map((employee) => [employee.id, employee.region_id]));

    return offlineRows
      .filter((row) => !filters.regionId || employeeRegions.get(row.agent_employee_id) === filters.regionId)
      .sort((first, second) => {
        const completedDifference = Number(second.completed_amount ?? 0) - Number(first.completed_amount ?? 0);
        if (completedDifference !== 0) return completedDifference;

        const nameDifference = (first.agent_name ?? '').localeCompare(second.agent_name ?? '');
        if (nameDifference !== 0) return nameDifference;

        return first.agent_employee_id.localeCompare(second.agent_employee_id);
      });
  }, [filters.regionId, offlineManagerEmployees, offlineRows]);
  const visiblePlatformKpiRows = useMemo(() => {
    const employeeRegions = new Map(offlineManagerEmployees.map((employee) => [employee.id, employee.region_id]));
    const sortRows = (rows: AgentPlatformRevenueKpiSummary[]) => rows
      .filter((row) => !filters.regionId || employeeRegions.get(row.agent_employee_id) === filters.regionId)
      .sort((first, second) => Number(second.completed_amount ?? 0) - Number(first.completed_amount ?? 0) || (first.agent_name ?? '').localeCompare(second.agent_name ?? '') || first.agent_employee_id.localeCompare(second.agent_employee_id));
    return { tiktok: sortRows(platformKpiRows.tiktok), douyin: sortRows(platformKpiRows.douyin) };
  }, [filters.regionId, offlineManagerEmployees, platformKpiRows]);
  const agentRankingRows = useMemo(
    () => buildManagementAgentRanking(records, agentRankingView, eligibleAgentRankingRoster, !filters.creatorSearch.trim() && !filters.creatorType),
    [agentRankingView, eligibleAgentRankingRoster, filters.creatorSearch, filters.creatorType, records],
  );
  const canEditOfflineKpi = permissions.isSuperAdmin || currentUserJobTitle === 'TALENT AGENT LEAD';

  useLayoutEffect(() => {
    recordsPanelMounted.current = true;
    recordsRequestSequence.current += 1;
    return () => {
      recordsPanelMounted.current = false;
      recordsRequestSequence.current += 1;
    };
  }, [filters]);

  useEffect(() => {
    void loadRecords();
  }, [filters]);

  useEffect(() => {
    let active = true;

    agentService.listManagementRevenueRepresentativeOptions({
      startDate: managerOptionDateRange.startDate,
      endDate: managerOptionDateRange.endDate,
      platform: filters.platform,
      creatorType: filters.creatorType,
      regionId: filters.regionId,
      revenueCycle: filters.revenueCycle,
    })
      .then((employees) => { if (active) setManagerEmployees(employees); })
      .catch(() => { if (active) setManagerEmployees([]); });

    return () => { active = false; };
  }, [filters.creatorType, filters.platform, filters.regionId, filters.revenueCycle, managerOptionDateRange.endDate, managerOptionDateRange.startDate]);

  useEffect(() => {
    let active = true;
    agentService.listManagementRevenueManagerOptions()
      .then((employees) => { if (active) setOfflineManagerEmployees(employees); })
      .catch(() => { if (active) setOfflineManagerEmployees([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (filters.managerEmployeeId && !managerEmployees.some((employee) => employee.id === filters.managerEmployeeId)) {
      setFilters((current) => ({ ...current, managerEmployeeId: '' }));
    }
  }, [filters.managerEmployeeId, managerEmployees]);

  useEffect(() => {
    let active = true;

    profileService.getMyProfile()
      .then((data) => { if (active) setCurrentUserJobTitle(data.employee?.job_title?.name ?? null); })
      .catch(() => { if (active) setCurrentUserJobTitle(null); });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    setTablePage(1);
  }, [filters]);

  useEffect(() => {
    let active = true;
    setOfflineLoading(true);
    setOfflineError('');
    agentService.listAgentOfflineRevenueKpiSummary(filters.endMonth)
      .then((rows) => { if (active) setOfflineRows(rows); })
      .catch(() => { if (active) { setOfflineRows([]); setOfflineError('读取线下直播间流水失败'); } })
      .finally(() => { if (active) setOfflineLoading(false); });
    return () => { active = false; };
  }, [filters.endMonth]);

  useEffect(() => {
    const scope = platformKpiScopeRef.current;
    let active = true;
    scope.active = true;
    for (const platform of ['tiktok', 'douyin'] as const) {
      setPlatformKpiLoading((current) => ({ ...current, [platform]: true }));
      setPlatformKpiError((current) => ({ ...current, [platform]: '' }));
      setPlatformKpiRows((current) => ({ ...current, [platform]: [] }));
      agentService.listAgentPlatformRevenueKpiSummary(filters.endMonth, platform)
        .then((rows) => { if (active && scope.active && platformKpiScopeRef.current === scope) setPlatformKpiRows((current) => ({ ...current, [platform]: rows })); })
        .catch(() => { if (active && scope.active && platformKpiScopeRef.current === scope) setPlatformKpiError((current) => ({ ...current, [platform]: '读取平台经纪人流水 KPI 失败' })); })
        .finally(() => { if (active && scope.active && platformKpiScopeRef.current === scope) setPlatformKpiLoading((current) => ({ ...current, [platform]: false })); });
    }
    return () => { active = false; scope.active = false; };
  }, [filters.endMonth]);

  const managerOptions = useMemo(() => {
    const normalizedSearch = managerSearch.trim().toLowerCase();
    return managerEmployees.filter((employee) => {
      if (!normalizedSearch) return true;
      return [
        getEmployeeName(employee),
        employee.full_name,
        employee.nickname,
      ].join(' ').toLowerCase().includes(normalizedSearch);
    });
  }, [managerSearch, managerEmployees]);

  const summary = useMemo(() => summarizeManagementRevenueRecords(records), [records]);
  const trendPoints = useMemo(() => buildManagementTrendPoints(records, filters.startMonth, filters.endMonth), [filters.endMonth, filters.startMonth, records]);
  const creatorRows = useMemo(() => buildManagementCreatorRows(records), [records]);
  const pageCount = Math.max(1, Math.ceil(creatorRows.length / tablePageSize));
  const safePage = Math.min(tablePage, pageCount);
  const paginatedCreatorRows = useMemo(() => {
    const start = (safePage - 1) * tablePageSize;
    return creatorRows.slice(start, start + tablePageSize);
  }, [creatorRows, safePage]);

  async function loadRecords() {
    if (!recordsPanelMounted.current) return;
    const requestSequence = ++recordsRequestSequence.current;
    const isCurrentRequest = () => recordsPanelMounted.current && requestSequence === recordsRequestSequence.current;
    setRecordsLoading(true);
    setRecordsError('');
    setMessage('');
    try {
      const nextRecords = await agentService.listManagementRevenueRecords(filters);
      if (isCurrentRequest()) setRecords(nextRecords);
    } catch (loadError) {
      if (isCurrentRequest()) {
        setRecords([]);
        setRecordsError(`读取总流水数据失败：${getErrorMessage(loadError)}`);
      }
    } finally {
      if (isCurrentRequest()) setRecordsLoading(false);
    }
  }

  function updateFilter<Key extends keyof ManagementRevenuePanelFilters>(key: Key, value: ManagementRevenuePanelFilters[Key]) {
    if (key !== 'regionId') {
      setFilters((current) => ({ ...current, [key]: value }));
      return;
    }

    const nextRegionId = value as string;
    setFilters((current) => {
      return { ...current, regionId: nextRegionId };
    });
  }

  function updateMonthRange(key: 'startMonth' | 'endMonth', value: string) {
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (next.startMonth > next.endMonth) {
        if (key === 'startMonth') next.endMonth = value;
        else next.startMonth = value;
      }
      return next;
    });
  }

  function applyMonthShortcut(value: (typeof managementMonthShortcutOptions)[number]['value']) {
    setFilters((current) => {
      if (value === 'previous') {
        const previousMonth = shiftMonth(currentMonth, -1);
        return { ...current, startMonth: previousMonth, endMonth: previousMonth };
      }
      if (value === 'last3') return { ...current, startMonth: shiftMonth(currentMonth, -2), endMonth: currentMonth };
      if (value === 'last6') return { ...current, startMonth: shiftMonth(currentMonth, -5), endMonth: currentMonth };
      if (value === 'year') return { ...current, startMonth: `${currentMonth.slice(0, 4)}-01`, endMonth: currentMonth };
      return { ...current, startMonth: currentMonth, endMonth: currentMonth };
    });
  }

  function resetFilters() {
    setManagerSearch('');
    setFilters({
      startMonth: currentMonth,
      endMonth: currentMonth,
      managerEmployeeId: '',
      creatorSearch: '',
      platform: '',
      creatorType: '',
      regionId: '',
      revenueCycle: '',
    });
  }

  async function savePlatformKpi(platform: CreatorPlatform, agentEmployeeId: string, amount: number) {
    if (platformKpiSaveInFlightRef.current) throw new Error('正在保存目标流水，请稍后重试');
    const scope = platformKpiScopeRef.current;
    const savingKey = `${platform}:${agentEmployeeId}`;
    platformKpiSaveInFlightRef.current = true;
    setPlatformKpiSavingId(savingKey);
    setPlatformKpiError((current) => ({ ...current, [platform]: '' }));
    try {
      await agentService.upsertAgentPlatformRevenueKpi(agentEmployeeId, scope.month, platform, amount);
      if (scope.active && platformKpiScopeRef.current === scope) {
        setPlatformKpiRows((rows) => ({ ...rows, [platform]: rows[platform].map((row) => row.agent_employee_id === agentEmployeeId ? { ...row, kpi_amount: amount } : row) }));
      }
    } catch (saveError) {
      if (scope.active && platformKpiScopeRef.current === scope) {
        setPlatformKpiError((current) => ({ ...current, [platform]: `保存目标流水失败：${getErrorMessage(saveError)}` }));
      }
      throw saveError;
    } finally {
      platformKpiSaveInFlightRef.current = false;
      setPlatformKpiSavingId('');
    }
  }

  async function saveOfflineKpi(agentEmployeeId: string, amount: number) {
    if (offlineSavingId) return;
    setOfflineSavingId(agentEmployeeId);
    setOfflineError('');
    try {
      await agentService.upsertAgentOfflineRevenueKpi(agentEmployeeId, filters.endMonth, amount);
      setOfflineRows((rows) => rows.map((row) => row.agent_employee_id === agentEmployeeId ? { ...row, kpi_amount: amount } : row));
    } catch (saveError) {
      setOfflineError(`保存 KPI 失败：${getErrorMessage(saveError)}`);
      throw saveError;
    } finally {
      setOfflineSavingId('');
    }
  }

  return (
    <div className="staff-list-panel management-revenue-page">
      <div className="management-revenue-filters">
        <div className="management-revenue-month-filter">
          <span>月份范围</span>
          <div>
            <MonthSelect value={filters.startMonth} onChange={(value) => updateMonthRange('startMonth', value)} />
            <b>→</b>
            <MonthSelect value={filters.endMonth} onChange={(value) => updateMonthRange('endMonth', value)} />
          </div>
        </div>
        <div className="management-revenue-manager-search">
          <TextField label="经纪人搜索" value={managerSearch} onChange={setManagerSearch} placeholder="姓名 / 昵称 / Email" />
        </div>
        <div className="management-revenue-manager-select">
          <SelectField label="经纪人" value={filters.managerEmployeeId} onChange={(value) => updateFilter('managerEmployeeId', value)}>
            <option value="">全部经纪人</option>
            {managerOptions.map((employee) => <option key={employee.id} value={employee.id}>{getEmployeeName(employee) || employee.full_name}</option>)}
          </SelectField>
        </div>
        <div className="management-revenue-creator-search">
          <TextField label="主播搜索" value={filters.creatorSearch} onChange={(value) => updateFilter('creatorSearch', value)} placeholder="主播名 / UID / 账号" />
        </div>
        <div className="management-revenue-platform-filter">
          <SelectField label="平台" value={filters.platform} onChange={(value) => updateFilter('platform', value as ManagementRevenuePanelFilters['platform'])}>
            <option value="">全部</option>
            <option value="tiktok">TikTok</option>
            <option value="douyin">抖音</option>
          </SelectField>
        </div>
        <div className="management-revenue-shortcut-filter">
          <span>快捷月份</span>
          <div className="management-revenue-shortcuts" role="group" aria-label="月份快捷选项">
            {managementMonthShortcutOptions.map((option) => (
              <button key={option.value} type="button" onClick={() => applyMonthShortcut(option.value)}>{option.label}</button>
            ))}
          </div>
        </div>
        <div className="management-revenue-type-filter">
          <SelectField label="类型" value={filters.creatorType} onChange={(value) => updateFilter('creatorType', value as ManagementRevenuePanelFilters['creatorType'])}>
            <option value="">全部</option>
            <option value="5+1">5+1</option>
            <option value="non_5_1">非5+1</option>
          </SelectField>
        </div>
        <div className="management-revenue-region-filter">
          <SelectField label="区域" value={filters.regionId} onChange={(value) => updateFilter('regionId', value)}>
            <option value="">全部</option>
            {props.options.regions.map((region) => <option key={region.id} value={region.id}>{region.code}</option>)}
          </SelectField>
        </div>
        <div className="management-revenue-cycle-filter">
          <SelectField label="流水周期" value={filters.revenueCycle} onChange={(value) => updateFilter('revenueCycle', value as ManagementRevenuePanelFilters['revenueCycle'])}>
            <option value="">全部</option>
            <option value="weekly">周流水</option>
            <option value="monthly">月流水</option>
            <option value="none">不需要填写</option>
          </SelectField>
        </div>
        <div className="management-revenue-filter-actions">
          <button className="secondary-button compact-button" type="button" onClick={resetFilters} disabled={props.loading || recordsLoading}>重置</button>
          <button className="secondary-button compact-button" type="button" onClick={loadRecords} disabled={props.loading || recordsLoading}>
            <RefreshCw size={15} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {recordsError ? <p className="form-alert management-revenue-alert">{recordsError}</p> : null}
      {message ? <p className="form-success management-revenue-alert">{message}</p> : null}
      <p className="management-revenue-attribution-note">新流水按记录时负责人归属；旧历史记录如无负责人快照，则暂按主播当前负责人归属。</p>

      <div className="management-revenue-kpi-grid">
        <ManagementRevenueKpiCard title="TikTok 总钻石" value={summary.tiktokTotal} unit="钻石" platform="tiktok" />
        <ManagementRevenueKpiCard title="抖音总音浪" value={summary.douyinTotal} unit="音浪" platform="douyin" />
      </div>

      <div className="management-revenue-chart-grid">
        <ManagementRevenueTrendChart points={trendPoints} loading={props.loading || recordsLoading} />
        <ManagementAgentRankingChart rows={agentRankingRows} view={agentRankingView} onView={setAgentRankingView} />
        <ManagementCreatorRankingChart records={records} view={creatorRankingView} onView={setCreatorRankingView} />
      </div>

      <div className="management-agent-kpi-grid">
        <ManagementPlatformRevenueCard title="TikTok 经纪人 KPI" unit="钻石" rows={visiblePlatformKpiRows.tiktok} loading={platformKpiLoading.tiktok} error={platformKpiError.tiktok} month={filters.endMonth} canEditKpi={canEditOfflineKpi} savingId={platformKpiSavingId} platform="tiktok" onSaveKpi={savePlatformKpi} />
        <ManagementPlatformRevenueCard title="抖音经纪人 KPI" unit="音浪" rows={visiblePlatformKpiRows.douyin} loading={platformKpiLoading.douyin} error={platformKpiError.douyin} month={filters.endMonth} canEditKpi={canEditOfflineKpi} savingId={platformKpiSavingId} platform="douyin" onSaveKpi={savePlatformKpi} />
        <ManagementOfflineRevenueCard rows={visibleOfflineRows} loading={offlineLoading} error={offlineError} month={filters.endMonth} canEditKpi={canEditOfflineKpi} savingId={offlineSavingId} onSaveKpi={saveOfflineKpi} />
      </div>

      <ManagementRevenueRecordsSection
        loading={props.loading || recordsLoading}
        rows={paginatedCreatorRows}
        allRows={creatorRows}
        page={safePage}
        pageCount={pageCount}
        onPage={setTablePage}
        onView={setSelectedCreatorRow}
      />

      {selectedCreatorRow ? (
        <ManagementRevenueDetailModal
          row={selectedCreatorRow}
          filters={filters}
          onClose={() => setSelectedCreatorRow(null)}
          onVerified={() => { setSelectedCreatorRow(null); void loadRecords(); }}
        />
      ) : null}
    </div>
  );
}

function ManagementRevenueKpiCard({ title, value, unit, platform }: { title: string; value: number; unit?: string; platform?: CreatorPlatform }) {
  return (
    <article className={`management-revenue-kpi-card ${platform ? `management-revenue-kpi-card--${platform}` : ''}`}>
      <div>
        <span>{title}</span>
        {platform ? <img src={platform === 'tiktok' ? tiktokLogoUrl : douyinLogoUrl} alt="" aria-hidden="true" /> : null}
      </div>
      <strong>{formatRevenueAmount(value)}</strong>
      {unit ? <small>{unit}</small> : null}
    </article>
  );
}

function ManagementRevenueTrendChart({ points, loading }: { points: ManagementTrendPoint[]; loading: boolean }) {
  const chart = createManagementTrendChart(points);
  return (
    <section className="management-revenue-card management-revenue-trend-card">
      <ManagementRevenueSectionHead title="流水趋势图" detail="TikTok 使用左轴，抖音使用右轴" />
      {loading ? <div className="table-state management-revenue-state">正在生成趋势图...</div> : (
        <div className="management-revenue-line-chart">
          <svg viewBox="0 0 680 280" role="img" aria-label="流水趋势图">
            <g className="management-revenue-chart-gridlines">
              {[0, 1, 2, 3].map((item) => <line key={item} x1="46" x2="632" y1={42 + item * 52} y2={42 + item * 52} />)}
            </g>
            <polyline className="management-revenue-line management-revenue-line--tiktok" points={chart.tiktokLine} />
            <polyline className="management-revenue-line management-revenue-line--douyin" points={chart.douyinLine} />
            {chart.points.map((point) => (
              <g key={point.key}>
                <title>{`${point.label} · TikTok ${formatRevenueAmount(point.tiktok)} 钻石 · 抖音 ${formatRevenueAmount(point.douyin)} 音浪`}</title>
                <circle className="management-revenue-dot management-revenue-dot--tiktok" cx={point.x} cy={point.tiktokY} r="4" />
                <circle className="management-revenue-dot management-revenue-dot--douyin" cx={point.x} cy={point.douyinY} r="4" />
                <text x={point.x} y="252">{point.axisLabel}</text>
              </g>
            ))}
            <text className="management-revenue-axis-label management-revenue-axis-label--left" x="46" y="24">钻石 {formatCompactNumber(chart.maxTikTok)}</text>
            <text className="management-revenue-axis-label management-revenue-axis-label--right" x="632" y="24">音浪 {formatCompactNumber(chart.maxDouyin)}</text>
          </svg>
          <div className="management-revenue-chart-legend">
            <span><i className="management-revenue-legend-dot management-revenue-legend-dot--tiktok" />TikTok 钻石</span>
            <span><i className="management-revenue-legend-dot management-revenue-legend-dot--douyin" />抖音音浪</span>
          </div>
        </div>
      )}
    </section>
  );
}

function ManagementAgentRankingChart({ rows, view, onView }: { rows: ManagementRankingRow[]; view: ManagementRankingView; onView: (view: ManagementRankingView) => void }) {
  return (
    <section className="management-revenue-card">
      <ManagementRevenueSectionHead title="经纪人流水排行榜" detail={platformLabels[view]} />
      <ManagementRankingTabs view={view} onView={onView} />
      <ManagementRankingBars rows={rows} view={view} emptyText="暂无经纪人流水数据" />
    </section>
  );
}

function ManagementOfflineRevenueCard({ rows, loading, error, month, canEditKpi, savingId, onSaveKpi }: { rows: AgentOfflineRevenueKpiSummary[]; loading: boolean; error: string; month: string; canEditKpi: boolean; savingId: string; onSaveKpi: (id: string, amount: number) => Promise<void> }) {
  return (
    <section className="management-revenue-card management-offline-revenue-card">
      <ManagementRevenueSectionHead title="线下直播间流水" detail={formatMonthLabel(month)} />
      {loading ? <div className="table-state management-revenue-state">正在读取线下直播间流水...</div> : null}
      {error ? <p className="offline-kpi-error">{error}</p> : null}
      {!loading && !error && rows.length === 0 ? <div className="table-state management-revenue-state">暂无经纪人数据</div> : null}
      {!loading && rows.length > 0 ? <div className="offline-kpi-table" role="table" aria-label="线下直播间流水">
        <div className="offline-kpi-row offline-kpi-head" role="row"><span>经纪人</span><span>管理主播</span><span>KPI</span><span>已完成</span></div>
        <div className="offline-kpi-body">
          {rows.map((row) => <div className="offline-kpi-row" role="row" key={row.agent_employee_id}>
            <strong title={row.agent_name}>{row.agent_name}</strong><span className="offline-kpi-managed-count">{row.managed_creator_count}</span>
            <InlineOfflineKpi value={row.kpi_amount} editable={canEditKpi} saving={savingId === row.agent_employee_id} onSave={(amount) => onSaveKpi(row.agent_employee_id, amount)} />
            <b className={row.completed_amount > 0 ? 'offline-kpi-completed-positive' : 'offline-kpi-completed-zero'}>{formatRevenueAmount(row.completed_amount)}</b>
          </div>)}
        </div>
      </div> : null}
    </section>
  );
}

function ManagementPlatformRevenueCard({ title, unit, rows, loading, error, month, canEditKpi, savingId, platform, onSaveKpi }: { title: string; unit: string; rows: AgentPlatformRevenueKpiSummary[]; loading: boolean; error: string; month: string; canEditKpi: boolean; savingId: string; platform: CreatorPlatform; onSaveKpi: (platform: CreatorPlatform, id: string, amount: number) => Promise<void> }) {
  return (
    <section className={`management-revenue-card management-platform-revenue-card management-platform-revenue-card--${platform}`}>
      <ManagementRevenueSectionHead title={title} detail={`${formatMonthLabel(month)} · ${unit}`} />
      {loading ? <div className="table-state management-revenue-state">正在读取平台经纪人 KPI...</div> : null}
      {error ? <p className="offline-kpi-error">{error}</p> : null}
      {!loading && !error && rows.length === 0 ? <div className="table-state management-revenue-state">暂无经纪人数据</div> : null}
      {!loading && rows.length > 0 ? <div className="offline-kpi-table" role="table" aria-label={title}>
        <div className="offline-kpi-row offline-kpi-head" role="row"><span>经纪人</span><span>管理主播数量</span><span>目标流水</span><span>已完成流水</span></div>
        <div className="offline-kpi-body">
          {rows.map((row) => <div className="offline-kpi-row" role="row" key={row.agent_employee_id}>
            <strong title={row.agent_name}>{row.agent_name}</strong><span className="offline-kpi-managed-count">{row.managed_creator_count}</span>
            <InlineOfflineKpi value={row.kpi_amount} editable={canEditKpi} saving={savingId === `${platform}:${row.agent_employee_id}`} onSave={(amount) => onSaveKpi(platform, row.agent_employee_id, amount)} />
            <b className={row.completed_amount > 0 ? 'offline-kpi-completed-positive' : 'offline-kpi-completed-zero'}>{formatRevenueAmount(row.completed_amount)}
              {row.unverified_record_count > 0 ? <small className="management-platform-kpi-risk">包含未核验流水<br />{formatRevenueAmount(row.unverified_amount)} {unit} · {row.unverified_record_count} 条</small> : null}
            </b>
          </div>)}
        </div>
      </div> : null}
    </section>
  );
}

function InlineOfflineKpi({ value, editable, saving, onSave }: { value: number | null; editable: boolean; saving: boolean; onSave: (amount: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const submittingRef = useRef(false);
  const open = () => { if (editable && !saving) { setDraft(value === null ? '' : String(value)); setEditing(true); } };
  const cancel = () => { submittingRef.current = false; setEditing(false); setDraft(''); };
  const submit = async () => {
    if (!editing || submittingRef.current || saving) return;
    const amount = Number(draft);
    if (!draft.trim() || !Number.isFinite(amount) || amount < 0) return;
    submittingRef.current = true;
    try { await onSave(amount); setEditing(false); } catch { setDraft(value === null ? '' : String(value)); } finally { submittingRef.current = false; }
  };
  if (!editing) return <button className={`offline-kpi-value ${editable ? 'editable' : ''} ${value === null ? 'empty' : 'filled'}`} type="button" onClick={open} disabled={!editable || saving}>{value === null ? '—' : formatRevenueAmount(value)}</button>;
  return <input className="offline-kpi-input" autoFocus inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { void submit(); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submit(); } if (event.key === 'Escape') cancel(); }} aria-label="KPI" />;
}

function ManagementCreatorRankingChart({ records, view, onView }: { records: ManagementRevenueRecord[]; view: ManagementRankingView; onView: (view: ManagementRankingView) => void }) {
  const rows = buildManagementCreatorRanking(records, view).slice(0, 10);

  return (
    <section className="management-revenue-card">
      <ManagementRevenueSectionHead title="主播流水排行榜" detail={platformLabels[view]} />
      <ManagementRankingTabs view={view} onView={onView} />
      <ManagementRankingList title={`${platformLabels[view]} Top 10`} rows={rows} platform={view} />
    </section>
  );
}

function ManagementRevenueSectionHead({ title, detail }: { title: string; detail?: string }) {
  return <div className="management-revenue-section-head"><h3>{title}</h3>{detail ? <span>{detail}</span> : null}</div>;
}

function ManagementRankingTabs({ view, onView }: { view: ManagementRankingView; onView: (view: ManagementRankingView) => void }) {
  return (
    <div className="management-revenue-ranking-tabs" role="group" aria-label="排行平台">
      <button className={view === 'tiktok' ? 'active' : ''} type="button" onClick={() => onView('tiktok')}>TikTok 钻石</button>
      <button className={view === 'douyin' ? 'active' : ''} type="button" onClick={() => onView('douyin')}>抖音音浪</button>
    </div>
  );
}

function ManagementRankingBars({ rows, view, emptyText }: { rows: ManagementRankingRow[]; view: ManagementRankingView; emptyText: string }) {
  const maxValue = Math.max(1, ...rows.map((row) => row[view]));
  if (rows.length === 0) return <div className="table-state management-revenue-state">{emptyText}</div>;
  return (
    <div className="management-revenue-ranking-bars">
      {rows.map((row, index) => (
        <div key={row.id} className="management-revenue-ranking-row">
          <ManagementRankBadge rank={index + 1} />
          <span>{row.label}</span>
          <div className="management-revenue-ranking-track">
            <ManagementRankingBar value={row[view]} max={maxValue} platform={view} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ManagementRankingBar({ value, max, platform }: { value: number; max: number; platform: CreatorPlatform }) {
  const width = value > 0 ? Math.max(4, (value / max) * 100) : 0;
  return (
    <div className={`management-revenue-ranking-bar management-revenue-ranking-bar--${platform} ${value === 0 ? 'is-zero' : ''}`}>
      <i style={{ width: `${width}%` }} />
      <b>{formatRevenueAmount(value)} <small>{getCreatorRevenueUnitLabel(platform)}</small></b>
    </div>
  );
}

function ManagementRankBadge({ rank }: { rank: number }) {
  return <em className={`management-revenue-rank-badge management-revenue-rank-badge--${rank <= 3 ? rank : 'normal'}`}>{rank}</em>;
}

function ManagementRankingList({ title, rows, platform }: { title: string; rows: ManagementRankingRow[]; platform: CreatorPlatform }) {
  return (
    <div className={`management-revenue-top-list management-revenue-top-list--${platform}`}>
      <h4>{title}</h4>
      {rows.length === 0 ? <span>暂无数据</span> : rows.map((row, index) => (
        <p key={row.id}><ManagementRankBadge rank={index + 1} /><strong>{row.label}</strong><b>{formatRevenueAmount(row[platform])} <small>{getCreatorRevenueUnitLabel(platform)}</small></b></p>
      ))}
    </div>
  );
}

function ManagementRevenueRecordsSection(props: {
  loading: boolean;
  rows: ManagementCreatorRevenueRow[];
  allRows: ManagementCreatorRevenueRow[];
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  onView: (row: ManagementCreatorRevenueRow) => void;
}) {
  if (props.loading) return <div className="table-state management-revenue-state">正在读取正式流水数据...</div>;
  return (
    <section className="management-revenue-table-section">
      <ManagementRevenueSectionHead title="正式流水数据" detail={`共 ${props.allRows.length} 位主播`} />
      {props.allRows.length === 0 ? <div className="table-state management-revenue-state">暂无正式流水数据。</div> : (
        <>
          <div className="staff-table-wrap management-revenue-desktop-table">
            <table className="staff-table agent-table management-revenue-table">
              <thead>
                <tr>
                  <th>主播</th>
                  <th>平台</th>
                  <th>经纪人</th>
                  <th>类型</th>
                  <th>区域</th>
                  <th>流水</th>
                  <th>周期记录数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {props.rows.map((row) => (
                  <ManagementCreatorRevenueTableRow key={row.id} row={row} onView={props.onView} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="management-revenue-mobile-list">
            {props.rows.map((row) => <ManagementCreatorRevenueMobileCard key={row.id} row={row} onView={props.onView} />)}
          </div>
          <div className="agent-period-pagination management-revenue-pagination">
            <span>第 {props.page} / {props.pageCount} 页</span>
            <div>
              <button className="secondary-button compact-button" type="button" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}>上一页</button>
              <button className="secondary-button compact-button" type="button" disabled={props.page >= props.pageCount} onClick={() => props.onPage(props.page + 1)}>下一页</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ManagementCreatorRevenueTableRow({ row, onView }: { row: ManagementCreatorRevenueRow; onView: (row: ManagementCreatorRevenueRow) => void }) {
  const platformRows = getManagementCreatorPlatformRows(row);
  const sharedManager = getSharedPlatformValue(platformRows, 'manager');
  const sharedType = getSharedPlatformValue(platformRows, 'type');
  const sharedRegion = getSharedPlatformValue(platformRows, 'region');
  const spanCount = platformRows.length;
  return (
    <>
      {platformRows.map((platformRow, index) => (
        <tr
          key={`${row.id}:${platformRow.platform}`}
          className={`management-revenue-creator-platform-row ${index === 0 ? 'management-revenue-creator-platform-row--first' : ''} ${index === spanCount - 1 ? 'management-revenue-creator-platform-row--last' : ''}`}
        >
          {index === 0 ? <td rowSpan={spanCount} className="management-revenue-creator-cell"><strong>{row.displayName}</strong></td> : null}
          <td><ManagementCreatorPlatformDetail platformRow={platformRow} /></td>
          {sharedManager && index === 0 ? <td rowSpan={spanCount}>{sharedManager}</td> : null}
          {!sharedManager ? <td>{platformRow.manager}</td> : null}
          {sharedType && index === 0 ? <td rowSpan={spanCount}>{sharedType}</td> : null}
          {!sharedType ? <td>{platformRow.type}</td> : null}
          {sharedRegion && index === 0 ? <td rowSpan={spanCount}>{sharedRegion}</td> : null}
          {!sharedRegion ? <td>{platformRow.region}</td> : null}
          <td><ManagementCreatorPlatformAmount platformRow={platformRow} /></td>
          {index === 0 ? <td rowSpan={spanCount}><strong>{row.periodCount}</strong></td> : null}
          {index === 0 ? (
            <td rowSpan={spanCount}>
              <button className="secondary-button compact-button management-revenue-view-button" type="button" onClick={() => onView(row)}>
                <Eye size={15} />
                <span>查看</span>
              </button>
            </td>
          ) : null}
        </tr>
      ))}
    </>
  );
}

function ManagementCreatorRevenueMobileCard({ row, onView }: { row: ManagementCreatorRevenueRow; onView: (row: ManagementCreatorRevenueRow) => void }) {
  const platformRows = getManagementCreatorPlatformRows(row);
  return (
    <article className="management-revenue-mobile-card">
      <div className="management-revenue-mobile-head">
        <div>
          <strong>{row.displayName}</strong>
          <span>{formatManagementValueList(row.managers)}</span>
        </div>
      </div>
      <div className="management-revenue-mobile-meta">
        <span>{formatManagementValueList(row.types)}</span>
        <span>{formatManagementValueList(row.regions)}</span>
      </div>
      <div className="management-revenue-mobile-platform-sections">
        {platformRows.map((platformRow) => (
          <div key={platformRow.platform} className="management-revenue-mobile-platform-section">
            <ManagementCreatorPlatformDetail platformRow={platformRow} />
            <ManagementCreatorPlatformAmount platformRow={platformRow} />
          </div>
        ))}
      </div>
      <p><span>周期记录数</span><b>{row.periodCount}</b></p>
      <button className="secondary-button compact-button management-revenue-view-button" type="button" onClick={() => onView(row)}>
        <Eye size={15} />
        <span>查看</span>
      </button>
    </article>
  );
}

function ManagementRevenueDetailModal({
  row,
  filters,
  onClose,
  onVerified,
}: {
  row: ManagementCreatorRevenueRow;
  filters: ManagementRevenuePanelFilters;
  onClose: () => void;
  onVerified: () => void;
}) {
  return (
    <SystemModal
      title="查看主播流水"
      ariaLabel="主播流水详情"
      className="management-revenue-detail-modal"
      onClose={onClose}
      footer={<button className="secondary-button compact-button" type="button" onClick={onClose}>关闭</button>}
    >
      <div className="management-revenue-detail-summary">
        <DrawerField label="主播" value={row.displayName} />
        <div className="agent-creator-drawer-field management-revenue-detail-platform-field">
          <span>平台 / UID</span>
          <div>{getManagementCreatorPlatformItems(row).map((item) => <b key={`${item.platform}:${item.uid}`}>{platformLabels[item.platform]} {item.uid}</b>)}</div>
        </div>
        <DrawerField label="经纪人" value={formatManagementValueList(row.managers)} />
        <DrawerField label="类型" value={formatManagementValueList(row.types)} />
        <DrawerField label="区域" value={formatManagementValueList(row.regions)} />
        <DrawerField label="月份范围" value={`${filters.startMonth} → ${filters.endMonth}`} />
        <DrawerField label="TikTok 总钻石" value={`${formatRevenueAmount(row.tiktokTotal)} 钻石`} />
        <DrawerField label="抖音总音浪" value={`${formatRevenueAmount(row.douyinTotal)} 音浪`} />
      </div>
      {[...new Map(row.records.filter(record => record.creator?.revenue_cycle === 'monthly' && record.cycle_source === 'LEGACY_UNKNOWN').map(record => [record.creator_profile_id, record])).values()].map(record => <div key={record.creator_profile_id}>
        <p>{record.creator?.creator_name} · 当前资料设置：月流水；所选月份周期待核验，只读。</p>
        <MonthlyRevenueBaseline profileId={record.creator_profile_id} creatorName={record.creator?.creator_name || record.creator_profile_id} month={malaysiaMonth()} onVerified={onVerified} />
      </div>)}
      <div className="management-revenue-weekly-table-wrap">
        <table className="staff-table agent-table management-revenue-weekly-table">
          <thead>
            <tr>
              <th>周期</th>
              <th>平台</th>
              <th>流水</th>
            </tr>
          </thead>
          <tbody>
            {row.records.filter((record) => record.has_revenue_record).map((record) => (
              <tr key={record.id}>
                <td data-label="周期">{record.record_kind === 'monthly' ? record.revenue_month?.slice(0, 7) : getWeekLabel(record.week_start_date, record.week_end_date)}</td>
                <td data-label="平台"><PlatformPill platform={record.platform} /></td>
                <td data-label="流水"><strong>{formatRevenueWithUnit(record)}</strong></td>
              </tr>
            ))}
            {row.records.every((record) => !record.has_revenue_record) ? <tr><td colSpan={3} className="table-state">当前日期范围暂无流水记录</td></tr> : null}
          </tbody>
        </table>
      </div>
    </SystemModal>
  );
}

function ManagementCreatorPlatformPills({ platforms }: { platforms: CreatorPlatform[] }) {
  return (
    <div className="management-revenue-platform-list">
      {platforms.map((platform) => <PlatformPill key={platform} platform={platform} />)}
    </div>
  );
}

function ManagementCreatorPlatformDetail({ platformRow }: { platformRow: ManagementCreatorPlatformRevenueRow }) {
  return (
    <div className="management-revenue-platform-detail">
      <PlatformPill platform={platformRow.platform} />
      <small>UID: {platformRow.uid}</small>
    </div>
  );
}

function ManagementCreatorPlatformAmount({ platformRow }: { platformRow: ManagementCreatorPlatformRevenueRow }) {
  return (
    <span className={`management-revenue-platform-amount management-revenue-platform-amount--${platformRow.platform}`}>
      <strong>{formatRevenueAmount(platformRow.amount)}</strong>
      <small>{platformRow.unit}</small>
    </span>
  );
}

function ManagementCreatorRevenueAmounts({ row }: { row: ManagementCreatorRevenueRow }) {
  return (
    <span className="management-revenue-amount-lines">
      {row.platforms.includes('tiktok') ? (
        <span className="management-revenue-amount-line management-revenue-amount-line--tiktok">
          <strong>{formatRevenueAmount(row.tiktokTotal)}</strong>
          <small>钻石</small>
        </span>
      ) : null}
      {row.platforms.includes('douyin') ? (
        <span className="management-revenue-amount-line management-revenue-amount-line--douyin">
          <strong>{formatRevenueAmount(row.douyinTotal)}</strong>
          <small>音浪</small>
        </span>
      ) : null}
    </span>
  );
}

function formatManagementValueList(values: string[]) {
  const filtered = values.filter((value) => value && value !== '-');
  return filtered.length ? filtered.join(' / ') : '-';
}

function getManagementCreatorUidText(row: ManagementCreatorRevenueRow) {
  const uids = Array.from(new Set(row.records.map((record) => record.creator?.platform_user_id || record.platform_uid).filter(Boolean)));
  return uids.length ? uids.join(' / ') : '-';
}

function getManagementCreatorPlatformRows(row: ManagementCreatorRevenueRow): ManagementCreatorPlatformRevenueRow[] {
  return sortCreatorPlatforms(row.platforms).map((platform) => {
    const platformRecords = row.records.filter((record) => record.platform === platform);
    return {
      platform,
      uid: formatManagementValueList(Array.from(new Set(platformRecords.map((record) => record.creator?.platform_user_id || record.platform_uid || '-')))),
      manager: formatManagementValueList(Array.from(new Set(platformRecords.map(getManagementRecordAgentName)))),
      type: formatManagementValueList(Array.from(new Set(platformRecords.map(getManagementRecordTypeLabel)))),
      region: formatManagementValueList(Array.from(new Set(platformRecords.map(getManagementRecordRegion)))),
      amount: platformRecords.reduce((sum, record) => sum + record.revenue_amount, 0),
      unit: getCreatorRevenueUnitLabel(platform),
    };
  });
}

function getSharedPlatformValue(rows: ManagementCreatorPlatformRevenueRow[], key: 'manager' | 'type' | 'region') {
  if (rows.length <= 1) return rows[0]?.[key] ?? '';
  const firstValue = rows[0][key];
  return rows.every((row) => row[key] === firstValue) ? firstValue : '';
}

function getManagementCreatorPlatformItems(row: ManagementCreatorRevenueRow) {
  const itemMap = new Map<string, { platform: CreatorPlatform; uid: string }>();
  row.records.forEach((record) => {
    const uid = record.creator?.platform_user_id || record.platform_uid || '-';
    itemMap.set(`${record.platform}:${uid}`, { platform: record.platform, uid });
  });
  return Array.from(itemMap.values());
}

function formatRevenueAmount(value: number) {
  return (Number(value) || 0).toLocaleString('en-MY', { maximumFractionDigits: 2 });
}

type ManagementTrendPoint = {
  key: string;
  label: string;
  axisLabel: string;
  tiktok: number;
  douyin: number;
};

type ManagementRankingRow = {
  id: string;
  label: string;
  tiktok: number;
  douyin: number;
  firstCreatedAt: number | null;
};

function buildManagementCreatorRows(records: ManagementRevenueRecord[]): ManagementCreatorRevenueRow[] {
  const rowMap = new Map<string, ManagementCreatorRevenueRow>();
  records.forEach((record) => {
    const creatorEntityId = record.creator?.creator_entity_id ?? record.creator_entity_id;
    const id = creatorEntityId ? `entity:${creatorEntityId}` : `profile:${record.creator_profile_id}`;
    const row = rowMap.get(id) ?? {
      id,
      displayName: getManagementRecordCreatorName(record),
      records: [],
      platforms: [],
      managers: [],
      types: [],
      regions: [],
      tiktokTotal: 0,
      douyinTotal: 0,
      periodCount: 0,
    };

    row.records.push(record);
    addUniqueValue(row.platforms, record.platform);
    addUniqueValue(row.managers, getManagementRecordAgentName(record));
    addUniqueValue(row.types, getManagementRecordTypeLabel(record));
    addUniqueValue(row.regions, getManagementRecordRegion(record));
    if (record.platform === 'tiktok') row.tiktokTotal += record.revenue_amount;
    if (record.platform === 'douyin') row.douyinTotal += record.revenue_amount;
    row.displayName = row.displayName === '-' ? getManagementRecordCreatorName(record) : row.displayName;
    rowMap.set(id, row);
  });

  return Array.from(rowMap.values()).map((row) => ({
    ...row,
    records: row.records.sort((first, second) => {
      if (first.week_start_date !== second.week_start_date) return first.week_start_date.localeCompare(second.week_start_date);
      return first.platform.localeCompare(second.platform);
    }),
    platforms: sortCreatorPlatforms(row.platforms),
    periodCount: new Set(row.records.filter((record) => record.has_revenue_record).map((record) => record.week_start_date)).size,
  })).sort((first, second) => {
    const firstValue = Math.max(first.tiktokTotal, first.douyinTotal);
    const secondValue = Math.max(second.tiktokTotal, second.douyinTotal);
    if (secondValue !== firstValue) return secondValue - firstValue;
    const firstCreatedAtCompare = compareFirstCreatedAt(getFirstCreatedAt(first.records), getFirstCreatedAt(second.records));
    if (firstCreatedAtCompare !== 0) return firstCreatedAtCompare;
    return first.id.localeCompare(second.id);
  });
}

function addUniqueValue<T>(values: T[], value: T) {
  if (!values.includes(value)) values.push(value);
}

function sortCreatorPlatforms(platforms: CreatorPlatform[]) {
  return [...platforms].sort((first, second) => {
    const order: Record<CreatorPlatform, number> = { tiktok: 1, douyin: 2 };
    return order[first] - order[second];
  });
}

function summarizeManagementRevenueRecords(records: ManagementRevenueRecord[]) {
  return records.reduce(
    (summary, record) => {
      if (record.platform === 'tiktok') summary.tiktokTotal += record.revenue_amount;
      if (record.platform === 'douyin') summary.douyinTotal += record.revenue_amount;
      return summary;
    },
    { tiktokTotal: 0, douyinTotal: 0 },
  );
}

function buildManagementTrendPoints(records: ManagementRevenueRecord[], startMonth: string, endMonth: string): ManagementTrendPoint[] {
  const months = getMonthRange(startMonth, endMonth);
  if (months.length <= 2) return buildManagementWeeklyTrendPoints(records, months);

  const pointMap = new Map(months.map((month) => [month, { key: month, label: month, axisLabel: month, tiktok: 0, douyin: 0 }]));
  records.forEach((record) => {
    const month = record.week_start_date.slice(0, 7);
    const point = pointMap.get(month);
    if (!point) return;
    if (record.platform === 'tiktok') point.tiktok += record.revenue_amount;
    if (record.platform === 'douyin') point.douyin += record.revenue_amount;
  });
  return Array.from(pointMap.values());
}

function buildManagementWeeklyTrendPoints(records: ManagementRevenueRecord[], months: string[]): ManagementTrendPoint[] {
  const weeks = months.flatMap(getManagementMonthWeekRanges);
  const pointMap = new Map(weeks.map((week) => [
    week.key,
    { key: week.key, label: week.label, axisLabel: week.axisLabel, tiktok: 0, douyin: 0 },
  ]));

  records.forEach((record) => {
    const point = pointMap.get(getManagementWeekKeyForDate(record.week_start_date));
    if (!point) return;
    if (record.platform === 'tiktok') point.tiktok += record.revenue_amount;
    if (record.platform === 'douyin') point.douyin += record.revenue_amount;
  });

  return Array.from(pointMap.values());
}

function getManagementMonthWeekRanges(month: string) {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return [];

  const ranges: Array<{ key: string; label: string; axisLabel: string }> = [];
  const cursor = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);

  while (cursor <= lastDay) {
    const start = new Date(cursor);
    const end = new Date(cursor);
    const dayOfWeek = end.getDay();
    const daysUntilSunday = (7 - dayOfWeek) % 7;
    end.setDate(Math.min(end.getDate() + daysUntilSunday, lastDay.getDate()));

    ranges.push({
      key: getManagementWeekKeyForDate(formatLocalDate(start)),
      label: formatManagementWeekLabel(start, end),
      axisLabel: formatManagementAxisDate(start),
    });

    cursor.setTime(end.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }

  return ranges;
}

function getManagementWeekKeyForDate(dateIso: string) {
  if (!isValidIsoDate(dateIso)) return dateIso;
  const date = parseIsoDate(dateIso);
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const monday = new Date(date);
  const daysSinceMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - daysSinceMonday);
  const start = monday < monthStart ? monthStart : monday;
  return formatLocalDate(start);
}

function formatManagementWeekLabel(start: Date, end: Date) {
  const startLabel = formatManagementAxisDate(start);
  const endLabel = formatManagementAxisDate(end);
  return startLabel === endLabel ? startLabel : `${startLabel}-${endLabel}`;
}

function formatManagementAxisDate(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function createManagementTrendChart(points: ManagementTrendPoint[]) {
  const left = 46;
  const right = 632;
  const top = 42;
  const bottom = 224;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  const maxTikTok = Math.max(1, ...points.map((point) => point.tiktok));
  const maxDouyin = Math.max(1, ...points.map((point) => point.douyin));
  const denominator = Math.max(1, points.length - 1);
  const chartPoints = points.map((point, index) => {
    const x = points.length === 1 ? left + plotWidth / 2 : left + (index / denominator) * plotWidth;
    return {
      key: point.key,
      label: point.label,
      axisLabel: point.axisLabel,
      tiktok: point.tiktok,
      douyin: point.douyin,
      x,
      tiktokY: bottom - (point.tiktok / maxTikTok) * plotHeight,
      douyinY: bottom - (point.douyin / maxDouyin) * plotHeight,
    };
  });

  return {
    maxTikTok,
    maxDouyin,
    points: chartPoints,
    tiktokLine: chartPoints.map((point) => `${point.x},${point.tiktokY}`).join(' '),
    douyinLine: chartPoints.map((point) => `${point.x},${point.douyinY}`).join(' '),
  };
}

function buildManagementAgentRanking(records: ManagementRevenueRecord[], view: ManagementRankingView, roster: { id: string; name: string }[] = [], includeZeroRevenueAgents = true): ManagementRankingRow[] {
  const rows = new Map<string, ManagementRankingRow>();
  const eligibleAgentIds = new Set(roster.map((agent) => agent.id));
  if (includeZeroRevenueAgents) roster.forEach((agent) => rows.set(agent.id, { id: agent.id, label: agent.name, tiktok: 0, douyin: 0, firstCreatedAt: null }));
  records.filter((record) => record.platform === view && Boolean(record.reporting_manager_employee_id) && eligibleAgentIds.has(record.reporting_manager_employee_id!)).forEach((record) => {
    const id = record.reporting_manager_employee_id!;
    const current = rows.get(id) ?? { id, label: getManagementRecordAgentName(record), tiktok: 0, douyin: 0, firstCreatedAt: null };
    if (record.platform === 'tiktok') current.tiktok += record.revenue_amount;
    if (record.platform === 'douyin') current.douyin += record.revenue_amount;
    current.firstCreatedAt = getEarlierCreatedAt(current.firstCreatedAt, record.created_at);
    rows.set(id, current);
  });
  return sortManagementRankingRows(Array.from(rows.values()), view);
}

function buildManagementCreatorRanking(records: ManagementRevenueRecord[], platform: CreatorPlatform): ManagementRankingRow[] {
  const rows = new Map<string, ManagementRankingRow>();
  records.filter((record) => record.platform === platform).forEach((record) => {
    const id = `${platform}:${record.creator?.creator_entity_id ?? record.creator_profile_id}`;
    const current = rows.get(id) ?? { id, label: getManagementRecordCreatorName(record), tiktok: 0, douyin: 0, firstCreatedAt: null };
    current[platform] += record.revenue_amount;
    current.firstCreatedAt = getEarlierCreatedAt(current.firstCreatedAt, record.created_at);
    rows.set(id, current);
  });
  return sortManagementRankingRows(Array.from(rows.values()), platform);
}

function sortManagementRankingRows(rows: ManagementRankingRow[], view: ManagementRankingView) {
  return rows.sort((first, second) => {
    const firstValue = first[view];
    const secondValue = second[view];
    if (secondValue !== firstValue) return secondValue - firstValue;
    const firstCreatedAtCompare = compareFirstCreatedAt(first.firstCreatedAt, second.firstCreatedAt);
    if (firstCreatedAtCompare !== 0) return firstCreatedAtCompare;
    return first.id.localeCompare(second.id);
  });
}

function getFirstCreatedAt(records: Array<{ created_at?: string | null }>) {
  return records.reduce<number | null>((firstCreatedAt, record) => getEarlierCreatedAt(firstCreatedAt, record.created_at), null);
}

function getEarlierCreatedAt(firstCreatedAt: number | null, createdAt?: string | null) {
  const timestamp = createdAt ? new Date(createdAt).getTime() : Number.NaN;
  if (!Number.isFinite(timestamp)) return firstCreatedAt;
  return firstCreatedAt === null || timestamp < firstCreatedAt ? timestamp : firstCreatedAt;
}

function compareFirstCreatedAt(first: number | null, second: number | null) {
  if (first === null) return second === null ? 0 : 1;
  if (second === null) return -1;
  return first - second;
}

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthRange(startMonth: string, endMonth: string) {
  const start = startMonth <= endMonth ? startMonth : endMonth;
  const end = startMonth <= endMonth ? endMonth : startMonth;
  const months: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    months.push(cursor);
    cursor = shiftMonth(cursor, 1);
    if (months.length > 36) break;
  }
  return months;
}

function formatCompactNumber(value: number) {
  if (value >= 100000000) return `${formatRevenueAmount(value / 100000000)}亿`;
  if (value >= 10000) return `${formatRevenueAmount(value / 10000)}万`;
  return formatRevenueAmount(value);
}

function getManagementRecordCreatorName(record: ManagementRevenueRecord) {
  return record.creator?.creator_name || record.creator?.platform_account || record.platform_uid || '-';
}

function getManagementRecordAgentName(record: ManagementRevenueRecord) {
  return getEmployeeName(record.reportingManager) || '未分配经纪人';
}

function getManagementRecordTypeLabel(record: ManagementRevenueRecord) {
  return record.creator?.creator_type ? creatorTypeLabels[record.creator.creator_type] : '-';
}

function getManagementRecordRegion(record: ManagementRevenueRecord) {
  return record.creator?.region?.code ?? record.creator?.region?.name ?? '-';
}

type CreatorCalendarEvent = {
  id: string;
  group: CreatorProfileGroup;
  type: CreatorCalendarMilestoneType | 'activity';
  date: string;
  title?: string;
  activity?: CreatorActivity;
};

function CreatorCalendarPanel(props: { loading: boolean; creators: PersonalManagerCreatorProfile[]; activities: CreatorActivity[]; currentEmployeeId: string | null; month: string; type: '' | CreatorCalendarMilestoneType; activityType: '' | CreatorActivityType; onMonth: (month: string) => void; onType: (type: '' | CreatorCalendarMilestoneType) => void; onActivityType: (type: '' | CreatorActivityType) => void; onView: (group: CreatorProfileGroup) => void; onActivity: (activity: CreatorActivity) => void; onMilestone: (event: CreatorCalendarEvent) => void; onAddActivity: () => void }) {
  const groups = useMemo(() => groupCreatorProfiles(props.creators, props.currentEmployeeId), [props.creators, props.currentEmployeeId]);
  const events = useMemo(() => {
    const milestones = groups.flatMap((group) => getCreatorMilestones(group.profiles, Number(props.month.slice(0, 4))).map((milestone) => ({ id: `${group.id}:${milestone.type}`, group, ...milestone })));
    const activities = props.activities.flatMap((activity) => { const group = groups.find((item) => item.id === `entity:${activity.creator_entity_id}`); return group ? [{ id: activity.id, group, type: 'activity' as const, date: activity.activity_date, title: activity.title, activity }] : []; });
    return [...milestones, ...activities].filter((event) => (!props.type || event.type === props.type) && (!props.activityType || event.type !== 'activity' || event.activity?.activity_type === props.activityType));
  }, [groups, props.activities, props.month, props.type, props.activityType]);
  const todayIso = new Date().toISOString().slice(0, 10);
  const tomorrowIso = shiftIsoDate(todayIso, 1);
  const weekEndIso = shiftIsoDate(todayIso, 7);
  const monthEvents = events.filter((event) => event.date.startsWith(props.month));
  const days = getCalendarDays(props.month);
  const eventsByDate = new Map<string, CreatorCalendarEvent[]>();
  monthEvents.forEach((event) => eventsByDate.set(event.date, [...(eventsByDate.get(event.date) ?? []), event]));
  const upcoming = events.filter((event) => event.date >= todayIso && event.date <= weekEndIso).sort((a, b) => a.date.localeCompare(b.date));
  const changeMonth = (amount: number) => props.onMonth(shiftMonth(props.month, amount));

  return <div className="agent-creator-calendar">
    <div className="agent-calendar-summary-grid">
      <CalendarStat title="今日安排" value={events.filter((event) => event.date === todayIso).length} icon={<Clock3 size={17} />} tone="today" />
      <CalendarStat title="未来7天" value={upcoming.length} icon={<CalendarDays size={17} />} tone="week" />
      <CalendarStat title="百日节点" value={events.filter((event) => event.type === '100_days').length} icon={<Leaf size={17} />} tone="hundred" />
      <CalendarStat title="本月安排" value={monthEvents.length} icon={<CalendarCheck size={17} />} tone="month" />
    </div>
    <div className="agent-calendar-toolbar">
      <div className="agent-calendar-month-control"><button className="icon-button" type="button" aria-label="上一月" onClick={() => changeMonth(-1)}><ChevronLeft size={18} /></button><strong>{formatCalendarMonth(props.month)}</strong><button className="icon-button" type="button" aria-label="下一月" onClick={() => changeMonth(1)}><ChevronRight size={18} /></button><button className="secondary-button compact-button" type="button" onClick={() => props.onMonth(currentMonth)}>今天</button><label className="form-field agent-calendar-type-filter"><span>活动类型</span><select value={props.activityType} onChange={(event) => props.onActivityType(event.target.value as '' | CreatorActivityType)}><option value="">全部</option>{Object.entries(creatorActivityTypeLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label></div>
      <div className="agent-calendar-toolbar-actions"><button className="primary-button compact-button agent-calendar-add-button" type="button" onClick={props.onAddActivity}><Plus size={16} />新增活动</button></div>
    </div>
    {props.loading ? <div className="table-state">正在读取主播日历...</div> : <div className="agent-calendar-layout">
      <section className="agent-calendar-month"><div className="agent-calendar-weekdays">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>周{day}</span>)}</div><div className="agent-calendar-grid">{days.map((day) => { const isCurrentMonth = day.month === props.month; const dayEvents = isCurrentMonth ? eventsByDate.get(day.iso) ?? [] : []; return <div className={`agent-calendar-day${isCurrentMonth ? '' : ' is-outside'}${day.iso === todayIso && isCurrentMonth ? ' is-today' : ''}`} key={day.iso}><span>{day.day}</span>{isCurrentMonth ? <>{dayEvents.slice(0, 2).map((event) => <button key={event.id} type="button" className={`agent-calendar-event agent-calendar-event--${event.type}`} onClick={() => event.type === 'activity' && event.activity ? props.onActivity(event.activity) : props.onMilestone(event)}>{event.group.displayName} · {event.type === 'activity' ? event.title : creatorCalendarMilestoneLabels[event.type]}</button>)}{dayEvents.length > 2 ? <small>+{dayEvents.length - 2} 个安排</small> : null}</> : null}</div>; })}</div></section>
      <aside className="agent-calendar-upcoming"><h3>近期节点</h3><CalendarEventList title="今天" events={upcoming.filter((event) => event.date === todayIso)} onView={props.onView} /><CalendarEventList title="明天" events={upcoming.filter((event) => event.date === tomorrowIso)} onView={props.onView} /><CalendarEventList title="未来7天" events={upcoming.filter((event) => event.date > tomorrowIso)} onView={props.onView} /><CalendarQuickFilters value={props.type} onChange={props.onType} /></aside>
      <section className="agent-calendar-mobile-agenda"><CalendarQuickFilters value={props.type} onChange={props.onType} />{monthEvents.length === 0 ? <div className="table-state">本月暂无节点。</div> : groupCalendarEventsByDate(monthEvents).map(([date, items]) => <div key={date} className="agent-calendar-agenda-day"><strong>{formatCalendarDate(date)}</strong>{items.map((event) => <CalendarEventCard key={event.id} event={event} onView={props.onView} />)}</div>)}</section>
    </div>}
  </div>;
}

function CalendarStat({ title, value, icon, tone }: { title: string; value: number; icon: ReactNode; tone: 'today' | 'week' | 'hundred' | 'month' }) { return <article className={`agent-calendar-stat agent-calendar-stat--${tone}`}><span>{icon}{title}</span><strong>{value}</strong></article>; }
function CalendarEventList({ title, events, onView }: { title: string; events: CreatorCalendarEvent[]; onView: (group: CreatorProfileGroup) => void }) { return <section className="agent-calendar-upcoming-section"><h4>{title}</h4>{events.length ? events.map((event) => <CalendarEventCard key={event.id} event={event} onView={onView} />) : <p>暂无节点</p>}</section>; }
function CalendarEventCard({ event, onView }: { event: CreatorCalendarEvent; onView: (group: CreatorProfileGroup) => void }) { return <button type="button" className={`agent-calendar-event-card agent-calendar-event-card--${event.type}`} onClick={() => onView(event.group)}><span><b>{event.group.displayName}</b><em>{event.type === 'activity' ? event.title : creatorCalendarMilestoneLabels[event.type]}</em></span><small>{formatCalendarDate(event.date)} · {Array.from(event.group.platforms).map((platform) => platformLabels[platform]).join(' / ')}</small></button>; }
function CalendarQuickFilters({ value, onChange }: { value: '' | CreatorCalendarMilestoneType; onChange: (type: '' | CreatorCalendarMilestoneType) => void }) { return <section className="agent-calendar-quick-filters"><h4>快速筛选</h4><div>{([{ type: '', label: '全部' }, ...Object.entries(creatorCalendarMilestoneLabels).map(([type, label]) => ({ type: type as CreatorCalendarMilestoneType, label }))] as Array<{ type: '' | CreatorCalendarMilestoneType; label: string }>).map((item) => <button key={item.type || 'all'} type="button" className={`agent-calendar-filter-chip agent-calendar-filter-chip--${item.type || 'all'}${value === item.type ? ' active' : ''}`} onClick={() => onChange(item.type)}>{item.label}</button>)}</div></section>; }

function CreatorDataPanel(props: {
  loading: boolean;
  search: string;
  platform: string;
  creatorType: string;
  status: string;
  completeness: string;
  regionId: string;
  options: AgentOptions;
  creators: PersonalManagerCreatorProfile[];
  currentEmployeeId: string | null;
  onSearch: (value: string) => void;
  onPlatform: (value: string) => void;
  onCreatorType: (value: string) => void;
  onStatus: (value: string) => void;
  onCompleteness: (value: string) => void;
  onRegion: (value: string) => void;
  onReset: () => void;
  onView: (group: CreatorProfileGroup) => void;
  onAdjustment: (group: CreatorProfileGroup, creatorProfile?: CreatorProfile) => void;
}) {
  const creatorGroups = useMemo(() => {
    const groups = groupCreatorProfiles(props.creators, props.currentEmployeeId);
    return filterCreatorGroups(groups, {
      search: props.search,
      platform: props.platform,
      creatorType: props.creatorType,
      status: props.status,
      completeness: props.completeness,
    });
  }, [props.completeness, props.creatorType, props.creators, props.currentEmployeeId, props.platform, props.search, props.status]);
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
          <section className="agent-creator-list-card">
            <div className="agent-creator-list-header" aria-live="polite">共 <strong>{creatorGroups.length}</strong> 位主播</div>
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
                        <button className="secondary-button compact-button agent-creator-view-button" type="button" onClick={() => props.onView(group)}><Eye size={15} />查看资料</button>
                        <button className="secondary-button compact-button agent-creator-adjust-button" type="button" onClick={() => props.onAdjustment(group)}><RefreshCw size={15} />申请修改</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </section>
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
                  <button className="secondary-button compact-button agent-creator-view-button" type="button" onClick={() => props.onView(group)}><Eye size={15} />查看资料</button>
                  <button className="secondary-button compact-button agent-creator-adjust-button" type="button" onClick={() => props.onAdjustment(group)}><RefreshCw size={15} />申请修改</button>
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
  profiles: PersonalManagerCreatorProfile[];
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
      <CreatorSummaryCard title="我的主播" value={summary.total} tone="blue" icon={<UserRound size={19} />} />
      <CreatorSummaryCard title="TikTok" value={summary.tiktok} tone="pink" icon={<img src={tiktokLogoUrl} alt="" aria-hidden="true" />} />
      <CreatorSummaryCard title="抖音" value={summary.douyin} tone="green" icon={<img src={douyinLogoUrl} alt="" aria-hidden="true" />} />
      <CreatorSummaryCard title="双平台" value={summary.dualPlatform} tone="purple" icon={<Layers3 size={19} />} />
      <CreatorSummaryCard title="待补资料" value={summary.incomplete} tone="orange" icon={<FileWarning size={19} />} />
    </div>
  );
}

function CreatorSummaryCard({ title, value, icon, tone }: { title: string; value: number; icon: ReactNode; tone: 'blue' | 'pink' | 'green' | 'purple' | 'orange' }) {
  return (
    <article className={`agent-creator-summary-card agent-creator-summary-card--${tone}`}>
      <span className="agent-creator-summary-icon" aria-hidden="true">{icon}</span>
      <div className="agent-creator-summary-content"><span className="agent-creator-summary-title">{title}</span><strong>{value.toLocaleString('en-MY')}</strong></div>
      <ArrowUpRight className="agent-creator-summary-arrow" size={17} aria-hidden="true" />
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
  onReset: () => void;
}) {
  return (
    <div className="agent-creator-filters">
      <label className="form-field agent-creator-search-field">
        <span>搜索</span>
        <span className="agent-creator-search-input"><Search size={16} aria-hidden="true" /><input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="主播名 / UID / 平台账号" /></span>
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
      <button className="secondary-button agent-creator-reset-button" type="button" onClick={props.onReset}><RefreshCw size={15} />重置</button>
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

function CreatorDetailDrawer({ group, currentEmployeeId, onClose, onAdjustment }: { group: CreatorProfileGroup; currentEmployeeId: string | null; onClose: () => void; onAdjustment: (creatorProfile?: CreatorProfile) => void }) {
  const secondaryManagerName = group.profiles.find((creator) => creator.secondary_manager_display_name)?.secondary_manager_display_name ?? '—';
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
              <DrawerField label="主经纪人" value={group.managerName} />
              <DrawerField label="第二位经纪人" value={secondaryManagerName} />
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
                <DrawerField label="银行" value={creator.manager_employee_id === currentEmployeeId ? creator.bank_name || '-' : '-'} />
                <DrawerField label="银行户口" value={creator.manager_employee_id === currentEmployeeId ? creator.bank_account || '-' : '-'} />
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
              {['to_company', 'to_5_1', 'change_bank'].includes(request.request_type) ? <DrawerField label="银行账户名字" value={request.bank_account_name ?? '-'} /> : null}
              {['to_company', 'to_5_1', 'change_bank'].includes(request.request_type) ? <DrawerField label="银行名字" value={request.bank_name ?? '-'} /> : null}
              {['to_company', 'to_5_1', 'change_bank'].includes(request.request_type) ? <DrawerField label="银行账号" value={request.bank_account ?? '-'} /> : null}
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
          {values.request_type !== 'special' ? <TextField label={values.platform === 'tiktok' ? 'TikTok User ID' : '抖音 User ID'} value={values.platform_user_id} onChange={(value) => onChange({ ...values, platform_user_id: value })} required /> : null}
          {needsEffective ? <TextField label="生效日期" type="date" value={values.effective_date} onChange={(value) => onChange({ ...values, effective_date: value })} /> : null}
          {needsBank ? (
            <>
              <TextField label="全名" value={values.full_name} onChange={(value) => onChange({ ...values, full_name: value })} />
              <TextField label="银行账户名字" value={values.bank_account_name} onChange={(value) => onChange({ ...values, bank_account_name: value })} />
              <TextField label="银行名字" value={values.bank_name} onChange={(value) => onChange({ ...values, bank_name: value })} />
              <TextField label="银行账号" value={values.bank_account} onChange={(value) => onChange({ ...values, bank_account: value })} />
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
  return <SystemModal title="添加新申请" ariaLabel="美工申请" onClose={onClose} footer={<><button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button><button className="primary-button compact-button" type="submit" form="design-form" disabled={saving}>提交</button></>}><form id="design-form" onSubmit={onSubmit}><div className="form-grid"><SelectField label="申请类型" value={values.request_type} onChange={(value) => onChange({ ...values, request_type: value as DesignRequestType })}>{designTypes.map((type) => <option key={type} value={type}>{designTypeLabels[type]}</option>)}</SelectField>{!isSpecial ? <><SelectField label="平台" value={values.platform} onChange={(value) => onChange({ ...values, platform: value as CreatorPlatform })}><option value="tiktok">TikTok</option><option value="douyin">抖音</option></SelectField><TextField label={values.platform === 'tiktok' ? 'TikTok User ID' : '抖音 User ID'} value={values.platform_user_id} onChange={(value) => onChange({ ...values, platform_user_id: value })} /><TextField label={values.platform === 'tiktok' ? 'TikTok 名字' : '抖音名字'} value={values.creator_name} onChange={(value) => onChange({ ...values, creator_name: value })} /><TextField label={values.platform === 'tiktok' ? 'TikTok 用户名' : '抖音用户名'} value={values.platform_account} onChange={(value) => onChange({ ...values, platform_account: value })} /></> : null}{!isSpecial && !isPoster ? <><TextField label="粉丝昵称" value={values.fan_nickname} onChange={(value) => onChange({ ...values, fan_nickname: value })} /><TextField label="粉丝灯牌等级 / 财富等级" value={values.fan_level} onChange={(value) => onChange({ ...values, fan_level: value })} /><SelectField label="打印方式" value={values.print_method} onChange={(value) => onChange({ ...values, print_method: value as DesignFormValues['print_method'] })}>{Object.entries(printMethodLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</SelectField></> : null}{!isSpecial ? <TextField label={isPoster ? '海报内容' : '设计内容'} value={values.design_content} onChange={(value) => onChange({ ...values, design_content: value })} /> : null}{isPoster ? <TextField label="设计元素" value={values.design_elements} onChange={(value) => onChange({ ...values, design_elements: value })} /> : null}{isSpecial ? <label className="form-field form-field-wide"><span>自由需求说明</span><textarea value={values.special_content} onChange={(event) => onChange({ ...values, special_content: event.target.value })} /></label> : null}<label className="form-field form-field-wide"><span>参考图片链接（每行一个，未来可接文件上传）</span><textarea value={values.reference_urls} onChange={(event) => onChange({ ...values, reference_urls: event.target.value })} /></label></div></form></SystemModal>;
}

type OperationStatus = 'missing' | 'filled' | 'unverified';
type OperationCellStatus = OperationStatus | 'future';
type OperationPlatformFilter = '' | CreatorPlatform | 'dual_platform';
type OperationQuickRange = 'previous' | 'month' | 'last30' | 'custom' | 'year';
type RevenuePeriodRange = {
  startIso: string;
  endIso: string;
  label: string;
  shortLabel: string;
  periodNo: number;
};
type OperationDateRange = {
  startIso: string;
  endIso: string;
};
type OperationFilters = {
  revenueCycle: '' | 'weekly' | 'monthly' | 'none';
  quickRange: OperationQuickRange;
  status: '' | OperationStatus;
  platform: OperationPlatformFilter;
  creatorType: '' | '5+1' | 'non_5_1';
  priority: '' | 'priority' | 'normal';
  managerEmployeeId: string;
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
  sortValue: number;
  firstCreatedAt: number | null;
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
  const permissions = usePermissions();
  const todayIso = useMemo(() => formatLocalDate(new Date()), []);
  const todayMonth = todayIso.slice(0, 7);
  const monthDateRange = useMemo(() => getMonthDateRange(props.month), [props.month]);
  const [periodsByMonth, setPeriodsByMonth] = useState<Record<string, RevenuePeriodRange[]>>({});
  const [periodLoading, setPeriodLoading] = useState(false);
  const [periodError, setPeriodError] = useState('');
  const currentPeriod = useMemo(() => findRevenuePeriodForDate(periodsByMonth[todayMonth] ?? [], todayIso), [periodsByMonth, todayIso, todayMonth]);
  const currentPreviousPeriod = useMemo(() => getPreviousRevenuePeriod(currentPeriod, periodsByMonth), [currentPeriod, periodsByMonth]);
  const [filters, setFilters] = useState<OperationFilters>({
    quickRange: 'month',
    revenueCycle: '',
    status: '',
    platform: '',
    creatorType: '',
    priority: '',
    managerEmployeeId: '',
    search: '',
    periodStart: '',
    customStart: monthDateRange.startIso,
    customEnd: monthDateRange.endIso,
  });
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [recordsByPeriod, setRecordsByPeriod] = useState<Record<string, Record<string, WeeklyRevenueRecord>>>({});
  const [previousRecords, setPreviousRecords] = useState<Record<string, WeeklyRevenueRecord>>({});
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyRefreshRevision, setWeeklyRefreshRevision] = useState(0);
  const [featureUnavailable, setFeatureUnavailable] = useState(false);
  const [message, setMessage] = useState('');
  const [activeRow, setActiveRow] = useState<OperationRow | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [managerOptions, setManagerOptions] = useState<RevenueRepresentativeOption[]>([]);
  const [creatorEntityCount, setCreatorEntityCount] = useState<number | null>(null);
  const [monthContexts, setMonthContexts] = useState<RevenueMonthContext[]>([]);
  const [contextKey, setContextKey] = useState('');
  const [contextError, setContextError] = useState('');
  const [contextRefreshRevision, refreshContexts] = useState(0);
  const contextIds = useMemo(() => props.creators.map(creator => creator.id).sort().join(','), [props.creators]);
  const expectedContextKey = `${props.month}:${contextIds}`;
  const previousContextMonth = currentPreviousPeriod?.startIso.slice(0,7) ?? '';
  const [previousContexts, setPreviousContexts] = useState<RevenueMonthContext[]>([]);
  const [previousContextKey, setPreviousContextKey] = useState('');
  const expectedPreviousKey = `${previousContextMonth}:${contextIds}`;
  useEffect(() => {
    let active = true; setPreviousContextKey('');
    if (!previousContextMonth) return;
    revenueCycleService.monthContext(contextIds ? contextIds.split(',') : [], previousContextMonth).then(contexts => { if (active) { setPreviousContexts(contexts); setPreviousContextKey(expectedPreviousKey); } }).catch(() => { if (active) setPreviousContexts([]); });
    return () => { active = false; };
  }, [previousContextMonth, contextIds, expectedPreviousKey, contextRefreshRevision]);
  useEffect(() => {
    let active = true; setContextError(''); setContextKey('');
    revenueCycleService.monthContext(contextIds ? contextIds.split(',') : [], props.month).then(contexts => {
      if (active) { setMonthContexts(contexts); setContextKey(expectedContextKey); }
    }).catch(() => { if (active) setContextError('读取有效流水周期失败，请刷新；未核验的周期不会开放填写。'); });
    return () => { active = false; };
  }, [expectedContextKey, contextIds, props.month, contextRefreshRevision]);
  const sortedCreators = useMemo(() => {
    if (contextKey !== expectedContextKey) return [];
    const contexts = new Map(monthContexts.map(context => [context.creator_profile_id, context]));
    return sortOperationCreators(props.creators.filter((creator: PersonalManagerCreatorProfile) => creator.membership_status === 'active' && contexts.has(creator.id)).map(creator => ({ ...creator, current_revenue_cycle: creator.revenue_cycle, revenue_cycle: rosterCycle(creator.revenue_cycle, contexts.get(creator.id)!), revenueMonthContext: contexts.get(creator.id) })));
  }, [props.creators, monthContexts, contextKey, expectedContextKey]);
  function updateMonthlyRecord(record: MonthlyRevenueRecord | null) {
    if (!record) { refreshContexts(value => value + 1); return; }
    if (record.revenue_month.slice(0, 7) !== props.month) return;
    setMonthContexts(contexts => contexts.map(context => context.creator_profile_id === record.creator_profile_id ? { ...context, monthly_record: record } : context));
  }
  const effectiveDateRange = useMemo(() => getOperationEffectiveDateRange(filters.quickRange, {
    monthDateRange,
    previousPeriod: currentPreviousPeriod,
    customStart: filters.customStart,
    customEnd: filters.customEnd,
    todayIso,
  }), [currentPreviousPeriod, filters.customEnd, filters.customStart, filters.quickRange, monthDateRange, todayIso]);
  const effectiveMonths = useMemo(() => getMonthsForDateRange(effectiveDateRange), [effectiveDateRange]);
  const monthsToLoad = useMemo(() => uniqueValues([props.month, todayMonth, ...effectiveMonths].filter(Boolean)), [effectiveMonths, props.month, todayMonth]);
  const effectivePeriodOptions = useMemo(() => getRevenuePeriodsForDateRange(effectiveDateRange, periodsByMonth), [effectiveDateRange, periodsByMonth]);
  const selectedPeriod = useMemo(() => effectivePeriodOptions.find((period) => period.startIso === filters.periodStart) ?? effectivePeriodOptions[0], [effectivePeriodOptions, filters.periodStart]);
  const settingsMonth = effectiveMonths.length === 1 ? effectiveMonths[0] : props.month;
  const settingsMonthPeriods = periodsByMonth[settingsMonth] ?? [];
  const reminderPreviousPeriod = settingsMonth === todayMonth ? currentPreviousPeriod : null;
  const canSetPeriods = permissions.canUse('agent-revenue-period-settings');

  useEffect(() => {
    let active = true;
    setCreatorEntityCount(null);
    agentService.getManagementRevenueCreatorEntityCount(props.regionId)
      .then((count) => { if (active) setCreatorEntityCount(count); })
      .catch(() => { if (active) setCreatorEntityCount(null); });
    return () => { active = false; };
  }, [props.regionId]);

  useEffect(() => {
    let active = true;
    if (!permissions.isSuperAdmin) {
      setManagerOptions([]);
      return () => { active = false; };
    }

    agentService.listCurrentRevenueRepresentativeOptions(props.regionId)
      .then((options) => { if (active) setManagerOptions(options); })
      .catch(() => { if (active) setManagerOptions([]); });

    return () => { active = false; };
  }, [permissions.isSuperAdmin, props.regionId]);

  useEffect(() => {
    if (!filters.managerEmployeeId) return;
    const selectedManager = managerOptions.find((manager) => manager.id === filters.managerEmployeeId);
    if (!selectedManager) {
      setFilters((current) => ({ ...current, managerEmployeeId: '' }));
    }
  }, [filters.managerEmployeeId, managerOptions]);

  useEffect(() => {
    if (effectivePeriodOptions.length === 0) return;
    setFilters((current) => effectivePeriodOptions.some((period) => period.startIso === current.periodStart) ? current : { ...current, periodStart: effectivePeriodOptions[0].startIso });
  }, [effectivePeriodOptions]);

  useEffect(() => {
    let active = true;
    const missingMonths = monthsToLoad.filter((month) => !periodsByMonth[month]);
    if (missingMonths.length === 0) return;

    setPeriodLoading(true);
    setPeriodError('');
    Promise.all(missingMonths.map((month) => agentService.listRevenuePeriodSettings(month).then((items) => [month, mapRevenuePeriodSettingsToRanges(items)] as const)))
      .then((entries) => {
        if (!active) return;
        setPeriodsByMonth((current) => ({ ...current, ...Object.fromEntries(entries) }));
      })
      .catch((loadError) => {
        if (!active) return;
        setPeriodError(`读取流水周期失败：${getErrorMessage(loadError)}`);
      })
      .finally(() => {
        if (active) setPeriodLoading(false);
      });

    return () => {
      active = false;
    };
  }, [monthsToLoad, periodsByMonth]);

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
    const previousPromise = currentPreviousPeriod
      ? agentService.listWeeklyRevenueRecords({ creatorProfileIds, weekStartDate: currentPreviousPeriod.startIso })
      : Promise.resolve([]);
    Promise.all([
      Promise.all(effectivePeriodOptions.map((period) => agentService.listWeeklyRevenueRecords({ creatorProfileIds, weekStartDate: period.startIso }))),
      previousPromise,
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
  }, [currentPreviousPeriod, effectivePeriodOptions, sortedCreators, weeklyRefreshRevision]);

  const currentRows = useMemo(
    () => buildOperationStreamerRows(sortedCreators, effectivePeriodOptions, recordsByPeriod, filters, todayIso),
    [effectivePeriodOptions, filters, recordsByPeriod, sortedCreators, todayIso],
  );
  const filteredCurrentRows = useMemo(() => filterOperationStreamerRows(currentRows, filters).sort(sortOperationStreamerRows), [currentRows, filters]);
  const summary = useMemo(() => summarizeEffectiveRevenueRows(currentRows), [currentRows]);
  const previousMissingCount = useMemo(() => (
    reminderPreviousPeriod ? sortedCreators.filter((creator) => previousContextKey === expectedPreviousKey && isPreviousWeeklyReminderEligible(creator, previousContexts.find(context => context.creator_profile_id === creator.id)) && !previousRecords[creator.id]).length : 0
  ), [previousRecords, reminderPreviousPeriod, sortedCreators, previousContexts, previousContextKey, expectedPreviousKey]);
  const pageCount = Math.max(1, Math.ceil(filteredCurrentRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paginatedCurrentRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredCurrentRows.slice(start, start + pageSize);
  }, [filteredCurrentRows, pageSize, safePage]);

  function updateFilter<Key extends keyof OperationFilters>(key: Key, value: OperationFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetRowFilters() {
    setFilters((current) => ({ ...current, status: '', platform: '', creatorType: '', priority: '', managerEmployeeId: '', search: '', revenueCycle: '' }));
  }

  function updateMonth(value: string) {
    props.onMonth(value);
    setFilters((current) => ({ ...current, periodStart: periodsByMonth[value]?.[0]?.startIso ?? current.periodStart }));
  }

  function updateQuickRange(value: OperationQuickRange) {
    if (value === 'previous') {
      if (!currentPreviousPeriod) return;
      const previousMonth = currentPreviousPeriod.startIso.slice(0, 7);
      props.onMonth(previousMonth);
      setFilters((current) => ({ ...current, quickRange: value, status: 'missing', periodStart: currentPreviousPeriod.startIso }));
      return;
    }
    if (value === 'month') {
      const currentMonth = currentPeriod?.startIso.slice(0, 7) ?? todayMonth;
      props.onMonth(currentMonth);
      setFilters((current) => ({ ...current, quickRange: value, periodStart: currentPeriod?.startIso ?? periodsByMonth[currentMonth]?.[0]?.startIso ?? current.periodStart }));
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
    if (!reminderPreviousPeriod) return;
    const previousMonth = reminderPreviousPeriod.startIso.slice(0, 7);
    props.onMonth(previousMonth);
    setFilters((current) => ({ ...current, quickRange: 'previous', status: 'missing', periodStart: reminderPreviousPeriod.startIso }));
  }

  function updateRecord(record: WeeklyRevenueRecord, successMessage = '周期流水已保存。') {
    setRecordsByPeriod((current) => ({
      ...current,
      [record.week_start_date]: {
        ...(current[record.week_start_date] ?? {}),
        [record.creator_profile_id]: record,
      },
    }));
    setMessage(successMessage);
    setActiveRow(null);
  }

  function refreshRevenueWorkbench() {
    setWeeklyRefreshRevision((current) => current + 1); refreshContexts(current => current + 1);
    props.onRefresh();
  }

  function updateSettingsMonthPeriods(periods: RevenuePeriodRange[]) {
    setPeriodsByMonth((current) => ({ ...current, [settingsMonth]: periods }));
    setFilters((current) => ({ ...current, periodStart: periods.some((period) => period.startIso === current.periodStart) ? current.periodStart : periods[0]?.startIso ?? '' }));
    setRecordsByPeriod({});
    setPreviousRecords({});
  }

  return (
    <div className="staff-list-panel agent-operation-page agent-period-workbench">
      {message ? <p className="form-success agent-operation-alert">{message}</p> : null}
      {featureUnavailable ? <p className="form-alert agent-operation-alert">周期流水数据库 003 尚未启用，暂不能保存新周期流水。</p> : null}
      {periodError ? <p className="form-alert agent-operation-alert">{periodError}</p> : null}{contextError ? <p className="form-alert agent-operation-alert">{contextError}</p> : null}{monthContexts.some(context => context.cycle_source === 'LEGACY_CURRENT_WEEKLY') ? <p className="field-help">旧档案按当前周流水设置兼容填写；历史周期仍未经核验，未创建历史基线。</p> : null}{monthContexts.some(context => context.cycle_source === 'LEGACY_UNKNOWN') ? <p className="form-alert agent-operation-alert">所选月份存在未经核验的历史周期：保留历史记录只读，不推断填写义务或适用周期统计。</p> : null}

      {featureUnavailable ? null : (
        <>
          <div className="agent-operation-kpi-grid">
            <OperationKpiCard label="总人数" value={creatorEntityCount == null ? '-' : `${creatorEntityCount} 人`} detail="全部主播" tone="overview" />
            <OperationKpiCard label="TikTok 总钻石" value={formatRevenueAmount(summary.tiktokTotal)} detail="钻石" tone="tiktok" icon={<img src={tiktokLogoUrl} alt="" aria-hidden="true" />} />
            <OperationKpiCard label="抖音总音浪" value={formatRevenueAmount(summary.douyinTotal)} detail="音浪" tone="douyin" icon={<img src={douyinLogoUrl} alt="" aria-hidden="true" />} />
            <OperationKpiCard label="已填写" value={summary.filled} detail="可填写周期" tone="filled" />
            <OperationKpiCard label="未填写" value={summary.missing} detail="可填写周期" tone="missing" />
          </div>

          {reminderPreviousPeriod && previousContextKey === expectedPreviousKey && sortedCreators.some(creator => isPreviousWeeklyReminderEligible(creator, previousContexts.find(context => context.creator_profile_id === creator.id))) ? (
            <div className={`agent-period-previous-alert agent-period-previous-alert--${previousMissingCount > 0 ? 'missing' : 'filled'}`}>
              <div>
                <i aria-hidden="true">!</i>
                <span>{previousMissingCount > 0 ? `上周期「${formatPeriodTitle(reminderPreviousPeriod)}」还有 ${previousMissingCount} 个平台账号未填写流水` : '上周期流水已全部填写'}</span>
              </div>
              {previousMissingCount > 0 ? <button className="secondary-button compact-button" type="button" onClick={viewPreviousMissing}>查看未填写</button> : null}
            </div>
          ) : null}

          <OperationFilterBar
            month={props.month} onMonth={updateMonth}
            filters={filters}
            effectiveDateRange={effectiveDateRange}
            regionId={props.regionId}
            regions={props.options.regions}
            canFilterManagers={permissions.isSuperAdmin}
            managerOptions={managerOptions}
            onQuickRange={updateQuickRange}
            onFilter={updateFilter}
            onRegion={props.onRegion}
            onRefresh={refreshRevenueWorkbench}
            refreshing={props.loading || weeklyLoading || periodLoading}
            canSetPeriods={canSetPeriods}
            onOpenPeriodSettings={() => setPeriodModalOpen(true)}
            onResetFilters={resetRowFilters}
          />

          <CurrentOperationTable
            loading={props.loading || weeklyLoading || (contextKey !== expectedContextKey && !contextError) || (periodLoading && effectivePeriodOptions.length === 0)}
            rows={paginatedCurrentRows}
            allRows={filteredCurrentRows}
            periods={effectivePeriodOptions}
            month={props.month} onMonthlySaved={updateMonthlyRecord}
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

      {!featureUnavailable && periodModalOpen ? (
        <RevenuePeriodSettingsModal
          key={settingsMonth}
          month={settingsMonth}
          periods={settingsMonthPeriods}
          saving={periodLoading}
          onClose={() => setPeriodModalOpen(false)}
          onSaved={(periods) => {
            updateSettingsMonthPeriods(periods);
            setPeriodModalOpen(false);
            setMessage('本月流水周期已保存。');
          }}
        />
      ) : null}
    </div>
  );
}

function OperationKpiCard({ label, value, detail, tone, icon }: { label: string; value: ReactNode; detail?: string; tone?: OperationStatus | 'overview' | 'tiktok' | 'douyin'; icon?: ReactNode }) {
  return <article className={`agent-operation-kpi-card ${tone ? `agent-operation-kpi-card--${tone}` : ''}`}><div className="agent-period-kpi-head"><span>{label}</span>{icon ? <i>{icon}</i> : null}</div><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</article>;
}

function OperationFilterBar(props: {
  month: string; onMonth: (value: string) => void;
  filters: OperationFilters;
  effectiveDateRange: OperationDateRange;
  regionId: string;
  regions: AgentOptions['regions'];
  canFilterManagers: boolean;
  managerOptions: RevenueRepresentativeOption[];
  onQuickRange: (value: OperationQuickRange) => void;
  onFilter: <Key extends keyof OperationFilters>(key: Key, value: OperationFilters[Key]) => void;
  onRegion: (value: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  canSetPeriods: boolean;
  onOpenPeriodSettings: () => void;
  onResetFilters: () => void;
}) {
  const dateRangeLabel = formatDateRangeText(props.effectiveDateRange.startIso, props.effectiveDateRange.endIso);

  return (
    <div className="agent-operation-filter-panel">
      <p className="agent-operation-filter-description">重点关注根据主播资料中的「主播管理设置」自动同步；如需调整，请前往主播资料编辑。</p>
      <div className="agent-operation-filter-row agent-operation-filter-row--primary" style={{ flexWrap: 'wrap' }}>
        <label className="form-field"><span>月份</span><MonthSelect value={props.month} onChange={props.onMonth} /></label><div className="agent-operation-quick-range" role="group" aria-label="时间范围">
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
        <SelectField label="流水周期" value={props.filters.revenueCycle} onChange={(value) => props.onFilter('revenueCycle', value as OperationFilters['revenueCycle'])}>
          <option value="">全部</option>
          <option value="weekly">周流水</option>
          <option value="monthly">月流水</option>
          <option value="none">不需要填写</option>
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
        {props.canFilterManagers ? (
          <SearchableRevenueManagerFilter
            value={props.filters.managerEmployeeId}
            options={props.managerOptions}
            onChange={(value) => props.onFilter('managerEmployeeId', value)}
          />
        ) : null}
        <SelectField label="状态" value={props.filters.status} onChange={(value) => props.onFilter('status', value as OperationFilters['status'])}>
          <option value="">全部</option>
          <option value="missing">未填写</option>
          <option value="filled">已填写</option>
        </SelectField>
      </div>
      <div className="agent-operation-filter-row agent-operation-filter-row--secondary">
        <TextField label="搜索" value={props.filters.search} onChange={(value) => props.onFilter('search', value)} placeholder="搜索主播名 / 平台 UID / 平台账号" />
        <SelectField label="重点关注" value={props.filters.priority} onChange={(value) => props.onFilter('priority', value as OperationFilters['priority'])}>
          <option value="">全部</option>
          <option value="priority">重点主播</option>
          <option value="normal">普通主播</option>
        </SelectField>
        {props.canSetPeriods ? (
          <button className="secondary-button compact-button agent-period-settings-button" type="button" onClick={props.onOpenPeriodSettings}>
            <Settings size={15} />
            <span>设置本月周期</span>
          </button>
        ) : null}
        <button className="secondary-button compact-button agent-operation-refresh-button" type="button" onClick={props.onResetFilters}>重置筛选</button>
        <button className="secondary-button compact-button agent-operation-refresh-button" type="button" onClick={props.onRefresh} disabled={props.refreshing}><RefreshCw size={15} /><span>刷新</span></button>
      </div>
    </div>
  );
}

function SearchableRevenueManagerFilter({ value, options, onChange }: { value: string; options: RevenueRepresentativeOption[]; onChange: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const selectedManager = options.find((option) => option.id === value);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = options.filter((option) => {
    if (!normalizedQuery) return true;
    return [getEmployeeName(option), option.full_name, option.nickname].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery);
  });
  const selectedName = selectedManager ? getEmployeeName(selectedManager) : '';

  useEffect(() => {
    if (!value) setQuery('');
  }, [value]);

  return (
    <div className="form-field agent-operation-manager-filter">
      <span>经纪人</span>
      <div>
        <input
          type="search"
          value={isOpen ? query : selectedName || query}
          placeholder="全部经纪人"
          onFocus={() => { setQuery(''); setIsOpen(true); }}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          onChange={(event) => { setQuery(event.target.value); setIsOpen(true); }}
        />
        {value ? <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(''); setQuery(''); setIsOpen(false); }} aria-label="清除经纪人筛选">清除</button> : null}
        {isOpen ? (
          <div className="agent-operation-manager-options" role="listbox" aria-label="经纪人">
            {visibleOptions.length ? visibleOptions.map((option) => (
              <button key={option.id} type="button" role="option" aria-selected={option.id === value} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option.id); setQuery(''); setIsOpen(false); }}>
                {getEmployeeName(option)}
              </button>
            )) : <p>没有符合条件的经纪人</p>}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CurrentOperationTable(props: {
  month: string; onMonthlySaved: (record: MonthlyRevenueRecord | null) => void;
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
          </colgroup>
          <thead>
            <tr>
              <th>主播</th>
              <th>平台</th>
              <th>类型</th>
              {periods.map((period) => <th key={period.startIso} className={period.startIso === selectedPeriodStart ? 'agent-period-head-selected' : ''}><PeriodHeader period={period} periods={periods} /></th>)}
              <th>本月情况</th>
              <th>状态</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>{rows.map((row) => <OperationTableRow key={row.id} row={row} selectedPeriodStart={selectedPeriodStart} onOpen={onOpen} month={props.month} onMonthlySaved={props.onMonthlySaved} />)}</tbody>
        </table>
      </div>
      <div className="agent-operation-mobile-list">
        {rows.map((row) => <OperationMobileCard key={row.id} row={row} selectedPeriodStart={selectedPeriodStart} onOpen={onOpen} month={props.month} onMonthlySaved={props.onMonthlySaved} />)}
      </div>
      <OperationPagination page={page} pageCount={pageCount} pageSize={pageSize} total={total} onPage={onPage} onPageSize={onPageSize} />
    </>
  );
}

function OperationTableRow({ row, selectedPeriodStart, onOpen, month, onMonthlySaved }: { row: OperationStreamerRow; selectedPeriodStart: string; onOpen: (row: OperationRow) => void; month: string; onMonthlySaved: (record: MonthlyRevenueRecord | null) => void }) {
  const groups = splitEffectiveCycleRows(row);
  return <>{groups.map((part, index) => {
    const weekly = part.profiles.every(profile => profile.revenue_cycle === 'weekly');
    return <tr key={`${row.id}:${part.profiles[0].revenue_cycle ?? 'legacy'}`}>
      {index === 0 ? <><td rowSpan={groups.length}><OperationCreatorIdentity profiles={row.profiles} regionLabel={row.regionLabel} /></td><td rowSpan={groups.length}><OperationPlatformList profiles={row.profiles} /></td><td rowSpan={groups.length}><OperationTypeList profiles={row.profiles} /></td></> : null}
      {weekly ? part.periods.map(cell => <PeriodRevenueCell key={cell.period.startIso} cell={cell} selected={cell.period.startIso === selectedPeriodStart} onOpen={onOpen} />) : <td className="agent-period-cell" colSpan={Math.max(1,row.periods.length)}><div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 8 }}><EffectiveCycleArea profiles={part.profiles} month={month} onSaved={onMonthlySaved} periods={part.periods} /></div></td>}
      <td>{weekly ? <OperationMonthSummary entries={summarizeOperationMonth(part.periods)} /> : part.profiles.filter(profile => profile.revenue_cycle === 'monthly').map(profile => { const record = (profile as CycleAwareProfile).revenueMonthContext?.monthly_record; return <div key={profile.id}>{platformLabels[profile.platform]} {record ? formatRevenueAmount(record.revenue_amount) : '—'} {getCreatorRevenueUnitLabel(profile.platform)}</div>; })}</td>
      <td>{weekly ? <OperationRowStatusBadge status={part.status} /> : part.profiles.every(profile => (profile as CycleAwareProfile).revenueMonthContext?.cycle_source === 'LEGACY_UNKNOWN') ? '周期待核验' : part.profiles.every(profile => profile.revenue_cycle === 'none') ? '无需填写' : part.profiles.every(profile => profile.revenue_cycle === 'monthly') ? <OperationRowStatusBadge status={part.profiles.every(profile => Boolean((profile as CycleAwareProfile).revenueMonthContext?.monthly_record)) ? 'filled' : 'missing'} /> : '历史待核验'}</td>
      <td className="agent-period-note">{part.profiles.map(profile => (profile as CycleAwareProfile).revenueMonthContext?.monthly_record?.agent_note).filter(Boolean).join(' / ') || row.latestNote || '-'}</td>
    </tr>;
  })}</>;
}

function OperationMobileCard({ row, selectedPeriodStart, onOpen, month, onMonthlySaved }: { month: string; onMonthlySaved: (record: MonthlyRevenueRecord | null) => void; row: OperationStreamerRow; selectedPeriodStart: string; onOpen: (row: OperationRow) => void }) {
  return (
    <article className="agent-operation-mobile-card agent-period-mobile-card">
      <div className="agent-operation-mobile-head">
        <OperationCreatorIdentity profiles={row.profiles} regionLabel={row.regionLabel} />
        {row.profiles.every((profile) => !isWeeklyRevenuePendingEligible(profile)) ? <span>{row.status === 'unverified' ? '周期待核验' : row.profiles.every(profile => profile.revenue_cycle === 'none') ? '无需填写流水' : row.profiles.some(profile => profile.revenue_cycle === 'monthly') ? (row.status === 'filled' ? '已填写' : '未填写') : '历史待核验'}</span> : <OperationStatusBadge status={row.status} />}
      </div>
      <div className="agent-period-mobile-meta">
        <OperationPlatformList profiles={row.profiles} />
        <OperationTypeList profiles={row.profiles} />
      </div>
      <div className="agent-period-mobile-periods">
        {row.profiles.some(profile => profile.revenue_cycle === 'weekly') ? row.periods.map((originalCell) => { const cell = { ...originalCell, profiles: originalCell.profiles.filter(item => item.creator.revenue_cycle === 'weekly') }; return (
          <section key={cell.period.startIso} className={`agent-period-mobile-period agent-period-mobile-period--${cell.status} ${cell.period.startIso === selectedPeriodStart ? 'agent-period-mobile-period--selected' : ''}`}>
            <span>{formatOperationPeriodHeader(cell.period, row.periods.map((period) => period.period))}</span>
            <div>{cell.profiles.map((profile) => <PeriodRevenueEntry key={`${profile.creator.id}-${profile.period.startIso}`} item={profile} onOpen={onOpen} />)}</div>
          </section>
        ); }) : null}{row.profiles.some(profile => profile.revenue_cycle !== 'weekly') ? <EffectiveCycleArea profiles={row.profiles.filter(profile => profile.revenue_cycle !== 'weekly')} month={month} onSaved={onMonthlySaved} periods={row.periods} /> : null}
      </div>
      <div className="agent-period-mobile-summary">
        <span>本月情况</span>
        <OperationMonthSummary entries={row.monthSummary} />{row.profiles.filter(profile => profile.revenue_cycle === 'monthly').map(profile => { const record = (profile as CycleAwareProfile).revenueMonthContext?.monthly_record; return <span key={profile.id}>{platformLabels[profile.platform]} {record ? formatRevenueAmount(record.revenue_amount) : '—'} {getCreatorRevenueUnitLabel(profile.platform)}</span>; })}
      </div>
      <p>备注：{row.latestNote || '-'}</p>
    </article>
  );
}

function PeriodHeader({ period, periods }: { period: RevenuePeriodRange; periods: RevenuePeriodRange[] }) {
  return (
    <span className="agent-period-header-label">
      <strong>{getOperationPeriodTitle(period, periods)}</strong>
      <small>{formatPeriodDayRange(period)}</small>
    </span>
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
  return <RevenueValueEntry item={item} onOpen={onOpen} disabled={!isWeeklyRevenuePendingEligible(item.creator) || !(item.creator as CycleAwareProfile).revenueMonthContext?.can_write} />;
}
function RevenueValueEntry({ item, onOpen, disabled = false }: { item: OperationCellProfile; onOpen: (row: OperationRow) => void; disabled?: boolean }) {
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
      disabled={disabled} onClick={() => onOpen({ creator: item.creator, record: item.record, status: item.status === 'filled' ? 'filled' : 'missing', period: item.period })}
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

type RevenuePeriodDraft = {
  periodNo: number;
  label: string;
  startDate: string;
  endDate: string;
  isEnabled: boolean;
};

function RevenuePeriodSettingsModal({ month, periods, saving, onClose, onSaved }: { month: string; periods: RevenuePeriodRange[]; saving: boolean; onClose: () => void; onSaved: (periods: RevenuePeriodRange[]) => void }) {
  const [drafts, setDrafts] = useState<RevenuePeriodDraft[]>(() => createRevenuePeriodDrafts(periods, month));
  const [localSaving, setLocalSaving] = useState(false);
  const [error, setError] = useState('');
  const hasFifthWeek = drafts.some((draft) => draft.periodNo === 5);
  const busy = saving || localSaving;

  function updateDraft(periodNo: number, field: 'startDate' | 'endDate', value: string) {
    setDrafts((current) => current.map((draft) => (draft.periodNo === periodNo ? { ...draft, [field]: value } : draft)));
  }

  function addFifthWeek() {
    setDrafts((current) => {
      if (current.some((draft) => draft.periodNo === 5)) return current;
      const monthRange = getMonthDateRange(month);
      const lastEndDate = current[current.length - 1]?.endDate;
      const startDate = lastEndDate && lastEndDate < monthRange.endIso ? addDaysIso(lastEndDate, 1) : monthRange.endIso;
      return [...current, { periodNo: 5, label: getPeriodNoLabel(5), startDate, endDate: monthRange.endIso, isEnabled: true }];
    });
  }

  function removeFifthWeek() {
    setDrafts((current) => current.filter((draft) => draft.periodNo !== 5));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateRevenuePeriodDrafts(drafts, month);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLocalSaving(true);
    setError('');
    try {
      const saved = await agentService.saveRevenuePeriodSettings(month, drafts.map((draft): RevenuePeriodSettingSaveInput => ({
        periodNo: draft.periodNo,
        label: draft.label,
        startDate: draft.startDate,
        endDate: draft.endDate,
        isEnabled: draft.isEnabled,
      })));
      onSaved(mapRevenuePeriodSettingsToRanges(saved));
    } catch (saveError) {
      setError(getRevenuePeriodSettingsErrorMessage(saveError));
    } finally {
      setLocalSaving(false);
    }
  }

  return (
    <SystemModal
      title={`设置 ${formatMonthTitle(month)}流水周期`}
      ariaLabel="设置流水周期"
      onClose={onClose}
      footer={<><button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button><button className="primary-button compact-button" type="submit" form="revenue-period-settings-form" disabled={busy}>{busy ? '保存中...' : '保存'}</button></>}
    >
      <form id="revenue-period-settings-form" className="agent-period-settings-form" onSubmit={submit}>
        <div className="agent-period-settings-grid">
          <span>周期</span>
          <span>开始日期</span>
          <span>结束日期</span>
          <span></span>
          {drafts.map((draft) => (
            <div className="agent-period-settings-row" key={draft.periodNo}>
              <strong>{getPeriodNoLabel(draft.periodNo)}</strong>
              <input type="date" value={draft.startDate} onChange={(event) => updateDraft(draft.periodNo, 'startDate', event.target.value)} />
              <input type="date" value={draft.endDate} onChange={(event) => updateDraft(draft.periodNo, 'endDate', event.target.value)} />
              {draft.periodNo === 5 ? (
                <button className="icon-button reject-button" type="button" onClick={removeFifthWeek} aria-label="删除第五周">
                  <Trash2 size={16} />
                </button>
              ) : <span aria-hidden="true"></span>}
            </div>
          ))}
        </div>
        {!hasFifthWeek ? (
          <button className="secondary-button compact-button agent-period-add-week-button" type="button" onClick={addFifthWeek}>
            <Plus size={15} />
            <span>新增第五周</span>
          </button>
        ) : null}
        {error ? <p className="form-alert agent-operation-alert">{error}</p> : null}
      </form>
    </SystemModal>
  );
}

function WeeklyRevenueModal({ row, onClose, onSubmitted }: { row: OperationRow; onClose: () => void; onSubmitted: (record: WeeklyRevenueRecord) => void }) {
  return <DirectWeeklyRevenueModal row={row} onClose={onClose} onSubmitted={onSubmitted} />;
}

function OperationCreatorIdentity({ profiles, regionLabel }: { profiles: CreatorProfile[]; regionLabel: string }) {
  return (
    <div className="agent-period-creator-identity">
      {profiles.map((profile) => {
        const isTikTok = profile.platform === 'tiktok';
        const username = profile.platform_account?.trim() || '未填写';
        const platformId = profile.platform_user_id?.trim() || '未填写';
        return (
          <div key={profile.id} className={`agent-period-creator-platform agent-period-creator-platform--${profile.platform}`}>
            <img src={isTikTok ? tiktokLogoUrl : douyinLogoUrl} alt={platformLabels[profile.platform]} />
            <div>
              <strong title={username}>{username}</strong>
              <small title={platformId}>{platformId}</small>
            </div>
          </div>
        );
      })}
      <small className="agent-period-creator-region">{regionLabel}</small>
    </div>
  );
}

function DirectWeeklyRevenueModal({ row, onClose, onSubmitted }: { row: OperationRow; onClose: () => void; onSubmitted: (record: WeeklyRevenueRecord) => void }) {
  const [amount, setAmount] = useState(row.record && row.status !== 'missing' ? formatAmountInput(row.record.revenue_amount) : '');
  const [agentNote, setAgentNote] = useState(row.record?.agent_note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const unitLabel = getCreatorRevenueUnitLabel(row.creator.platform);

  useEffect(() => {
    setIdempotencyKey(null);
  }, [row.creator.id, row.period.startIso]);

  function closeModal() {
    setIdempotencyKey(null);
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = parseWeeklyAmount(amount);
    if (parsedAmount.error) {
      setError(parsedAmount.error);
      return;
    }

    setSaving(true);
    setError('');
    const requestIdempotencyKey = idempotencyKey ?? createUuidV4();
    if (!idempotencyKey) setIdempotencyKey(requestIdempotencyKey);
    try {
      const record = await agentService.submitWeeklyRevenue({
        creatorProfileId: row.creator.id,
        weekStartDate: row.period.startIso,
        revenueAmount: parsedAmount.value,
        agentNote,
        idempotencyKey: requestIdempotencyKey,
      });
      setIdempotencyKey(null);
      onSubmitted(record);
    } catch (saveError) {
      setError(`提交失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SystemModal
      title={row.status === 'filled' ? '编辑周期流水' : '填写周期流水'}
      ariaLabel="周期流水"
      onClose={closeModal}
      footer={<><button className="secondary-button compact-button" type="button" onClick={closeModal}>关闭</button><button className="primary-button compact-button" type="submit" form="weekly-operation-form" disabled={saving}>保存</button></>}
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
            <input inputMode="decimal" min="0" type="number" value={amount} onChange={(event) => { setIdempotencyKey(null); setAmount(event.target.value); }} placeholder="尚未填写" />
            <b>{unitLabel}</b>
          </div>
        </label>
        <label className="form-field agent-weekly-revenue-note">
          <span>备注</span>
          <textarea value={agentNote} onChange={(event) => { setIdempotencyKey(null); setAgentNote(event.target.value); }} placeholder="选填" />
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
  const labels: Record<OperationCellStatus, string> = { missing: '未填写', filled: '已填写', future: '未开始', unverified: '周期待核验' };
  return <span className={`agent-weekly-status-badge agent-weekly-status-badge--${status}`}>{labels[status]}</span>;
}

function OperationRowStatusBadge({ status }: { status: OperationStatus }) {
  const labels: Record<OperationStatus, string> = { missing: '未完成', filled: '已完成', unverified: '周期待核验' };
  return <span className={`agent-weekly-status-badge agent-weekly-status-badge--${status}`}>{labels[status]}</span>;
}


function TextField({ label, value, onChange, type = 'text', required, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return <label className="form-field"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} placeholder={placeholder} /></label>;
}

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="form-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

function groupCreatorProfiles(creators: PersonalManagerCreatorProfile[], currentEmployeeId: string | null): CreatorProfileGroup[] {
  const groups = new Map<string, PersonalManagerCreatorProfile[]>();
  creators.forEach((creator) => {
    const key = creator.creator_entity_id ? `entity:${creator.creator_entity_id}` : `profile:${creator.id}`;
    groups.set(key, [...(groups.get(key) ?? []), creator]);
  });

  return Array.from(groups.entries()).map(([id, profiles]) => {
    const sortedProfiles = sortCreatorProfiles(profiles);
    const completeness = getCreatorCompleteness(sortedProfiles, currentEmployeeId);
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

function getCalendarDays(month: string) {
  const [year, monthIndex] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const last = new Date(Date.UTC(year, monthIndex, 0));
  const end = new Date(last);
  end.setUTCDate(end.getUTCDate() + (6 - ((end.getUTCDay() + 6) % 7)));
  const daysToShow = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return Array.from({ length: daysToShow }, (_, index) => {
    const date = new Date(start); date.setUTCDate(start.getUTCDate() + index);
    return { iso: date.toISOString().slice(0, 10), day: date.getUTCDate(), month: date.toISOString().slice(0, 7) };
  });
}

function shiftIsoDate(iso: string, amount: number) { const date = new Date(`${iso}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
function formatCalendarMonth(month: string) { const [year, monthIndex] = month.split('-'); return `${year} 年 ${Number(monthIndex)} 月`; }
function formatCalendarDate(iso: string) { const [, monthIndex, day] = iso.split('-'); return `${Number(monthIndex)} 月 ${Number(day)} 日`; }
function groupCalendarEventsByDate(events: CreatorCalendarEvent[]) { const groups = new Map<string, CreatorCalendarEvent[]>(); events.sort((a, b) => a.date.localeCompare(b.date)).forEach((event) => groups.set(event.date, [...(groups.get(event.date) ?? []), event])); return [...groups.entries()]; }

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

function getCreatorCompleteness(profiles: CreatorProfile[], currentEmployeeId: string | null): CreatorCompleteness {
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
    creator.manager_employee_id === currentEmployeeId
    && ['5+1', 'online', 'offline', 'company'].includes(creator.creator_type)
    && (!creator.bank_account_name || !creator.bank_name || !creator.bank_account),
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
  if (request.request_type === 'change_bank') return [request.bank_account_name, request.bank_name, request.bank_account].filter(Boolean).join(' / ') || '更换银行户口';
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
  previousPeriod: RevenuePeriodRange | null;
  customStart: string;
  customEnd: string;
  todayIso: string;
}): OperationDateRange {
  if (quickRange === 'previous' && input.previousPeriod) return { startIso: input.previousPeriod.startIso, endIso: input.previousPeriod.endIso };
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

function getRevenuePeriodsForDateRange(range: OperationDateRange, periodsByMonth: Record<string, RevenuePeriodRange[]>): RevenuePeriodRange[] {
  if (!isValidIsoDate(range.startIso) || !isValidIsoDate(range.endIso)) return [];
  const normalizedRange = normalizeOperationDateRange(range.startIso, range.endIso, range);
  const periods = new Map<string, RevenuePeriodRange>();
  getMonthsForDateRange(normalizedRange).forEach((month) => {
    (periodsByMonth[month] ?? [])
      .filter((period) => doDateRangesOverlap(period.startIso, period.endIso, normalizedRange.startIso, normalizedRange.endIso))
      .forEach((period) => periods.set(period.startIso, period));
  });

  return Array.from(periods.values()).sort((first, second) => first.startIso.localeCompare(second.startIso));
}

function getMonthsForDateRange(range: OperationDateRange) {
  if (!isValidIsoDate(range.startIso) || !isValidIsoDate(range.endIso)) return [];
  const normalizedRange = normalizeOperationDateRange(range.startIso, range.endIso, range);
  const months: string[] = [];
  const cursor = parseIsoDate(normalizedRange.startIso);
  cursor.setDate(1);
  const end = parseIsoDate(normalizedRange.endIso);
  end.setDate(1);

  while (cursor <= end) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function doDateRangesOverlap(firstStart: string, firstEnd: string, secondStart: string, secondEnd: string) {
  return firstStart <= secondEnd && firstEnd >= secondStart;
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseIsoDate(value);
  return !Number.isNaN(date.getTime()) && formatLocalDate(date) === value;
}

function findRevenuePeriodForDate(periods: RevenuePeriodRange[], dateIso: string) {
  return periods.find((period) => period.startIso <= dateIso && period.endIso >= dateIso) ?? null;
}

function getPreviousRevenuePeriod(currentPeriod: RevenuePeriodRange | null, periodsByMonth: Record<string, RevenuePeriodRange[]>) {
  if (!currentPeriod) return null;
  const monthPeriods = periodsByMonth[currentPeriod.startIso.slice(0, 7)] ?? [];
  const currentIndex = monthPeriods.findIndex((period) => period.startIso === currentPeriod.startIso);
  if (currentIndex <= 0) return null;
  return monthPeriods[currentIndex - 1] ?? null;
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

function isWeeklyRevenuePendingEligible(profile: PersonalManagerCreatorProfile) {
  return profile.revenue_cycle === 'weekly' && profile.membership_status === 'active';
}

function sortOperationCreators(creators: PersonalManagerCreatorProfile[]) {
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
    if (filters.revenueCycle) visibleProfiles = visibleProfiles.filter((profile) => profile.revenue_cycle === filters.revenueCycle);
    if (filters.managerEmployeeId) {
      visibleProfiles = visibleProfiles.filter((profile) => profile.manager_employee_id === filters.managerEmployeeId);
    }
    if (filters.platform && filters.platform !== 'dual_platform') {
      visibleProfiles = visibleProfiles.filter((profile) => profile.platform === filters.platform);
    }
    if (filters.creatorType === '5+1') {
      visibleProfiles = visibleProfiles.filter((profile) => profile.creator_type === '5+1');
    }
    if (filters.creatorType === 'non_5_1') {
      visibleProfiles = visibleProfiles.filter((profile) => profile.creator_type !== '5+1');
    }
    if (filters.priority) {
      visibleProfiles = visibleProfiles.filter((profile) => (profile.is_priority === true) === (filters.priority === 'priority'));
    }
    if (visibleProfiles.length === 0) return [];

    if (normalizedSearch && !matchesOperationSearch(visibleProfiles, normalizedSearch)) return [];

    const rowPeriods = periods.map((period) => {
      const isFuture = isRevenuePeriodFuture(period, todayIso);
      const cellProfiles = visibleProfiles.map((creator) => {
        const record = creator.revenue_cycle === 'weekly' || !creator.revenue_cycle || (creator as CycleAwareProfile).revenueMonthContext?.cycle_source === 'LEGACY_UNKNOWN' ? recordsByPeriod[period.startIso]?.[creator.id] ?? null : null;
        const status: OperationCellStatus = record ? 'filled' : !isWeeklyRevenuePendingEligible(creator) || isFuture ? 'future' : 'missing';
        return { creator, record, status, period };
      });
      return {
        period,
        profiles: cellProfiles,
        status: getOperationCellStatus(cellProfiles),
      };
    });
    const rowStatus: OperationStatus = visibleProfiles.every(profile => (profile as CycleAwareProfile).revenueMonthContext?.cycle_source === 'LEGACY_UNKNOWN') ? 'unverified' : rowPeriods.some((period) => period.profiles.some((profile) => profile.status === 'missing')) || visibleProfiles.some(profile => isVerifiedMonthly((profile as CycleAwareProfile).revenueMonthContext) && !(profile as CycleAwareProfile).revenueMonthContext?.monthly_record) ? 'missing' : 'filled';
    const revenueSort = getOperationRevenueSort(rowPeriods, filters.platform);
    return [{
      id: getOperationGroupKey(visibleProfiles[0]),
      displayName: getOperationDisplayName(visibleProfiles),
      regionLabel: getOperationRegionLabel(visibleProfiles),
      profiles: visibleProfiles,
      periods: rowPeriods,
      status: rowStatus,
      latestNote: getOperationLatestNote(rowPeriods),
      monthSummary: summarizeOperationMonth(rowPeriods.map(cell => ({ ...cell, profiles: cell.profiles.filter(item => isWeeklyRevenuePendingEligible(item.creator)) }))),
      sortValue: revenueSort.sortValue,
      firstCreatedAt: revenueSort.firstCreatedAt,
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
  const labels: Record<OperationCellStatus, string> = { missing: '未填写', filled: '已填写', future: '未开始', unverified: '周期待核验' };
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

function getOperationRevenueSort(periods: OperationPeriodCell[], platformFilter: OperationPlatformFilter) {
  const totals: Record<CreatorPlatform, number> = { tiktok: 0, douyin: 0 };
  const selectedPlatform = platformFilter === 'tiktok' || platformFilter === 'douyin' ? platformFilter : null;
  const records = periods.flatMap((period) => period.profiles)
    .filter((profile) => profile.record && (!selectedPlatform || profile.creator.platform === selectedPlatform));

  records.forEach((profile) => {
    totals[profile.creator.platform] += profile.record!.revenue_amount;
  });

  return {
    sortValue: selectedPlatform ? totals[selectedPlatform] : Math.max(totals.tiktok, totals.douyin),
    firstCreatedAt: getFirstCreatedAt(records.map((profile) => profile.record!)),
  };
}

function summarizeOperationStreamerRows(rows: OperationStreamerRow[]) {
  return rows.reduce(
    (summary, row) => {
      summary.rows += 1;
      row.periods.forEach((period) => {
        period.profiles.forEach((profile) => {
          if (!isWeeklyRevenuePendingEligible(profile.creator) || profile.status === 'future') return;
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
  if (second.sortValue !== first.sortValue) return second.sortValue - first.sortValue;
  const firstCreatedAtCompare = compareFirstCreatedAt(first.firstCreatedAt, second.firstCreatedAt);
  if (firstCreatedAtCompare !== 0) return firstCreatedAtCompare;
  return first.id.localeCompare(second.id);
}


function getOperationRowAction(row: OperationStreamerRow): OperationRow | null {
  const missingProfile = row.periods.flatMap((period) => period.profiles).find((profile) => profile.status === 'missing');
  if (missingProfile) return { creator: missingProfile.creator, record: null, status: 'missing', period: missingProfile.period };
  const filledProfile = row.periods.flatMap((period) => period.profiles).find((profile) => isWeeklyRevenuePendingEligible(profile.creator) && profile.status === 'filled');
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
  if (monthCount <= 1) return `${getPeriodNoLabel(period.periodNo)} ${formatPeriodDayRange(period)}`;
  const date = parseIsoDate(period.startIso);
  return `${String(date.getMonth() + 1).padStart(2, '0')}月 ${getPeriodNoLabel(period.periodNo)} ${formatPeriodDayRange(period)}`;
}

function mapRevenuePeriodSettingsToRanges(settings: RevenuePeriodSetting[]): RevenuePeriodRange[] {
  return settings
    .filter((setting) => setting.isEnabled)
    .map((setting) => ({
      startIso: setting.startDate,
      endIso: setting.endDate,
      label: `${formatDateForPeriod(parseIsoDate(setting.startDate))} - ${formatDateForPeriod(parseIsoDate(setting.endDate))}`,
      shortLabel: formatPeriodDayRange({ startIso: setting.startDate, endIso: setting.endDate }),
      periodNo: setting.periodNo,
    }))
    .sort((first, second) => first.startIso.localeCompare(second.startIso));
}

function createRevenuePeriodDrafts(periods: RevenuePeriodRange[], month: string): RevenuePeriodDraft[] {
  const monthRange = getMonthDateRange(month);
  if (periods.length > 0) {
    return periods.map((period) => ({
      periodNo: period.periodNo,
      label: getPeriodNoLabel(period.periodNo),
      startDate: period.startIso,
      endDate: period.endIso,
      isEnabled: true,
    }));
  }

  return [1, 2, 3, 4].map((periodNo) => ({
    periodNo,
    label: getPeriodNoLabel(periodNo),
    startDate: monthRange.startIso,
    endDate: monthRange.endIso,
    isEnabled: true,
  }));
}

function validateRevenuePeriodDrafts(drafts: RevenuePeriodDraft[], month: string) {
  if (drafts.length < 4) return '第一周至第四周必须完整设置。';
  if (drafts.length > 5) return '最多只能设置到第五周。';
  const monthRange = getMonthDateRange(month);
  const sortedDrafts = [...drafts].sort((first, second) => first.periodNo - second.periodNo);

  for (let index = 0; index < sortedDrafts.length; index += 1) {
    const draft = sortedDrafts[index];
    const expectedPeriodNo = index + 1;
    if (draft.periodNo !== expectedPeriodNo) return '第一周至第四周必须完整设置。';
    if (!draft.startDate || !draft.endDate) return `${getPeriodNoLabel(draft.periodNo)}的开始日期和结束日期必须填写。`;
    if (!isValidIsoDate(draft.startDate) || !isValidIsoDate(draft.endDate)) return `${getPeriodNoLabel(draft.periodNo)}的日期格式不正确。`;
    if (draft.startDate > draft.endDate) return `${getPeriodNoLabel(draft.periodNo)}的开始日期不能晚于结束日期。`;
    if (!isDateInRange(draft.startDate, monthRange) || !isDateInRange(draft.endDate, monthRange)) return `${getPeriodNoLabel(draft.periodNo)}的日期必须属于当前月份。`;
    if (index === 0 && draft.startDate !== monthRange.startIso) return '第一周必须从本月1日开始。';
    if (index > 0 && draft.startDate !== addDaysIso(sortedDrafts[index - 1].endDate, 1)) return '周期日期必须连续覆盖整个月，不能出现空档或重叠。';
  }

  if (sortedDrafts[sortedDrafts.length - 1].endDate !== monthRange.endIso) return '最后一个周期必须结束于本月最后一天。';

  return '';
}

function isDateInRange(dateIso: string, range: OperationDateRange) {
  return dateIso >= range.startIso && dateIso <= range.endIso;
}

function addDaysIso(dateIso: string, days: number) {
  const date = parseIsoDate(dateIso);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function getPeriodNoLabel(periodNo: number) {
  const labels = ['第一周', '第二周', '第三周', '第四周', '第五周'];
  return labels[periodNo - 1] ?? `第${periodNo}周`;
}

function getOperationPeriodTitle(period: RevenuePeriodRange, periods: RevenuePeriodRange[]) {
  const monthCount = new Set(periods.map((item) => item.startIso.slice(0, 7))).size;
  if (monthCount <= 1) return getPeriodNoLabel(period.periodNo);
  const date = parseIsoDate(period.startIso);
  return `${String(date.getMonth() + 1).padStart(2, '0')}月 ${getPeriodNoLabel(period.periodNo)}`;
}

function formatPeriodDayRange(period: Pick<RevenuePeriodRange, 'startIso' | 'endIso'>) {
  const start = parseIsoDate(period.startIso).getDate();
  const end = parseIsoDate(period.endIso).getDate();
  return `${start}日–${end}日`;
}

function formatPeriodTitle(period: RevenuePeriodRange) {
  return `${getPeriodNoLabel(period.periodNo)} ${formatPeriodDayRange(period)}`;
}

function formatMonthTitle(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return `${month} `;
  return `${year}年${monthNumber}月`;
}

function getRevenuePeriodSettingsErrorMessage(error: unknown) {
  const message = getErrorMessage(error);
  if (message.includes('This month already has weekly revenue records') || message.includes('不能更改原有周期日期')) return '该月份已经存在流水记录，不能更改原有周期日期。';
  if (message.includes('already has weekly revenue records') || message.includes('已有流水')) return '该周期已有流水记录，不能删除或修改日期。';
  if (message.includes('require complete periods') || message.includes('fifth revenue period') || message.includes('continuous period numbers')) return '第一周至第四周必须完整设置。';
  if (message.includes('first day of the month')) return '第一周必须从本月1日开始。';
  if (message.includes('last day of the month')) return '最后一个周期必须结束于本月最后一天。';
  if (message.includes('continuously cover') || message.includes('overlap') || message.includes('重叠')) return '周期日期必须连续覆盖整个月，不能出现空档或重叠。';
  if (message.includes('No permission')) return '没有权限设置流水周期。';
  return `保存失败：${message}`;
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

function isAmbiguousRevenueRequest(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return /network|fetch|timeout|timed out|connection|offline|abort/.test(message);
}


type CycleAwareProfile = CreatorProfile & { current_revenue_cycle?: CreatorProfile['revenue_cycle']; revenueMonthContext?: RevenueMonthContext };
function MonthlyRevenueEntry({ creator, month, onSaved }: { creator: CycleAwareProfile; month: string; onSaved: (record: MonthlyRevenueRecord | null) => void }) {
  const context = creator.revenueMonthContext;
  const record = context?.monthly_record ?? null;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const snapshot = useRef<MonthlyRevenueRecord | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setOpen(false); setRequestId(null); }, [month, creator.id]);
  const row: OperationCellProfile = { creator, record: record ? { ...record, week_start_date: `${month}-01`, week_end_date: `${month}-01` } as unknown as WeeklyRevenueRecord : null, status: record ? 'filled' : 'missing', period: { startIso: `${month}-01`, endIso: `${month}-01`, label: month, shortLabel: month, periodNo: 1 } };
  function begin() {
    if (!canWriteMonthly(context)) return;
    snapshot.current = record;
    setAmount(record ? String(record.revenue_amount) : ''); setNote(record?.agent_note ?? ''); setError(''); setRequestId(null); setOpen(true);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !canWriteMonthly(context)) return;
    const parsed = parseWeeklyAmount(amount);
    if (parsed.error) { setError(parsed.error); return; }
    const id = requestId ?? createUuidV4(); setRequestId(id); setSaving(true); setError('');
    try {
      const saved = await revenueCycleService.saveMonthly({ profileId: creator.id, month, amount: parsed.value, note, version: snapshot.current?.version ?? 0, requestId: id });
      if (!mounted.current) return;
      onSaved(saved); setOpen(false); setRequestId(null);
    } catch (failure) {
      if (mounted.current) setError(getMonthlyRevenueError(failure));
    } finally { if (mounted.current) setSaving(false); }
  }
  return <>
    <RevenueValueEntry item={row} onOpen={begin} disabled={!canWriteMonthly(context)} />
    {open ? <SystemModal title={record ? '编辑月流水' : '填写月流水'} ariaLabel="月流水" onClose={() => { if (!saving) setOpen(false); }} footer={<><button className="secondary-button compact-button" disabled={saving} onClick={() => setOpen(false)}>关闭</button><button className="primary-button compact-button" type="submit" form={`monthly-revenue-${creator.id}`} disabled={saving || !canWriteMonthly(context)}>保存</button></>}>
      <form id={`monthly-revenue-${creator.id}`} className="weekly-operation-form" onSubmit={save}>
        <div className="agent-operation-modal-head"><PlatformPill platform={creator.platform} /><OperationStatusBadge status={record ? 'filled' : 'missing'} /></div>
        <div className="agent-operation-detail-grid"><DrawerField label="主播" value={creator.creator_name || '-'} /><DrawerField label="平台" value={platformLabels[creator.platform]} /><DrawerField label="UID" value={creator.platform_user_id} /><DrawerField label="平台账号" value={creator.platform_account || '-'} /><DrawerField label="月份" value={month} /><DrawerField label="单位" value={getCreatorRevenueUnitLabel(creator.platform)} /></div>
        <label className="form-field agent-weekly-revenue-field"><span>流水</span><div className="agent-weekly-revenue-input-row"><input inputMode="decimal" type="number" min="0" step="0.01" required disabled={saving} value={amount} onChange={event => { setAmount(event.target.value); setRequestId(null); }} placeholder="尚未填写" /><b>{getCreatorRevenueUnitLabel(creator.platform)}</b></div></label>
        <label className="form-field agent-weekly-revenue-note"><span>备注</span><textarea disabled={saving} value={note} onChange={event => { setNote(event.target.value); setRequestId(null); }} placeholder="选填" /></label>
        {error ? <p className="form-alert agent-operation-alert">{error}</p> : null}
      </form>
    </SystemModal> : null}
  </>;
}
function getMonthlyRevenueError(failure: unknown) {
  const code = typeof failure === 'object' && failure !== null && 'code' in failure ? String(failure.code) : '';
  if (code === '40001') return '该月流水已被更新，请关闭弹窗并刷新后重新编辑。';
  if (code === '42501') return '没有权限填写此主播的月流水。';
  if (code === '55000') return '该月份不适用月流水，或尚未完成周期基线核验。';
  if (code === '23505') return '请求已存在但内容不同，请刷新后重试。';
  if (code === '22023') return '月份或流水数值无效。';
  return '保存月流水失败，请检查连接后重试。';
}
function EffectiveCycleArea({ profiles, month, onSaved, periods = [] }: { profiles: CycleAwareProfile[]; month: string; onSaved: (record: MonthlyRevenueRecord | null) => void; periods?: OperationPeriodCell[] }) {
  const unknown = profiles.filter(profile => profile.revenueMonthContext?.cycle_source === 'LEGACY_UNKNOWN');
  if (unknown.length) return <div>
    {unknown.map(profile => <div key={profile.id}><p>{profile.creator_name} · 当前资料设置：{profile.current_revenue_cycle === 'monthly' ? '月流水' : '待确认'}；所选月周期待核验（只读）</p>
      {profile.current_revenue_cycle === 'monthly' ? <MonthlyRevenueBaseline profileId={profile.id} creatorName={profile.creator_name || profile.platform_user_id} month={month} onVerified={() => onSaved(null)} /> : null}
    </div>)}
    {periods.flatMap(cell => cell.profiles).filter(item => item.record && unknown.some(profile => profile.id === item.creator.id)).map(item => <div key={item.creator.id + ':' + item.period.startIso}><small>{getWeekLabel(item.period.startIso, item.period.endIso)}</small><RevenueValueEntry item={item} onOpen={() => {}} disabled /></div>)}
    {profiles.filter(profile => profile.revenueMonthContext?.cycle_source !== 'LEGACY_UNKNOWN' && profile.revenue_cycle === 'monthly').map(profile => <MonthlyRevenueEntry key={profile.id} creator={profile} month={month} onSaved={onSaved} />)}
  </div>;
  if (profiles.every(profile => profile.revenue_cycle === 'none')) return <span>无需填写流水</span>;
  return <div className="agent-period-cell-stack" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>{profiles.filter(profile => profile.revenue_cycle === 'monthly').map(profile => <MonthlyRevenueEntry key={`${profile.id}:${month}`} creator={profile} month={month} onSaved={onSaved} />)}</div>;
}
function splitEffectiveCycleRows(row: OperationStreamerRow): OperationStreamerRow[] {
  const groups = new Map<string, CreatorProfile[]>();
  row.profiles.forEach(profile => { const cycle = profile.revenue_cycle ?? 'legacy'; groups.set(cycle, [...(groups.get(cycle) ?? []), profile]); });
  return [...groups.values()].map(profiles => ({ ...row, profiles, periods: row.periods.map(cell => ({ ...cell, profiles: cell.profiles.filter(item => profiles.some(profile => profile.id === item.creator.id)) })) }));
}

function summarizeEffectiveRevenueRows(rows: OperationStreamerRow[]) {
  const summary = summarizeOperationStreamerRows(rows);
  const seen = new Set<string>();
  rows.forEach(row => row.profiles.forEach(profile => {
    if (profile.revenue_cycle !== 'monthly' || (profile as CycleAwareProfile).revenueMonthContext?.cycle_source !== 'VERIFIED' || seen.has(profile.id)) return;
    seen.add(profile.id);
    const record = (profile as CycleAwareProfile).revenueMonthContext?.monthly_record;
    if (!record) { summary.missing += 1; return; }
    summary.filled += 1;
    if (profile.platform === 'tiktok') summary.tiktokTotal += record.revenue_amount;
    if (profile.platform === 'douyin') summary.douyinTotal += record.revenue_amount;
  }));
  return summary;
}

function isPreviousWeeklyReminderEligible(creator: CreatorProfile, context: RevenueMonthContext | undefined) {
  return context?.effective_cycle === 'weekly' && isWeeklyRevenuePendingEligible({ ...creator, revenue_cycle: 'weekly' });
}
