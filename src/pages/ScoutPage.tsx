import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Edit3, MessageSquarePlus, Plus, RefreshCw, X } from 'lucide-react';
import { MonthSelect } from '../components/MonthSelect';
import { SystemModal } from '../components/SystemModal';
import { useAuth } from '../hooks/useAuth';
import { usePermissions } from '../hooks/usePermissions';
import tiktokLogoUrl from '../assets/icons/tiktok-logo.png';
import douyinLogoUrl from '../assets/icons/douyin-logo.png';
import {
  createRecruitBreakdown,
  creatorTypeLabels,
  type DailyWorkLog,
  type DailyWorkLogFormValues,
  filterCreatorsByMonth,
  getEmployeeName,
  type ManagementWorkloadStat,
  platformLabels,
  scoutService,
  type Candidate,
  type CandidateFollowUpFormValues,
  type CandidateFollowUpHistory,
  type CandidateFormValues,
  type CreatorManagerDisplayName,
  type CreatorFormValues,
  type CreatorPlatform,
  type CreatorProfile,
  type CreatorStatusFilter,
  type CreatorType,
  type FollowStatus,
  type OnboardingManagerOption,
  type ScoutOptions,
  type WorkloadGranularity,
} from '../services/scout.service';

type ScoutPageMode = 'personal-recruiting' | 'recruit-list' | 'onboarding' | 'personal-streamers' | 'management-recruiting' | 'management-streamers';

type ScoutPageProps = {
  mode: ScoutPageMode;
};

const currentMonth = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);
type CandidateFollowFilter = 'all' | 'today' | 'overdue';
const workloadGranularities: WorkloadGranularity[] = ['daily', 'weekly', 'monthly'];
type WorkloadView = WorkloadGranularity | 'scout-records';
type ScoutRecordView = Extract<WorkloadGranularity, 'daily' | 'monthly'>;
const workloadGranularityLabels: Record<WorkloadGranularity, string> = {
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
};
const scoutRecordViewLabels: Record<ScoutRecordView, string> = {
  daily: '每日记录',
  monthly: '月汇总',
};
const teamWorkloadViewLabels: Record<WorkloadGranularity, string> = {
  daily: '今日',
  weekly: '本周',
  monthly: '本月',
};

const emptyCandidateForm: CandidateFormValues = {
  platform: '',
  platform_user_id: '',
  platform_account: '',
  talent: '',
  name: '',
  gender: '',
  age: '',
  source: '',
  contact: '',
  current_job: '',
  remark: '',
};

const emptyFollowUpForm: CandidateFollowUpFormValues = {
  to_follow_status: 'following',
  note: '',
  next_follow_up_date: '',
  stopped_reason: '',
};

const emptyCreatorForm: CreatorFormValues = {
  joined_date: today,
  platform: 'tiktok',
  platform_user_id: '',
  platform_account: '',
  region_id: '',
  creator_name: '',
  scout_employee_id: '',
  manager_employee_id: '',
  creator_type: '5+1',
  bank_name: '',
  bank_account: '',
};

const creatorTypes: CreatorType[] = ['5+1', 'online', 'offline', 'company'];
const followStatuses: FollowStatus[] = ['pending', 'following', 'interview', 'ready_onboarding'];

export function ScoutPage({ mode }: ScoutPageProps) {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const isManagementMode = mode.startsWith('management');
  const canManageCreators = permissions.canUse(isManagementMode ? 'management-streamer-stats' : 'scout-onboarding');
  const canManageCreatorStatus = mode === 'management-streamers' && permissions.isSuperAdmin;
  const [options, setOptions] = useState<ScoutOptions>({ regions: [], employees: [] });
  const [managerOptions, setManagerOptions] = useState<OnboardingManagerOption[]>([]);
  const [creatorManagerNames, setCreatorManagerNames] = useState<CreatorManagerDisplayName[]>([]);
  const [creators, setCreators] = useState<CreatorProfile[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [dailyWorkLogs, setDailyWorkLogs] = useState<DailyWorkLog[]>([]);
  const [managementWorkloadStats, setManagementWorkloadStats] = useState<ManagementWorkloadStat[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [platformFilter, setPlatformFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [scoutFilter, setScoutFilter] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [creatorTypeFilter, setCreatorTypeFilter] = useState('');
  const [creatorStatusFilter, setCreatorStatusFilter] = useState<CreatorStatusFilter>('active');
  const [candidateFollowFilter, setCandidateFollowFilter] = useState<CandidateFollowFilter>('all');
  const [workloadGranularity, setWorkloadGranularity] = useState<WorkloadGranularity>('daily');
  const [candidateForm, setCandidateForm] = useState<CandidateFormValues>(emptyCandidateForm);
  const [editingCandidate, setEditingCandidate] = useState<Candidate | null>(null);
  const [followUpCandidate, setFollowUpCandidate] = useState<Candidate | null>(null);
  const [followUpForm, setFollowUpForm] = useState<CandidateFollowUpFormValues>(emptyFollowUpForm);
  const [followUpHistory, setFollowUpHistory] = useState<CandidateFollowUpHistory[]>([]);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [creatorForm, setCreatorForm] = useState<CreatorFormValues>(emptyCreatorForm);
  const [editingCreator, setEditingCreator] = useState<CreatorProfile | null>(null);
  const [statusCreator, setStatusCreator] = useState<CreatorProfile | null>(null);
  const [candidateModalOpen, setCandidateModalOpen] = useState(false);
  const [creatorModalOpen, setCreatorModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dailyWorkSavingDate, setDailyWorkSavingDate] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const personalProfileId = isManagementMode ? undefined : profile?.id;

  const monthCreators = useMemo(() => filterCreatorsByMonth(creators, month), [creators, month]);
  const filteredCreators = useMemo(
    () =>
      creators.filter((creator) => {
        if (platformFilter && creator.platform !== platformFilter) return false;
        if (regionFilter && creator.region_id !== regionFilter) return false;
        if (scoutFilter && creator.scout_employee_id !== scoutFilter) return false;
        if (managerFilter && creator.manager_employee_id !== managerFilter) return false;
        if (creatorTypeFilter && creator.creator_type !== creatorTypeFilter) return false;
        return true;
      }),
    [creatorTypeFilter, creators, managerFilter, platformFilter, regionFilter, scoutFilter],
  );
  const managerDisplayNameByCreatorId = useMemo(
    () =>
      creatorManagerNames.reduce<Record<string, string>>((names, manager) => {
        names[manager.creator_id] = manager.manager_display_name;
        return names;
      }, {}),
    [creatorManagerNames],
  );
  const managementMonthCreators = useMemo(
    () => filterCreatorsByMonth(filteredCreators, month),
    [filteredCreators, month],
  );
  const personalBreakdown = useMemo(() => createRecruitBreakdown(monthCreators), [monthCreators]);
  const managementBreakdown = useMemo(() => createRecruitBreakdown(managementMonthCreators), [managementMonthCreators]);
  const scoutRecruitRows = useMemo(() => createScoutRecruitRows(managementMonthCreators), [managementMonthCreators]);
  const regionRecruitRows = useMemo(() => createRegionRecruitRows(managementMonthCreators), [managementMonthCreators]);
  const sortedCandidates = useMemo(() => {
    const malaysiaToday = getMalaysiaDateString();
    const filteredCandidates = candidates.filter((candidate) => {
      if (candidateFollowFilter === 'all') return true;
      if (candidate.follow_status === 'stopped' || !candidate.next_follow_up_date) return false;
      if (candidateFollowFilter === 'today') return candidate.next_follow_up_date === malaysiaToday;
      return candidate.next_follow_up_date < malaysiaToday;
    });

    return filteredCandidates.sort((first, second) => {
        const firstSettled = first.status === 'pending' ? 0 : 1;
        const secondSettled = second.status === 'pending' ? 0 : 1;
        if (firstSettled !== secondSettled) return firstSettled - secondSettled;
        const firstFollowDate = first.next_follow_up_date ?? '9999-12-31';
        const secondFollowDate = second.next_follow_up_date ?? '9999-12-31';
        if (firstFollowDate !== secondFollowDate) return firstFollowDate.localeCompare(secondFollowDate);
        return new Date(second.updated_at).getTime() - new Date(first.updated_at).getTime();
      });
  }, [candidateFollowFilter, candidates]);

  useEffect(() => {
    void loadData();
  }, [creatorStatusFilter, mode, month, profile?.id, regionFilter, workloadGranularity]);

  async function loadData() {
    if (!profile?.id && !isManagementMode) return;
    setLoading(true);
    setError('');

    try {
      const [nextOptions, nextCreators, nextCandidates, nextDailyWorkLogs, nextManagementWorkloadStats] = await Promise.all([
        scoutService.getOptions(),
        scoutService.listCreators({ personalProfileId, status: mode === 'management-streamers' ? creatorStatusFilter : undefined }),
        mode === 'recruit-list' && profile?.id ? scoutService.listCandidates(profile.id) : Promise.resolve([]),
        mode === 'personal-recruiting' ? scoutService.listDailyWorkLogs(month) : Promise.resolve([]),
        mode === 'management-recruiting' ? scoutService.listManagementWorkloadStats({ month, regionId: regionFilter, granularity: workloadGranularity }) : Promise.resolve([]),
      ]);

      setOptions(nextOptions);
      setCreators(nextCreators);
      setCandidates(nextCandidates);
      setDailyWorkLogs(nextDailyWorkLogs);
      setManagementWorkloadStats(nextManagementWorkloadStats);

      if (!creatorForm.scout_employee_id && profile?.id) {
        const currentEmployee = nextOptions.employees.find((employee) => employee.profile_id === profile.id);
        if (currentEmployee) {
          setCreatorForm((current) => ({ ...current, scout_employee_id: currentEmployee.id, region_id: currentEmployee.region_id ?? current.region_id }));
        }
      }

      try {
        setManagerOptions(await scoutService.listOnboardingManagerOptions());
      } catch (managerOptionsError) {
        console.error('Failed to load onboarding manager options', managerOptionsError);
        setManagerOptions([]);
      }

      if (mode === 'personal-streamers' || mode === 'management-streamers') {
        try {
          setCreatorManagerNames(await scoutService.listVisibleCreatorManagerDisplayNames());
        } catch (creatorManagerNamesError) {
          console.error('Failed to load creator manager display names', creatorManagerNamesError);
          setCreatorManagerNames([]);
        }
      } else {
        setCreatorManagerNames([]);
      }
    } catch (loadError) {
      setError(`读取星探资料失败：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  async function submitCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile?.id) return;
    setSaving(true);
    setError('');
    setMessage('');

    try {
      if (editingCandidate) {
        await scoutService.updateCandidate(editingCandidate.id, candidateForm);
        setMessage('名单资料已更新。');
      } else {
        await scoutService.createCandidate(profile.id, candidateForm);
        setMessage('名单已新增。');
      }
      closeCandidateModal();
      await loadData();
    } catch (saveError) {
      setError(`保存名单失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function submitCreator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');

    try {
      if (editingCreator) {
        await scoutService.updateCreator(editingCreator.id, creatorForm);
        setMessage('主播资料已更新。');
      } else {
        await scoutService.createCreator(creatorForm);
        setMessage('主播已入公会。');
      }
      closeCreatorModal();
      await loadData();
    } catch (saveError) {
      setError(`保存主播资料失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function setCandidateStatus(candidate: Candidate, status: 'accepted' | 'rejected') {
    setError('');
    setMessage('');

    try {
      await scoutService.setCandidateStatus(candidate.id, status);
      setMessage(status === 'accepted' ? '名单已接受。' : '名单已拒绝。');
      await loadData();
    } catch (statusError) {
      setError(`更新名单状态失败：${getErrorMessage(statusError)}`);
    }
  }

  async function submitFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!followUpCandidate) return;
    setSaving(true);
    setError('');
    setMessage('');

    try {
      await scoutService.addCandidateFollowUp(followUpCandidate.id, followUpForm);
      setMessage(followUpForm.to_follow_status === 'stopped' ? '已停止跟进。' : followUpCandidate.follow_status === 'stopped' ? '名单已重新启用。' : '跟进记录已保存。');
      closeFollowUpModal();
      await loadData();
    } catch (followUpError) {
      setError(`保存跟进记录失败：${getErrorMessage(followUpError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function submitDailyWorkLog(workDate: string, values: DailyWorkLogFormValues) {
    setDailyWorkSavingDate(workDate);
    setError('');
    setMessage('');

    try {
      await scoutService.saveDailyWorkLog(workDate, values);
      setMessage('每日工作记录已保存。');
      await loadData();
    } catch (saveError) {
      setError(`保存每日工作记录失败：${getErrorMessage(saveError)}`);
    } finally {
      setDailyWorkSavingDate('');
    }
  }

  function openCandidateCreate() {
    setEditingCandidate(null);
    setCandidateForm(emptyCandidateForm);
    setCandidateModalOpen(true);
  }

  function openCandidateEdit(candidate: Candidate) {
    setEditingCandidate(candidate);
    setCandidateForm({
      platform: candidate.platform ?? '',
      platform_user_id: candidate.platform_user_id ?? '',
      platform_account: candidate.platform_account ?? '',
      talent: candidate.talent ?? '',
      name: candidate.name,
      gender: candidate.gender ?? '',
      age: candidate.age ? String(candidate.age) : '',
      source: candidate.source ?? '',
      contact: candidate.contact ?? '',
      current_job: candidate.current_job ?? '',
      remark: candidate.remark ?? '',
    });
    setCandidateModalOpen(true);
  }

  async function openFollowUp(candidate: Candidate) {
    setFollowUpCandidate(candidate);
    setFollowUpForm({
      ...emptyFollowUpForm,
      to_follow_status: candidate.follow_status === 'stopped' ? 'following' : candidate.follow_status ?? 'following',
      next_follow_up_date: candidate.next_follow_up_date ?? '',
    });
    setFollowUpHistory([]);
    setFollowUpLoading(true);
    setError('');

    try {
      setFollowUpHistory(await scoutService.listCandidateFollowUpHistory(candidate.id));
    } catch (historyError) {
      setError(`读取跟进历史失败：${getErrorMessage(historyError)}`);
    } finally {
      setFollowUpLoading(false);
    }
  }

  function closeFollowUpModal() {
    setFollowUpCandidate(null);
    setFollowUpForm(emptyFollowUpForm);
    setFollowUpHistory([]);
    setFollowUpLoading(false);
  }

  function closeCandidateModal() {
    setCandidateModalOpen(false);
    setEditingCandidate(null);
    setCandidateForm(emptyCandidateForm);
  }

  function openCreatorCreate(platform: CreatorPlatform = 'tiktok') {
    const currentEmployee = options.employees.find((employee) => employee.profile_id === profile?.id);
    setEditingCreator(null);
    setCreatorForm({
      ...emptyCreatorForm,
      platform,
      scout_employee_id: currentEmployee?.id ?? '',
      region_id: currentEmployee?.region_id ?? '',
    });
    setCreatorModalOpen(true);
  }

  function openCreatorEdit(creator: CreatorProfile) {
    setEditingCreator(creator);
    setCreatorForm({
      joined_date: creator.joined_date,
      platform: creator.platform,
      platform_user_id: creator.platform_user_id,
      platform_account: creator.platform_account,
      region_id: creator.region_id ?? '',
      creator_name: creator.creator_name,
      scout_employee_id: creator.scout_employee_id ?? '',
      manager_employee_id: creator.manager_employee_id ?? '',
      creator_type: creator.creator_type,
      bank_name: creator.bank_name ?? '',
      bank_account: creator.bank_account ?? '',
    });
    setCreatorModalOpen(true);
  }

  function closeCreatorModal() {
    setCreatorModalOpen(false);
    setEditingCreator(null);
    setCreatorForm(emptyCreatorForm);
  }

  function openCreatorStatus(creator: CreatorProfile) {
    setStatusCreator(creator);
  }

  function closeCreatorStatus() {
    setStatusCreator(null);
  }

  async function setCreatorInvalid(creator: CreatorProfile, reason: string) {
    setSaving(true);
    setError('');
    setMessage('');

    try {
      await scoutService.setCreatorStatus(creator.id, 'invalid', reason);
      setMessage('主播已设为无效。');
      closeCreatorStatus();
      await loadData();
    } catch (statusError) {
      setError(`更新主播状态失败：${getErrorMessage(statusError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function setCreatorActive(creator: CreatorProfile) {
    setSaving(true);
    setError('');
    setMessage('');

    try {
      await scoutService.setCreatorStatus(creator.id, 'active', null);
      setMessage('主播已恢复为在职。');
      closeCreatorStatus();
      await loadData();
    } catch (statusError) {
      setError(`更新主播状态失败：${getErrorMessage(statusError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="scout-page">
      <div className="toolbar-actions staff-actions-row">
        {mode === 'recruit-list' ? (
          <button className="secondary-action" type="button" onClick={openCandidateCreate}>
            <Plus size={17} />
            <span>新增</span>
          </button>
        ) : null}
        {(mode === 'onboarding' || mode === 'management-streamers') && canManageCreators ? (
          <button className="secondary-action" type="button" onClick={() => openCreatorCreate()}>
            <Plus size={17} />
            <span>新增主播</span>
          </button>
        ) : null}
        <button className="secondary-action" type="button" onClick={loadData} disabled={loading}>
          <RefreshCw size={17} />
          <span>刷新</span>
        </button>
      </div>

      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      {mode === 'personal-recruiting' ? (
        <PersonalRecruitingPanel
          month={month}
          onMonthChange={setMonth}
          breakdown={personalBreakdown}
          dailyWorkLogs={dailyWorkLogs}
          dailyWorkSavingDate={dailyWorkSavingDate}
          canEditDailyWork={permissions.canUse('scout-recruiting-data')}
          loading={loading}
          onSaveDailyWorkLog={submitDailyWorkLog}
        />
      ) : null}

      {mode === 'recruit-list' ? (
        <CandidatePanel
          loading={loading}
          candidates={sortedCandidates}
          followFilter={candidateFollowFilter}
          onFollowFilter={setCandidateFollowFilter}
          onEdit={openCandidateEdit}
          onFollowUp={openFollowUp}
          onStatus={setCandidateStatus}
        />
      ) : null}

      {mode === 'onboarding' ? (
        <OnboardingPanel canCreate={canManageCreators} onCreate={openCreatorCreate} />
      ) : null}

      {mode === 'personal-streamers' || mode === 'management-streamers' ? (
        <CreatorStatsPanel
          loading={loading}
          creators={filteredCreators}
          options={options}
          isManagement={mode === 'management-streamers'}
          canEdit={canManageCreators}
          canManageStatus={canManageCreatorStatus}
          platformFilter={platformFilter}
          regionFilter={regionFilter}
          scoutFilter={scoutFilter}
          managerFilter={managerFilter}
          creatorTypeFilter={creatorTypeFilter}
          creatorStatusFilter={creatorStatusFilter}
          onPlatformFilter={setPlatformFilter}
          onRegionFilter={setRegionFilter}
          onScoutFilter={setScoutFilter}
          onManagerFilter={setManagerFilter}
          onCreatorTypeFilter={setCreatorTypeFilter}
          onCreatorStatusFilter={setCreatorStatusFilter}
          managerDisplayNameByCreatorId={managerDisplayNameByCreatorId}
          onEdit={openCreatorEdit}
          onStatus={openCreatorStatus}
        />
      ) : null}

      {mode === 'management-recruiting' ? (
        <ManagementRecruitingPanel
          loading={loading}
          month={month}
          onMonthChange={setMonth}
          regionFilter={regionFilter}
          onRegionFilter={setRegionFilter}
          options={options}
          scoutRecruitRows={scoutRecruitRows}
          regionRecruitRows={regionRecruitRows}
          breakdown={managementBreakdown}
          workloadStats={managementWorkloadStats}
          workloadGranularity={workloadGranularity}
          onWorkloadGranularity={setWorkloadGranularity}
        />
      ) : null}

      {candidateModalOpen ? (
        <CandidateModal
          values={candidateForm}
          editingCandidate={editingCandidate}
          saving={saving}
          onChange={setCandidateForm}
          onClose={closeCandidateModal}
          onSubmit={submitCandidate}
        />
      ) : null}

      {followUpCandidate ? (
        <FollowUpModal
          candidate={followUpCandidate}
          values={followUpForm}
          history={followUpHistory}
          loading={followUpLoading}
          saving={saving}
          onChange={setFollowUpForm}
          onClose={closeFollowUpModal}
          onSubmit={submitFollowUp}
        />
      ) : null}

      {creatorModalOpen ? (
        <CreatorModal
          values={creatorForm}
          options={options}
          managerOptions={managerOptions}
          editingCreator={editingCreator}
          saving={saving}
          onChange={setCreatorForm}
          onClose={closeCreatorModal}
          onSubmit={submitCreator}
        />
      ) : null}

      {statusCreator ? <CreatorStatusModal creator={statusCreator} saving={saving} onClose={closeCreatorStatus} onSetInvalid={setCreatorInvalid} onSetActive={setCreatorActive} /> : null}
    </section>
  );
}

function PersonalRecruitingPanel({
  month,
  onMonthChange,
  breakdown,
  dailyWorkLogs,
  dailyWorkSavingDate,
  canEditDailyWork,
  loading,
  onSaveDailyWorkLog,
}: {
  month: string;
  onMonthChange: (value: string) => void;
  breakdown: ReturnType<typeof createRecruitBreakdown>;
  dailyWorkLogs: DailyWorkLog[];
  dailyWorkSavingDate: string;
  canEditDailyWork: boolean;
  loading: boolean;
  onSaveDailyWorkLog: (workDate: string, values: DailyWorkLogFormValues) => Promise<void>;
}) {
  return (
    <div className="staff-list-panel">
      <div className="list-header">
        <div>
          <span>个人招募数据</span>
          <h3>{month}</h3>
        </div>
        <label className="form-field scout-month-field">
          <span>年月份</span>
          <MonthSelect value={month} onChange={onMonthChange} />
        </label>
      </div>
      {loading ? <div className="table-state">正在统计招募数据...</div> : <RecruitBreakdownCards breakdown={breakdown} />}
      <DailyWorkLogPanel
        month={month}
        logs={dailyWorkLogs}
        savingDate={dailyWorkSavingDate}
        canEdit={canEditDailyWork}
        loading={loading}
        onSave={onSaveDailyWorkLog}
      />
    </div>
  );
}

function DailyWorkLogPanel({
  month,
  logs,
  savingDate,
  canEdit,
  loading,
  onSave,
}: {
  month: string;
  logs: DailyWorkLog[];
  savingDate: string;
  canEdit: boolean;
  loading: boolean;
  onSave: (workDate: string, values: DailyWorkLogFormValues) => Promise<void>;
}) {
  const rows = useMemo(() => createDailyWorkRows(logs, month), [logs, month]);

  return (
    <section className="scout-summary-section">
      <h4>每日工作记录</h4>
      {loading ? (
        <div className="table-state">正在读取每日工作记录...</div>
      ) : rows.length === 0 ? (
        <div className="table-state">本月暂无每日工作记录。</div>
      ) : (
        <div className="staff-table-wrap">
          <table className="staff-table scout-summary-table">
            <thead>
              <tr>
                <th>工作日期</th>
                <th>联系人数</th>
                <th>回复人数</th>
                <th>备注 / 今日进度</th>
                <th>回复率</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <DailyWorkLogRow
                  key={row.workDate}
                  workDate={row.workDate}
                  log={row.log}
                  editable={canEdit && isRecentDailyWorkDate(row.workDate)}
                  saving={savingDate === row.workDate}
                  onSave={onSave}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DailyWorkLogRow({
  workDate,
  log,
  editable,
  saving,
  onSave,
}: {
  workDate: string;
  log: DailyWorkLog | null;
  editable: boolean;
  saving: boolean;
  onSave: (workDate: string, values: DailyWorkLogFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<DailyWorkLogFormValues>({
    contacted_count: String(log?.contacted_count ?? 0),
    replied_count: String(log?.replied_count ?? 0),
    note: log?.note ?? '',
  });
  const [rowError, setRowError] = useState('');

  useEffect(() => {
    setValues({
      contacted_count: String(log?.contacted_count ?? 0),
      replied_count: String(log?.replied_count ?? 0),
      note: log?.note ?? '',
    });
    setRowError('');
  }, [log?.contacted_count, log?.note, log?.replied_count, workDate]);

  const contactedCount = Number(values.contacted_count) || 0;
  const repliedCount = Number(values.replied_count) || 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable) return;

    if (!Number.isInteger(contactedCount) || contactedCount < 0 || !Number.isInteger(repliedCount) || repliedCount < 0) {
      setRowError('人数必须是 0 或正整数。');
      return;
    }

    if (repliedCount > contactedCount) {
      setRowError('回复人数不可大于联系人数。');
      return;
    }

    setRowError('');
    await onSave(workDate, values);
  }

  return (
    <tr>
      <td>{workDate}</td>
      <td>
        {editable ? (
          <input className="daily-work-input" type="number" min="0" step="1" value={values.contacted_count} onChange={(event) => setValues({ ...values, contacted_count: event.target.value })} form={`daily-work-${workDate}`} />
        ) : (
          log?.contacted_count ?? 0
        )}
      </td>
      <td>
        {editable ? (
          <input className="daily-work-input" type="number" min="0" step="1" value={values.replied_count} onChange={(event) => setValues({ ...values, replied_count: event.target.value })} form={`daily-work-${workDate}`} />
        ) : (
          log?.replied_count ?? 0
        )}
      </td>
      <td>
        {editable ? (
          <textarea
            className="daily-work-input"
            rows={2}
            value={values.note}
            onChange={(event) => setValues({ ...values, note: event.target.value })}
            placeholder="例如：今天主要联系 TikTok，有 3 位主播有兴趣，明天继续跟进"
            form={`daily-work-${workDate}`}
            style={{ minWidth: 240, maxWidth: 360, resize: 'vertical' }}
          />
        ) : (
          <span title={log?.note ?? undefined} style={{ display: 'block', maxWidth: 360, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
            {log?.note || '-'}
          </span>
        )}
      </td>
      <td>{formatReplyRate(contactedCount, repliedCount)}</td>
      <td>
        {editable ? (
          <form id={`daily-work-${workDate}`} onSubmit={submit}>
            <button className="primary-button compact-button" type="submit" disabled={saving}>
              {saving ? '保存中...' : log ? '修改' : '填写'}
            </button>
            {rowError ? <small className="form-error">{rowError}</small> : null}
          </form>
        ) : (
          <span>只读</span>
        )}
      </td>
    </tr>
  );
}

function RecruitBreakdownCards({ breakdown }: { breakdown: ReturnType<typeof createRecruitBreakdown> }) {
  return (
    <div className="scout-stat-grid">
      <RecruitCard title="招募总数" summary={breakdown.total} />
      <RecruitCard title="TikTok" summary={breakdown.tiktok} />
      <RecruitCard title="抖音" summary={breakdown.douyin} />
    </div>
  );
}

function RecruitCard({ title, summary }: { title: string; summary: { total: number; plusFiveOne: number; nonFiveOne: number } }) {
  return (
    <section className="scout-stat-card">
      <h4>{title}</h4>
      <strong>{summary.total}</strong>
      <div>
        <span>5+1 数量</span>
        <b>{summary.plusFiveOne}</b>
      </div>
      <div>
        <span>非5+1 数量</span>
        <b>{summary.nonFiveOne}</b>
      </div>
    </section>
  );
}

function CandidatePanel({
  loading,
  candidates,
  followFilter,
  onFollowFilter,
  onEdit,
  onFollowUp,
  onStatus,
}: {
  loading: boolean;
  candidates: Candidate[];
  followFilter: CandidateFollowFilter;
  onFollowFilter: (filter: CandidateFollowFilter) => void;
  onEdit: (candidate: Candidate) => void;
  onFollowUp: (candidate: Candidate) => void;
  onStatus: (candidate: Candidate, status: 'accepted' | 'rejected') => void;
}) {
  return (
    <div className="staff-list-panel">
      <div className="list-header compact-list-header candidate-follow-header">
        <div className="candidate-follow-header-title">
          <span>跟进提醒</span>
          <h3>{getCandidateFollowFilterLabel(followFilter)}</h3>
        </div>
        <div className="segmented-control" role="group" aria-label="名单跟进筛选">
          {(['all', 'today', 'overdue'] as CandidateFollowFilter[]).map((filter) => (
            <button key={filter} className={followFilter === filter ? 'active' : ''} type="button" onClick={() => onFollowFilter(filter)}>
              {getCandidateFollowFilterLabel(filter)}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="table-state">正在读取名单...</div>
      ) : candidates.length === 0 ? (
        <div className="table-state">暂无名单。</div>
      ) : (
        <div className="staff-table-wrap">
          <table className="staff-table scout-table candidate-table">
            <thead>
              <tr>
                <th>主播</th>
                <th>平台身份</th>
                <th>跟进</th>
                <th>资料</th>
                <th>备注</th>
                <th>名单状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.id} className={candidate.status === 'accepted' ? 'candidate-accepted' : candidate.status === 'rejected' ? 'candidate-rejected' : ''}>
                  <td className="candidate-primary-cell">
                    <strong>{candidate.name}</strong>
                    <span>{[candidate.gender, candidate.age ? `${candidate.age}岁` : ''].filter(Boolean).join(' / ') || '-'}</span>
                  </td>
                  <td className="candidate-identity-cell">
                    <strong>{candidate.platform ? platformLabels[candidate.platform] : '-'}</strong>
                    <span>UID：{candidate.platform_user_id || '-'}</span>
                    <span>账号：{candidate.platform_account || '-'}</span>
                  </td>
                  <td className="candidate-follow-cell">
                    <span className="follow-status-badge">{getFollowStatusLabel(candidate.follow_status)}</span>
                    <span>{candidate.next_follow_up_date || '-'}</span>
                  </td>
                  <td className="candidate-detail-cell">
                    <strong>{candidate.talent || '-'}</strong>
                    <span>来源：{candidate.source || '-'}</span>
                    <span>联系：{candidate.contact || '-'}</span>
                  </td>
                  <td className="candidate-note-cell">
                    <strong>{candidate.current_job || '-'}</strong>
                    <span>{candidate.remark || '-'}</span>
                  </td>
                  <td>{getCandidateStatusLabel(candidate.status)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-button" type="button" onClick={() => onFollowUp(candidate)} aria-label="跟进">
                        <MessageSquarePlus size={16} />
                      </button>
                      <button className="icon-button" type="button" onClick={() => onEdit(candidate)} aria-label="编辑">
                        <Edit3 size={16} />
                      </button>
                      <button className="icon-button accept-button" type="button" onClick={() => onStatus(candidate, 'accepted')} aria-label="接受">
                        <Check size={16} />
                      </button>
                      <button className="icon-button reject-button" type="button" onClick={() => onStatus(candidate, 'rejected')} aria-label="拒绝">
                        <X size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OnboardingPanel({ canCreate, onCreate }: { canCreate: boolean; onCreate: (platform: CreatorPlatform) => void }) {
  return (
    <div className="scout-platform-grid">
      <button className="scout-platform-button" type="button" onClick={() => onCreate('tiktok')} disabled={!canCreate}>
        <strong>TikTok</strong>
        <span>录入 TikTok 主播</span>
      </button>
      <button className="scout-platform-button" type="button" onClick={() => onCreate('douyin')} disabled={!canCreate}>
        <strong>抖音</strong>
        <span>录入抖音主播</span>
      </button>
    </div>
  );
}

function CreatorStatsPanel({
  loading,
  creators,
  options,
  isManagement,
  canEdit,
  canManageStatus,
  platformFilter,
  regionFilter,
  scoutFilter,
  managerFilter,
  creatorTypeFilter,
  creatorStatusFilter,
  onPlatformFilter,
  onRegionFilter,
  onScoutFilter,
  onManagerFilter,
  onCreatorTypeFilter,
  onCreatorStatusFilter,
  managerDisplayNameByCreatorId,
  onEdit,
  onStatus,
}: {
  loading: boolean;
  creators: CreatorProfile[];
  options: ScoutOptions;
  isManagement: boolean;
  canEdit: boolean;
  canManageStatus: boolean;
  platformFilter: string;
  regionFilter: string;
  scoutFilter: string;
  managerFilter: string;
  creatorTypeFilter: string;
  creatorStatusFilter: CreatorStatusFilter;
  onPlatformFilter: (value: string) => void;
  onRegionFilter: (value: string) => void;
  onScoutFilter: (value: string) => void;
  onManagerFilter: (value: string) => void;
  onCreatorTypeFilter: (value: string) => void;
  onCreatorStatusFilter: (value: CreatorStatusFilter) => void;
  managerDisplayNameByCreatorId: Record<string, string>;
  onEdit: (creator: CreatorProfile) => void;
  onStatus: (creator: CreatorProfile) => void;
}) {
  return (
    <div className="staff-list-panel">
      <CreatorFilters
        options={options}
        isManagement={isManagement}
        platformFilter={platformFilter}
        regionFilter={regionFilter}
        scoutFilter={scoutFilter}
        managerFilter={managerFilter}
        creatorTypeFilter={creatorTypeFilter}
        creatorStatusFilter={creatorStatusFilter}
        onPlatformFilter={onPlatformFilter}
        onRegionFilter={onRegionFilter}
        onScoutFilter={onScoutFilter}
        onManagerFilter={onManagerFilter}
        onCreatorTypeFilter={onCreatorTypeFilter}
        onCreatorStatusFilter={onCreatorStatusFilter}
      />
      {loading ? (
        <div className="table-state">正在读取主播统计...</div>
      ) : creators.length === 0 ? (
        <div className="table-state">暂无主播资料。</div>
      ) : (
        <CreatorTable creators={creators} managerDisplayNameByCreatorId={managerDisplayNameByCreatorId} canEdit={canEdit} canManageStatus={canManageStatus} onEdit={onEdit} onStatus={onStatus} />
      )}
    </div>
  );
}

function CreatorFilters(props: {
  options: ScoutOptions;
  isManagement: boolean;
  platformFilter: string;
  regionFilter: string;
  scoutFilter: string;
  managerFilter: string;
  creatorTypeFilter: string;
  creatorStatusFilter: CreatorStatusFilter;
  onPlatformFilter: (value: string) => void;
  onRegionFilter: (value: string) => void;
  onScoutFilter: (value: string) => void;
  onManagerFilter: (value: string) => void;
  onCreatorTypeFilter: (value: string) => void;
  onCreatorStatusFilter: (value: CreatorStatusFilter) => void;
}) {
  return (
    <div className="scout-filters">
      <SelectField label="平台" value={props.platformFilter} onChange={props.onPlatformFilter}>
        <option value="">全部</option>
        <option value="tiktok">TikTok</option>
        <option value="douyin">抖音</option>
      </SelectField>
      <SelectField label="区域" value={props.regionFilter} onChange={props.onRegionFilter}>
        <option value="">全部</option>
        {props.options.regions.map((region) => (
          <option key={region.id} value={region.id}>
            {region.code}
          </option>
        ))}
      </SelectField>
      {props.isManagement ? (
        <EmployeeSelect label="星探" value={props.scoutFilter} employees={props.options.employees} onChange={props.onScoutFilter} includeAll />
      ) : null}
      <EmployeeSelect label="经纪人" value={props.managerFilter} employees={props.options.employees} onChange={props.onManagerFilter} includeAll />
      <SelectField label="主播形式" value={props.creatorTypeFilter} onChange={props.onCreatorTypeFilter}>
        <option value="">全部</option>
        {creatorTypes.map((type) => (
          <option key={type} value={type}>
            {creatorTypeLabels[type]}
          </option>
        ))}
      </SelectField>
      {props.isManagement ? (
        <SelectField label="状态" value={props.creatorStatusFilter} onChange={(value) => props.onCreatorStatusFilter(value as CreatorStatusFilter)}>
          <option value="active">在职</option>
          <option value="invalid">无效</option>
          <option value="all">全部</option>
        </SelectField>
      ) : null}
    </div>
  );
}

function CreatorTable({
  creators,
  managerDisplayNameByCreatorId,
  canEdit,
  canManageStatus,
  onEdit,
  onStatus,
}: {
  creators: CreatorProfile[];
  managerDisplayNameByCreatorId: Record<string, string>;
  canEdit: boolean;
  canManageStatus: boolean;
  onEdit: (creator: CreatorProfile) => void;
  onStatus: (creator: CreatorProfile) => void;
}) {
  return (
    <div className="staff-table-wrap">
      <table className="staff-table scout-table">
        <thead>
          <tr>
            <th>入会日期</th>
            <th>平台</th>
            <th>主播ID / UID</th>
            <th>主播号</th>
            <th>主播名字</th>
            <th>区域</th>
            <th>星探</th>
            <th>经纪人</th>
            <th>主播形式</th>
            <th>银行</th>
            <th>银行户口</th>
            {canEdit || canManageStatus ? <th>操作</th> : null}
          </tr>
        </thead>
        <tbody>
          {creators.map((creator) => (
            <tr key={creator.id}>
              <td>{creator.joined_date}</td>
              <td>{platformLabels[creator.platform]}</td>
              <td>{creator.platform_user_id}</td>
              <td>{creator.platform_account}</td>
              <td>{creator.creator_name}</td>
              <td>{creator.region?.code ?? '-'}</td>
              <td>{getEmployeeName(creator.scout) || '-'}</td>
              <td>{getEmployeeName(creator.manager) || managerDisplayNameByCreatorId[creator.id] || '-'}</td>
              <td>{creatorTypeLabels[creator.creator_type]}</td>
              <td>{creator.bank_name || '-'}</td>
              <td>{creator.bank_account || '-'}</td>
              {canEdit || canManageStatus ? (
                <td>
                  <div className="row-actions">
                    {canEdit ? (
                      <button className="icon-button" type="button" onClick={() => onEdit(creator)} aria-label="编辑主播">
                        <Edit3 size={16} />
                      </button>
                    ) : null}
                    {canManageStatus ? (
                      <button className="secondary-button compact-button" type="button" onClick={() => onStatus(creator)}>
                        状态
                      </button>
                    ) : null}
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreatorStatusModal({
  creator,
  saving,
  onClose,
  onSetInvalid,
  onSetActive,
}: {
  creator: CreatorProfile;
  saving: boolean;
  onClose: () => void;
  onSetInvalid: (creator: CreatorProfile, reason: string) => Promise<void>;
  onSetActive: (creator: CreatorProfile) => Promise<void>;
}) {
  const isInvalid = creator.status === 'invalid';
  const [showInvalidReason, setShowInvalidReason] = useState(false);
  const [invalidReason, setInvalidReason] = useState('');
  const [invalidReasonError, setInvalidReasonError] = useState('');

  async function submitInvalidReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = invalidReason.trim();
    if (!reason) {
      setInvalidReasonError('请填写无效原因。');
      return;
    }
    const confirmed = window.confirm('确认将该主播设为“无效”？\n\n该主播将不再计入主播数量和招募统计。\n流水页面会隐藏，但数据库历史流水不会删除。');
    if (!confirmed) return;
    await onSetInvalid(creator, reason);
  }

  async function submitRestore() {
    const confirmed = window.confirm('确认将该主播恢复为“在职”？\n\n恢复后该主播会重新计入原本主播数量和招募统计，原历史流水也会重新显示。');
    if (!confirmed) return;
    await onSetActive(creator);
  }

  return (
    <SystemModal
      title="主播状态"
      subtitle={creator.creator_name}
      ariaLabel="主播状态"
      onClose={onClose}
      footer={
        <button className="secondary-button compact-button" type="button" onClick={onClose}>
          关闭
        </button>
      }
    >
      <form className="form-grid" onSubmit={submitInvalidReason}>
        <label className="form-field">
          <span>当前状态</span>
          <strong>{isInvalid ? '无效' : '在职'}</strong>
        </label>
        <label className="form-field">
          <span>操作选项</span>
          <button className="secondary-button compact-button" type="button" disabled={saving} onClick={() => { if (isInvalid) void submitRestore(); else setShowInvalidReason(true); }}>
            {isInvalid ? '恢复' : '设为无效'}
          </button>
        </label>
        {!isInvalid && showInvalidReason ? (
          <label className="form-field form-field-wide">
            <span>无效原因</span>
            <textarea
              value={invalidReason}
              onChange={(event) => {
                setInvalidReason(event.target.value);
                if (event.target.value.trim()) setInvalidReasonError('');
              }}
              required
            />
            {invalidReasonError ? <small className="form-error">{invalidReasonError}</small> : null}
            <button className="primary-button compact-button" type="submit" disabled={saving}>
              {saving ? '提交中...' : '确认'}
            </button>
          </label>
        ) : null}
      </form>
    </SystemModal>
  );
}

function ManagementRecruitingPanel({
  loading,
  month,
  onMonthChange,
  regionFilter,
  onRegionFilter,
  options,
  scoutRecruitRows,
  regionRecruitRows,
  breakdown,
  workloadStats,
  workloadGranularity,
  onWorkloadGranularity,
}: {
  loading: boolean;
  month: string;
  onMonthChange: (value: string) => void;
  regionFilter: string;
  onRegionFilter: (value: string) => void;
  options: ScoutOptions;
  scoutRecruitRows: RecruitBreakdownRow[];
  regionRecruitRows: RecruitBreakdownRow[];
  breakdown: ReturnType<typeof createRecruitBreakdown>;
  workloadStats: ManagementWorkloadStat[];
  workloadGranularity: WorkloadGranularity;
  onWorkloadGranularity: (value: WorkloadGranularity) => void;
}) {
  const [workloadView, setWorkloadView] = useState<WorkloadView>(workloadGranularity);
  const [selectedWorkloadScout, setSelectedWorkloadScout] = useState<ManagementWorkloadStat | null>(null);
  const [recordGranularity, setRecordGranularity] = useState<ScoutRecordView>('daily');

  return (
    <div className="staff-list-panel">
      <div className="scout-filters">
        <label className="form-field">
          <span>年月份</span>
          <MonthSelect value={month} onChange={onMonthChange} />
        </label>
        <SelectField label="区域" value={regionFilter} onChange={onRegionFilter}>
          <option value="">全部</option>
          {options.regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.code}
            </option>
          ))}
        </SelectField>
      </div>
      {loading ? (
        <div className="table-state">正在统计总招募数据...</div>
      ) : (
        <>
          <ManagementRecruitBreakdownPanel breakdown={breakdown} />
          <SummaryTable title="区域总计" label="区域" rows={regionRecruitRows} />
          <SummaryTable title="每位星探统计" label="星探" rows={scoutRecruitRows} />
          <ManagementWorkloadPanel
            stats={workloadStats}
            granularity={workloadGranularity}
            onGranularity={onWorkloadGranularity}
            view={workloadView}
            onView={setWorkloadView}
            selectedScout={selectedWorkloadScout}
            onSelectedScout={setSelectedWorkloadScout}
            recordGranularity={recordGranularity}
            onRecordGranularity={setRecordGranularity}
          />
        </>
      )}
    </div>
  );
}

function ManagementWorkloadPanel({
  stats,
  granularity,
  onGranularity,
  view,
  onView,
  selectedScout,
  onSelectedScout,
  recordGranularity,
  onRecordGranularity,
}: {
  stats: ManagementWorkloadStat[];
  granularity: WorkloadGranularity;
  onGranularity: (value: WorkloadGranularity) => void;
  view: WorkloadView;
  onView: (value: WorkloadView) => void;
  selectedScout: ManagementWorkloadStat | null;
  onSelectedScout: (value: ManagementWorkloadStat | null) => void;
  recordGranularity: ScoutRecordView;
  onRecordGranularity: (value: ScoutRecordView) => void;
}) {
  const malaysiaToday = getMalaysiaDateString();
  const teamRows = getTeamWorkloadRows(stats, granularity, malaysiaToday);
  const teamTotal = summarizeWorkloadStats(teamRows);
  const scoutRows = getUniqueWorkloadScouts(stats);
  const selectedScoutRows = selectedScout
    ? stats
        .filter((row) => isSameWorkloadScout(row, selectedScout))
        .sort((first, second) => second.period_start.localeCompare(first.period_start))
    : [];
  const selectedScoutTotal = summarizeWorkloadStats(selectedScoutRows);
  const isScoutRecords = view === 'scout-records';
  const activeLabel = isScoutRecords ? '星探记录' : teamWorkloadViewLabels[granularity];

  function openTeamView(nextGranularity: WorkloadGranularity) {
    onView(nextGranularity);
    onSelectedScout(null);
    onGranularity(nextGranularity);
  }

  function openScoutRecords() {
    onView('scout-records');
    onSelectedScout(null);
  }

  function openScoutRecord(scout: ManagementWorkloadStat) {
    onSelectedScout(scout);
    onRecordGranularity('daily');
    onGranularity('daily');
  }

  function changeRecordGranularity(nextGranularity: ScoutRecordView) {
    onRecordGranularity(nextGranularity);
    onGranularity(nextGranularity);
  }

  return (
    <section className="scout-summary-section">
      <div className="list-header compact-list-header">
        <div>
          <span>星探工作量统计</span>
          <h3>{activeLabel}</h3>
        </div>
        <div className="segmented-control" role="group" aria-label="星探工作量统计视图">
          {workloadGranularities.map((item) => (
            <button key={item} className={!isScoutRecords && granularity === item ? 'active' : ''} type="button" onClick={() => openTeamView(item)}>
              {teamWorkloadViewLabels[item]}
            </button>
          ))}
          <button className={isScoutRecords ? 'active' : ''} type="button" onClick={openScoutRecords}>
            星探记录
          </button>
        </div>
      </div>

      {isScoutRecords ? (
        selectedScout ? (
          <div>
            <div className="list-header compact-list-header">
              <div style={{ display: 'grid', gap: 8 }}>
                <button className="secondary-button compact-button" type="button" onClick={() => onSelectedScout(null)} style={{ width: 'fit-content' }}>
                  ← 返回星探名单
                </button>
                <span>星探记录</span>
                <h3>{selectedScout.scout_name} · 工作记录</h3>
              </div>
            </div>
            <div className="segmented-control" role="group" aria-label="星探个人工作记录粒度">
              {(['daily', 'monthly'] as ScoutRecordView[]).map((item) => (
                <button key={item} className={recordGranularity === item ? 'active' : ''} type="button" onClick={() => changeRecordGranularity(item)}>
                  {scoutRecordViewLabels[item]}
                </button>
              ))}
            </div>
            {recordGranularity === 'daily' ? (
              <WorkloadStatsTable rows={selectedScoutRows} granularity={recordGranularity} personal />
            ) : (
              <ScoutMonthlySummary total={selectedScoutTotal} />
            )}
          </div>
        ) : (
          <ScoutRecordList rows={scoutRows} onOpen={openScoutRecord} />
        )
      ) : (
        <>
          <WorkloadTotalCards granularity={granularity} total={teamTotal} />
          <WorkloadStatsTable rows={teamRows} granularity={granularity} />
        </>
      )}
    </section>
  );
}

function WorkloadTotalCards({ granularity, total }: { granularity: WorkloadGranularity; total: { contacted_count: number; replied_count: number } }) {
  const prefix = granularity === 'daily' ? '今日' : granularity === 'weekly' ? '本周' : '本月';

  return (
    <div className="scout-total-panel">
      <h4>{prefix}团队总计</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(140px, 1fr))', gap: 10 }}>
        <WorkloadTotalCard title={`${prefix}联系人数`} value={total.contacted_count} />
        <WorkloadTotalCard title={`${prefix}回复人数`} value={total.replied_count} />
        <WorkloadTotalCard title={`${prefix}回复率`} value={formatReplyRate(total.contacted_count, total.replied_count)} />
      </div>
    </div>
  );
}

function WorkloadTotalCard({ title, value }: { title: string; value: number | string }) {
  return (
    <section className="scout-stat-card" style={{ gap: 8, minHeight: 0, padding: '12px 14px' }}>
      <h4 style={{ fontSize: 14 }}>{title}</h4>
      <strong style={{ fontSize: 24 }}>{value}</strong>
    </section>
  );
}

function ScoutMonthlySummary({ total }: { total: { contacted_count: number; replied_count: number } }) {
  return (
    <div className="scout-total-panel">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(140px, 1fr))', gap: 10 }}>
        <WorkloadTotalCard title="本月联系人数" value={total.contacted_count} />
        <WorkloadTotalCard title="本月回复人数" value={total.replied_count} />
        <WorkloadTotalCard title="本月回复率" value={formatReplyRate(total.contacted_count, total.replied_count)} />
      </div>
    </div>
  );
}

function ScoutRecordList({ rows, onOpen }: { rows: ManagementWorkloadStat[]; onOpen: (row: ManagementWorkloadStat) => void }) {
  if (rows.length === 0) {
    return <div className="table-state">暂无星探工作量记录。</div>;
  }

  return (
    <div className="staff-table-wrap">
      <table className="staff-table scout-summary-table">
        <thead>
          <tr>
            <th>星探姓名</th>
            <th>区域</th>
            <th>记录</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.scout_employee_id ?? row.scout_profile_id ?? row.scout_name}-${row.region_id ?? 'none'}`}>
              <td>{row.scout_name}</td>
              <td>{row.region_code ?? '-'}</td>
              <td>
                <button className="secondary-button compact-button" type="button" onClick={() => onOpen(row)}>
                  查看记录
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WorkloadStatsTable({ rows, granularity, personal = false }: { rows: ManagementWorkloadStat[]; granularity: WorkloadGranularity; personal?: boolean }) {
  if (rows.length === 0) {
    return <div className="table-state">暂无星探工作量记录。</div>;
  }

  return (
    <div className="staff-table-wrap">
      <table className="staff-table scout-summary-table">
        <thead>
          <tr>
            <th>{granularity === 'daily' && personal ? '日期' : granularity === 'monthly' && personal ? '月份' : '周期'}</th>
            {!personal ? <th>星探</th> : null}
            {!personal ? <th>区域</th> : null}
            <th>联系人数</th>
            <th>回复人数</th>
            <th>回复率</th>
            {granularity === 'daily' ? <th>备注 / 今日进度</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.period_start}-${row.period_end}-${row.scout_employee_id ?? row.scout_profile_id ?? row.scout_name}-${row.region_id ?? 'none'}`}>
              <td>{row.period_label}</td>
              {!personal ? <td>{row.scout_name}</td> : null}
              {!personal ? <td>{row.region_code ?? '-'}</td> : null}
              <td>{row.contacted_count}</td>
              <td>{row.replied_count}</td>
              <td>{formatReplyRate(row.contacted_count, row.replied_count)}</td>
              {granularity === 'daily' ? (
                <td>
                  <span title={row.note ?? undefined} style={{ display: 'block', maxWidth: 420, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                    {row.note || '-'}
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getTeamWorkloadRows(stats: ManagementWorkloadStat[], granularity: WorkloadGranularity, malaysiaToday: string) {
  if (granularity === 'daily') {
    return stats.filter((row) => row.period_start === malaysiaToday);
  }

  if (granularity === 'weekly') {
    return stats.filter((row) => row.period_start <= malaysiaToday && malaysiaToday <= row.period_end);
  }

  return stats;
}

function summarizeWorkloadStats(rows: ManagementWorkloadStat[]) {
  return rows.reduce(
    (summary, row) => ({
      contacted_count: summary.contacted_count + row.contacted_count,
      replied_count: summary.replied_count + row.replied_count,
    }),
    { contacted_count: 0, replied_count: 0 },
  );
}

function getUniqueWorkloadScouts(rows: ManagementWorkloadStat[]) {
  const scouts = new Map<string, ManagementWorkloadStat>();

  rows.forEach((row) => {
    const key = getWorkloadScoutKey(row);
    if (!scouts.has(key)) scouts.set(key, row);
  });

  return Array.from(scouts.values()).sort((first, second) => first.scout_name.localeCompare(second.scout_name));
}

function isSameWorkloadScout(first: ManagementWorkloadStat, second: ManagementWorkloadStat) {
  if (first.scout_profile_id && second.scout_profile_id) return first.scout_profile_id === second.scout_profile_id;
  if (first.scout_employee_id && second.scout_employee_id) return first.scout_employee_id === second.scout_employee_id;
  return first.scout_name === second.scout_name;
}

function getWorkloadScoutKey(row: ManagementWorkloadStat) {
  return row.scout_profile_id ?? row.scout_employee_id ?? `${row.scout_name}-${row.region_id ?? 'none'}`;
}

type RecruitBreakdownRow = {
  key: string;
  label: string;
  breakdown: ReturnType<typeof createRecruitBreakdown>;
};

function createRegionRecruitRows(creators: CreatorProfile[]): RecruitBreakdownRow[] {
  const groups = new Map<string, { label: string; creators: CreatorProfile[] }>();

  creators.forEach((creator) => {
    const key = creator.region_id ?? 'none';
    const label = `${creator.region?.code ?? '未分区'} 总计`;
    const group = groups.get(key);

    if (group) {
      group.creators.push(creator);
      return;
    }

    groups.set(key, { label, creators: [creator] });
  });

  return Array.from(groups.entries())
    .map(([key, group]) => ({
      key,
      label: group.label,
      breakdown: createRecruitBreakdown(group.creators),
    }))
    .sort((first, second) => first.label.localeCompare(second.label));
}

function createScoutRecruitRows(creators: CreatorProfile[]): RecruitBreakdownRow[] {
  const groups = new Map<string, { label: string; creators: CreatorProfile[] }>();

  creators.forEach((creator) => {
    const key = creator.scout_employee_id ?? creator.scout_profile_id ?? 'none';
    const label = getEmployeeName(creator.scout) || '未分配星探';
    const group = groups.get(key);

    if (group) {
      group.creators.push(creator);
      return;
    }

    groups.set(key, { label, creators: [creator] });
  });

  return Array.from(groups.entries())
    .map(([key, group]) => ({
      key,
      label: group.label,
      breakdown: createRecruitBreakdown(group.creators),
    }))
    .sort((first, second) => first.label.localeCompare(second.label));
}

function SummaryTable({ title, label, rows }: { title: string; label: string; rows: RecruitBreakdownRow[] }) {
  return (
    <section className="scout-summary-section">
      <h4 style={summarySectionTitleStyle}>{title}</h4>
      <div className="staff-table-wrap">
        <table className="staff-table scout-summary-table" style={summaryTableStyle}>
          <colgroup>
            <col style={{ width: '22%' }} />
            <col span={3} style={{ width: '13%' }} />
            <col span={3} style={{ width: '13%' }} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} style={summaryHeaderCellStyle}>{label}</th>
              <th colSpan={3} style={{ ...summaryHeaderCellStyle, ...tiktokHeaderCellStyle }}>
                <PlatformLogoTitle logoUrl={tiktokLogoUrl} title="TikTok" logoSize={30} fontSize={17} />
              </th>
              <th colSpan={3} style={{ ...summaryHeaderCellStyle, ...douyinHeaderCellStyle }}>
                <PlatformLogoTitle logoUrl={douyinLogoUrl} title="抖音" logoSize={30} fontSize={17} />
              </th>
            </tr>
            <tr>
              {summaryMetricLabels.map((metric) => (
                <th key={`tiktok-${metric}`} style={{ ...summarySubHeaderCellStyle, ...tiktokSubHeaderCellStyle }}>{metric}</th>
              ))}
              {summaryMetricLabels.map((metric) => (
                <th key={`douyin-${metric}`} style={{ ...summarySubHeaderCellStyle, ...douyinSubHeaderCellStyle }}>{metric}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td style={summaryLabelCellStyle}>{row.label}</td>
                <td style={summaryNumberCellStyle}>{row.breakdown.tiktok.total}</td>
                <td style={summaryNumberCellStyle}>{row.breakdown.tiktok.plusFiveOne}</td>
                <td style={summaryNumberCellStyle}>{row.breakdown.tiktok.nonFiveOne}</td>
                <td style={summaryNumberCellStyle}>{row.breakdown.douyin.total}</td>
                <td style={summaryNumberCellStyle}>{row.breakdown.douyin.plusFiveOne}</td>
                <td style={summaryNumberCellStyle}>{row.breakdown.douyin.nonFiveOne}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const summaryMetricLabels = ['招募总数', '5+1', '非5+1'];

const summarySectionTitleStyle = {
  fontSize: 18,
  fontWeight: 600,
} as const;

const summaryTableStyle = {
  tableLayout: 'fixed',
  minWidth: 0,
  width: '100%',
  borderCollapse: 'collapse',
} as const;

const summaryHeaderCellStyle = {
  border: '1px solid #d8dee8',
  textAlign: 'center',
  verticalAlign: 'middle',
  whiteSpace: 'normal',
  padding: '13px 12px',
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.35,
} as const;

const summarySubHeaderCellStyle = {
  ...summaryHeaderCellStyle,
  padding: '12px 12px',
  fontSize: 15,
  fontWeight: 600,
} as const;

const tiktokHeaderCellStyle = {
  background: '#eaf4ff',
  color: '#24628f',
} as const;

const douyinHeaderCellStyle = {
  background: '#fff0f5',
  color: '#9a3f64',
} as const;

const tiktokSubHeaderCellStyle = {
  background: '#f5faff',
} as const;

const douyinSubHeaderCellStyle = {
  background: '#fff7fa',
} as const;

const summaryLabelCellStyle = {
  border: '1px solid #d8dee8',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 16,
  padding: '13px 12px',
  lineHeight: 1.35,
} as const;

const summaryNumberCellStyle = {
  border: '1px solid #d8dee8',
  textAlign: 'center',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 18,
  fontWeight: 600,
  padding: '13px 12px',
  lineHeight: 1.35,
} as const;

function ManagementRecruitBreakdownPanel({ breakdown }: { breakdown: ReturnType<typeof createRecruitBreakdown> }) {
  return (
    <div className="scout-total-panel">
      <h4 style={summarySectionTitleStyle}>DY Group 总计</h4>
      <div className="staff-table-wrap">
        <table className="staff-table scout-summary-table" style={summaryTableStyle}>
          <colgroup>
            <col span={3} style={{ width: '16.66%' }} />
            <col span={3} style={{ width: '16.66%' }} />
          </colgroup>
          <thead>
            <tr>
              <th colSpan={3} style={{ ...summaryHeaderCellStyle, ...tiktokHeaderCellStyle }}>
                <PlatformLogoTitle logoUrl={tiktokLogoUrl} title="TikTok" logoSize={36} fontSize={18} />
              </th>
              <th colSpan={3} style={{ ...summaryHeaderCellStyle, ...douyinHeaderCellStyle }}>
                <PlatformLogoTitle logoUrl={douyinLogoUrl} title="抖音" logoSize={36} fontSize={18} />
              </th>
            </tr>
            <tr>
              {summaryMetricLabels.map((metric) => (
                <th key={`group-tiktok-${metric}`} style={{ ...summarySubHeaderCellStyle, ...tiktokSubHeaderCellStyle }}>{metric}</th>
              ))}
              {summaryMetricLabels.map((metric) => (
                <th key={`group-douyin-${metric}`} style={{ ...summarySubHeaderCellStyle, ...douyinSubHeaderCellStyle }}>{metric}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={summaryNumberCellStyle}>{breakdown.tiktok.total}</td>
              <td style={summaryNumberCellStyle}>{breakdown.tiktok.plusFiveOne}</td>
              <td style={summaryNumberCellStyle}>{breakdown.tiktok.nonFiveOne}</td>
              <td style={summaryNumberCellStyle}>{breakdown.douyin.total}</td>
              <td style={summaryNumberCellStyle}>{breakdown.douyin.plusFiveOne}</td>
              <td style={summaryNumberCellStyle}>{breakdown.douyin.nonFiveOne}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlatformLogoTitle({ logoUrl, title, logoSize, fontSize }: { logoUrl: string; title: string; logoSize: number; fontSize: number }) {
  return (
    <span style={{ ...platformLogoTitleStyle, fontSize }}>
      <img src={logoUrl} alt="" aria-hidden="true" style={{ ...platformLogoStyle, width: logoSize, height: logoSize }} />
      <span>{title}</span>
    </span>
  );
}

const platformLogoTitleStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  maxWidth: '100%',
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
  fontWeight: 600,
  lineHeight: 1.2,
} as const;

const platformLogoStyle = {
  display: 'block',
  flex: '0 0 auto',
  objectFit: 'contain',
} as const;

function CandidateModal(props: {
  values: CandidateFormValues;
  editingCandidate: Candidate | null;
  saving: boolean;
  onChange: (values: CandidateFormValues) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <SystemModal
      title={props.editingCandidate ? '编辑名单' : '新增名单'}
      ariaLabel="名单资料"
      onClose={props.onClose}
      footer={
        <>
          <button className="secondary-button compact-button" type="button" onClick={props.onClose}>
            取消
          </button>
          <button className="primary-button compact-button" type="submit" form="candidate-form" disabled={props.saving}>
            {props.saving ? '保存中...' : '保存'}
          </button>
        </>
      }
    >
      <form id="candidate-form" onSubmit={props.onSubmit}>
        <div className="form-grid">
          <div className="form-section-title">基本资料</div>
          <TextField label="姓名" value={props.values.name} onChange={(value) => props.onChange({ ...props.values, name: value })} required />
          <TextField label="性别" value={props.values.gender} onChange={(value) => props.onChange({ ...props.values, gender: value })} />
          <TextField label="年龄" type="number" value={props.values.age} onChange={(value) => props.onChange({ ...props.values, age: value })} />
          <TextField label="来源" value={props.values.source} onChange={(value) => props.onChange({ ...props.values, source: value })} />
          <TextField label="联系方式" value={props.values.contact} onChange={(value) => props.onChange({ ...props.values, contact: value })} />
          <TextField label="目前就职" value={props.values.current_job} onChange={(value) => props.onChange({ ...props.values, current_job: value })} />
          <label className="form-field form-field-wide">
            <span>备注</span>
            <textarea value={props.values.remark} onChange={(event) => props.onChange({ ...props.values, remark: event.target.value })} />
          </label>

          <div className="form-section-title">主播资料</div>
          <SelectField label="平台" value={props.values.platform} onChange={(value) => props.onChange({ ...props.values, platform: value as CandidateFormValues['platform'] })}>
            <option value="">未填写</option>
            <option value="tiktok">TikTok</option>
            <option value="douyin">抖音</option>
          </SelectField>
          <TextField label="主播 UID" value={props.values.platform_user_id} onChange={(value) => props.onChange({ ...props.values, platform_user_id: value })} />
          <TextField label="主播账号" value={props.values.platform_account} onChange={(value) => props.onChange({ ...props.values, platform_account: value })} />
          <TextField label="才艺" value={props.values.talent} onChange={(value) => props.onChange({ ...props.values, talent: value })} />
        </div>
      </form>
    </SystemModal>
  );
}

function FollowUpModal(props: {
  candidate: Candidate;
  values: CandidateFollowUpFormValues;
  history: CandidateFollowUpHistory[];
  loading: boolean;
  saving: boolean;
  onChange: (values: CandidateFollowUpFormValues) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isCurrentStopped = props.candidate.follow_status === 'stopped';
  const isStopping = props.values.to_follow_status === 'stopped';
  const statusOptions: FollowStatus[] = isCurrentStopped ? ['pending', 'following'] : [...followStatuses, 'stopped'];

  function updateStatus(status: FollowStatus) {
    props.onChange({
      ...props.values,
      to_follow_status: status,
      next_follow_up_date: status === 'stopped' ? '' : props.values.next_follow_up_date,
      stopped_reason: status === 'stopped' ? props.values.stopped_reason : '',
    });
  }

  return (
    <SystemModal
      title={isCurrentStopped ? '重新启用跟进' : '新增跟进记录'}
      subtitle={props.candidate.name}
      ariaLabel="跟进记录"
      onClose={props.onClose}
      footer={
        <>
          <button className="secondary-button compact-button" type="button" onClick={props.onClose}>
            取消
          </button>
          <button className="primary-button compact-button" type="submit" form="candidate-follow-up-form" disabled={props.saving}>
            {props.saving ? '保存中...' : '保存跟进'}
          </button>
        </>
      }
    >
      <div className="follow-up-modal">
        <section className="follow-up-summary">
          <div>
            <span>平台</span>
            <strong>{props.candidate.platform ? platformLabels[props.candidate.platform] : '-'}</strong>
          </div>
          <div>
            <span>UID</span>
            <strong>{props.candidate.platform_user_id || '-'}</strong>
          </div>
          <div>
            <span>账号</span>
            <strong>{props.candidate.platform_account || '-'}</strong>
          </div>
          <div>
            <span>当前跟进</span>
            <strong>{getFollowStatusLabel(props.candidate.follow_status)}</strong>
          </div>
          <div>
            <span>下次跟进</span>
            <strong>{props.candidate.next_follow_up_date || '-'}</strong>
          </div>
        </section>

        <section className="follow-up-history">
          <div className="form-section-title">跟进历史</div>
          {props.loading ? (
            <div className="table-state">正在读取跟进历史...</div>
          ) : props.history.length === 0 ? (
            <div className="table-state">暂无跟进历史。</div>
          ) : (
            <div className="follow-up-history-list">
              {props.history.map((item) => (
                <article key={item.id} className="follow-up-history-item">
                  <div className="follow-up-history-topline">
                    <strong>{getFollowUpActionLabel(item.action_type)}</strong>
                    <span>{formatDateTime(item.created_at)}</span>
                  </div>
                  <div className="follow-up-history-status">
                    {getFollowStatusLabel(item.from_follow_status)} → {getFollowStatusLabel(item.to_follow_status)}
                  </div>
                  {item.note ? <p>{item.note}</p> : null}
                  {item.stopped_reason ? <p>停止原因：{item.stopped_reason}</p> : null}
                  <small>下次跟进：{item.next_follow_up_date || '-'}</small>
                </article>
              ))}
            </div>
          )}
        </section>

        <form id="candidate-follow-up-form" onSubmit={props.onSubmit}>
          <div className="form-grid">
            <div className="form-section-title">{isCurrentStopped ? '重新启用' : '新增记录'}</div>
            <SelectField label="新状态" value={props.values.to_follow_status} onChange={(value) => updateStatus(value as FollowStatus)}>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {getFollowStatusLabel(status)}
                </option>
              ))}
            </SelectField>
            {!isStopping ? (
              <label className="form-field">
                <span>下次跟进日期</span>
                <input type="date" value={props.values.next_follow_up_date} onChange={(event) => props.onChange({ ...props.values, next_follow_up_date: event.target.value })} />
              </label>
            ) : null}
            <label className="form-field form-field-wide">
              <span>备注</span>
              <textarea value={props.values.note} onChange={(event) => props.onChange({ ...props.values, note: event.target.value })} />
            </label>
            {isStopping ? (
              <label className="form-field form-field-wide">
                <span>停止原因</span>
                <textarea required value={props.values.stopped_reason} onChange={(event) => props.onChange({ ...props.values, stopped_reason: event.target.value })} />
              </label>
            ) : (
              <div className="form-field form-field-wide">
                <span>快捷跟进日期</span>
                <div className="quick-date-actions">
                  <button type="button" className="secondary-button compact-button" onClick={() => props.onChange({ ...props.values, next_follow_up_date: getMalaysiaDateString(1) })}>
                    明天
                  </button>
                  <button type="button" className="secondary-button compact-button" onClick={() => props.onChange({ ...props.values, next_follow_up_date: getMalaysiaDateString(3) })}>
                    3天后
                  </button>
                  <button type="button" className="secondary-button compact-button" onClick={() => props.onChange({ ...props.values, next_follow_up_date: getMalaysiaDateString(7) })}>
                    7天后
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>
    </SystemModal>
  );
}

function CreatorModal(props: {
  values: CreatorFormValues;
  options: ScoutOptions;
  managerOptions: OnboardingManagerOption[];
  editingCreator: CreatorProfile | null;
  saving: boolean;
  onChange: (values: CreatorFormValues) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const requiresBank = props.values.creator_type === '5+1' || props.values.creator_type === 'company';
  const platformIdLabel = props.values.platform === 'tiktok' ? 'TikTok ID' : '抖音 UID';
  const platformAccountLabel = props.values.platform === 'tiktok' ? '用户名' : '抖音号';
  const platformNameLabel = props.values.platform === 'tiktok' ? 'TikTok 名字' : '抖音名字';

  return (
    <SystemModal
      title={props.editingCreator ? '编辑主播资料' : platformLabels[props.values.platform]}
      subtitle={props.editingCreator ? '总主播统计' : '入公会'}
      ariaLabel="主播资料"
      onClose={props.onClose}
      footer={
        <>
          <button className="secondary-button compact-button" type="button" onClick={props.onClose}>
            取消
          </button>
          <button className="primary-button compact-button" type="submit" form="creator-form" disabled={props.saving}>
            {props.saving ? '保存中...' : '确认'}
          </button>
        </>
      }
    >
      <form id="creator-form" onSubmit={props.onSubmit}>
        <div className="form-grid">
          <SelectField label="平台" value={props.values.platform} onChange={(value) => props.onChange({ ...props.values, platform: value as CreatorPlatform })}>
            <option value="tiktok">TikTok</option>
            <option value="douyin">抖音</option>
          </SelectField>
          <TextField label="入会日期" type="date" value={props.values.joined_date} onChange={(value) => props.onChange({ ...props.values, joined_date: value })} required />
          <TextField label={platformIdLabel} value={props.values.platform_user_id} onChange={(value) => props.onChange({ ...props.values, platform_user_id: value })} required />
          <TextField label={platformAccountLabel} value={props.values.platform_account} onChange={(value) => props.onChange({ ...props.values, platform_account: value })} required />
          <SelectField label="区域" value={props.values.region_id} onChange={(value) => props.onChange({ ...props.values, region_id: value })} required>
            <option value="">请选择</option>
            {props.options.regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.code}
              </option>
            ))}
          </SelectField>
          <TextField label={platformNameLabel} value={props.values.creator_name} onChange={(value) => props.onChange({ ...props.values, creator_name: value })} required />
          <EmployeeSelect label="星探" value={props.values.scout_employee_id} employees={props.options.employees} onChange={(value) => props.onChange({ ...props.values, scout_employee_id: value })} required />
          <OnboardingManagerSelect label="经纪人" value={props.values.manager_employee_id} managers={props.managerOptions} onChange={(value) => props.onChange({ ...props.values, manager_employee_id: value })} required />
          <SelectField label="主播形式" value={props.values.creator_type} onChange={(value) => props.onChange({ ...props.values, creator_type: value as CreatorType })}>
            {creatorTypes.map((type) => (
              <option key={type} value={type}>
                {creatorTypeLabels[type]}
              </option>
            ))}
          </SelectField>
          {requiresBank ? (
            <>
              <TextField label="银行" value={props.values.bank_name} onChange={(value) => props.onChange({ ...props.values, bank_name: value })} />
              <TextField label="银行户口" value={props.values.bank_account} onChange={(value) => props.onChange({ ...props.values, bank_account: value })} />
            </>
          ) : null}
        </div>
      </form>
    </SystemModal>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} required={required}>
        {children}
      </select>
    </label>
  );
}

function EmployeeSelect({
  label,
  value,
  employees,
  onChange,
  required,
  includeAll,
}: {
  label: string;
  value: string;
  employees: ScoutOptions['employees'];
  onChange: (value: string) => void;
  required?: boolean;
  includeAll?: boolean;
}) {
  return (
    <SelectField label={label} value={value} onChange={onChange} required={required}>
      <option value="">{includeAll ? '全部' : '请选择'}</option>
      {employees.map((employee) => (
        <option key={employee.id} value={employee.id}>
          {employee.nickname || employee.full_name}
        </option>
      ))}
    </SelectField>
  );
}

function OnboardingManagerSelect({
  label,
  value,
  managers,
  onChange,
  required,
}: {
  label: string;
  value: string;
  managers: OnboardingManagerOption[];
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <SelectField label={label} value={value} onChange={onChange} required={required}>
      <option value="">请选择</option>
      {managers.map((manager) => (
        <option key={manager.id} value={manager.id}>
          {manager.display_name}
        </option>
      ))}
    </SelectField>
  );
}

function createDailyWorkRows(logs: DailyWorkLog[], month: string) {
  const rows = new Map<string, DailyWorkLog | null>();

  logs.forEach((log) => {
    rows.set(log.work_date, log);
  });

  [getLocalDateString(new Date()), getLocalDateString(addLocalDays(new Date(), -1))]
    .filter((workDate) => workDate.startsWith(month))
    .forEach((workDate) => {
      if (!rows.has(workDate)) rows.set(workDate, null);
    });

  return Array.from(rows.entries())
    .map(([workDate, log]) => ({ workDate, log }))
    .sort((first, second) => second.workDate.localeCompare(first.workDate));
}

function isRecentDailyWorkDate(workDate: string) {
  const today = getLocalDateString(new Date());
  const yesterday = getLocalDateString(addLocalDays(new Date(), -1));
  return workDate === today || workDate === yesterday;
}

function formatReplyRate(contactedCount: number, repliedCount: number) {
  if (contactedCount <= 0) return '0%';
  return `${((repliedCount / contactedCount) * 100).toFixed(2)}%`;
}

function addLocalDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function getLocalDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMalaysiaDateString(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return date.toISOString().slice(0, 10);
}

function getFollowStatusLabel(status: FollowStatus | null | undefined) {
  if (status === 'following') return '跟进中';
  if (status === 'interview') return '已约面试';
  if (status === 'ready_onboarding') return '准备入公会';
  if (status === 'stopped') return '停止跟进';
  return '待跟进';
}

function getCandidateFollowFilterLabel(filter: CandidateFollowFilter) {
  if (filter === 'today') return '今日待跟进';
  if (filter === 'overdue') return '已逾期';
  return '全部';
}

function getCandidateStatusLabel(status: Candidate['status']) {
  if (status === 'accepted') return '已接受';
  if (status === 'rejected') return '已拒绝';
  return '待处理';
}

function getFollowUpActionLabel(action: CandidateFollowUpHistory['action_type']) {
  if (action === 'stopped') return '停止跟进';
  if (action === 'reopened') return '重新启用';
  return '跟进记录';
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return '未知错误';
}
