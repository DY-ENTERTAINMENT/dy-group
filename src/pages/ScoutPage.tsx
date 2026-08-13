import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Edit3, Plus, RefreshCw, X } from 'lucide-react';
import { MonthSelect } from '../components/MonthSelect';
import { SystemModal } from '../components/SystemModal';
import { useAuth } from '../hooks/useAuth';
import { usePermissions } from '../hooks/usePermissions';
import {
  createRecruitBreakdown,
  createRegionRecruitSummaries,
  createScoutRecruitSummaries,
  creatorTypeLabels,
  type DailyWorkLog,
  type DailyWorkLogFormValues,
  filterCreatorsByMonth,
  getEmployeeName,
  platformLabels,
  scoutService,
  summarizeCreators,
  type Candidate,
  type CandidateFormValues,
  type CreatorManagerDisplayName,
  type CreatorFormValues,
  type CreatorPlatform,
  type CreatorProfile,
  type CreatorStatusFilter,
  type CreatorType,
  type OnboardingManagerOption,
  type ScoutOptions,
} from '../services/scout.service';

type ScoutPageMode = 'personal-recruiting' | 'recruit-list' | 'onboarding' | 'personal-streamers' | 'management-recruiting' | 'management-streamers';

type ScoutPageProps = {
  mode: ScoutPageMode;
};

const currentMonth = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);

const emptyCandidateForm: CandidateFormValues = {
  name: '',
  gender: '',
  age: '',
  source: '',
  contact: '',
  current_job: '',
  remark: '',
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
  const [month, setMonth] = useState(currentMonth);
  const [platformFilter, setPlatformFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [scoutFilter, setScoutFilter] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [creatorTypeFilter, setCreatorTypeFilter] = useState('');
  const [creatorStatusFilter, setCreatorStatusFilter] = useState<CreatorStatusFilter>('active');
  const [candidateForm, setCandidateForm] = useState<CandidateFormValues>(emptyCandidateForm);
  const [editingCandidate, setEditingCandidate] = useState<Candidate | null>(null);
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
  const managementTotal = useMemo(() => summarizeCreators(managementMonthCreators), [managementMonthCreators]);
  const scoutSummaries = useMemo(() => createScoutRecruitSummaries(managementMonthCreators), [managementMonthCreators]);
  const regionSummaries = useMemo(() => createRegionRecruitSummaries(managementMonthCreators), [managementMonthCreators]);
  const sortedCandidates = useMemo(
    () =>
      [...candidates].sort((first, second) => {
        const firstSettled = first.status === 'pending' ? 0 : 1;
        const secondSettled = second.status === 'pending' ? 0 : 1;
        if (firstSettled !== secondSettled) return firstSettled - secondSettled;
        return new Date(second.updated_at).getTime() - new Date(first.updated_at).getTime();
      }),
    [candidates],
  );

  useEffect(() => {
    void loadData();
  }, [creatorStatusFilter, mode, month, profile?.id]);

  async function loadData() {
    if (!profile?.id && !isManagementMode) return;
    setLoading(true);
    setError('');

    try {
      const [nextOptions, nextCreators, nextCandidates, nextDailyWorkLogs] = await Promise.all([
        scoutService.getOptions(),
        scoutService.listCreators({ personalProfileId, status: mode === 'management-streamers' ? creatorStatusFilter : undefined }),
        mode === 'recruit-list' && profile?.id ? scoutService.listCandidates(profile.id) : Promise.resolve([]),
        mode === 'personal-recruiting' ? scoutService.listDailyWorkLogs(month) : Promise.resolve([]),
      ]);

      setOptions(nextOptions);
      setCreators(nextCreators);
      setCandidates(nextCandidates);
      setDailyWorkLogs(nextDailyWorkLogs);

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
        <CandidatePanel loading={loading} candidates={sortedCandidates} onEdit={openCandidateEdit} onStatus={setCandidateStatus} />
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
          scoutSummaries={scoutSummaries}
          regionSummaries={regionSummaries}
          total={managementTotal}
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
  });
  const [rowError, setRowError] = useState('');

  useEffect(() => {
    setValues({
      contacted_count: String(log?.contacted_count ?? 0),
      replied_count: String(log?.replied_count ?? 0),
    });
    setRowError('');
  }, [log?.contacted_count, log?.replied_count, workDate]);

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
  onEdit,
  onStatus,
}: {
  loading: boolean;
  candidates: Candidate[];
  onEdit: (candidate: Candidate) => void;
  onStatus: (candidate: Candidate, status: 'accepted' | 'rejected') => void;
}) {
  return (
    <div className="staff-list-panel">
      {loading ? (
        <div className="table-state">正在读取名单...</div>
      ) : candidates.length === 0 ? (
        <div className="table-state">暂无名单。</div>
      ) : (
        <div className="staff-table-wrap">
          <table className="staff-table scout-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>性别</th>
                <th>年龄</th>
                <th>来源</th>
                <th>联系方式</th>
                <th>目前就职</th>
                <th>备注</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.id} className={candidate.status === 'accepted' ? 'candidate-accepted' : candidate.status === 'rejected' ? 'candidate-rejected' : ''}>
                  <td>{candidate.name}</td>
                  <td>{candidate.gender || '-'}</td>
                  <td>{candidate.age || '-'}</td>
                  <td>{candidate.source || '-'}</td>
                  <td>{candidate.contact || '-'}</td>
                  <td>{candidate.current_job || '-'}</td>
                  <td>{candidate.remark || '-'}</td>
                  <td>{getCandidateStatusLabel(candidate.status)}</td>
                  <td>
                    <div className="row-actions">
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
  scoutSummaries,
  regionSummaries,
  total,
}: {
  loading: boolean;
  month: string;
  onMonthChange: (value: string) => void;
  regionFilter: string;
  onRegionFilter: (value: string) => void;
  options: ScoutOptions;
  scoutSummaries: ReturnType<typeof createScoutRecruitSummaries>;
  regionSummaries: ReturnType<typeof createRegionRecruitSummaries>;
  total: ReturnType<typeof summarizeCreators>;
}) {
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
          <SummaryTable title="每位星探统计" label="星探" rows={scoutSummaries.map((row) => ({ label: row.scoutName, summary: row }))} />
          <SummaryTable title="区域总计" label="区域" rows={regionSummaries.map((row) => ({ label: `${row.regionName} 总计`, summary: row }))} />
          <div className="scout-total-panel">
            <h4>DY Group 总计</h4>
            <RecruitMetricRow summary={total} />
          </div>
        </>
      )}
    </div>
  );
}

function SummaryTable({ title, label, rows }: { title: string; label: string; rows: Array<{ label: string; summary: ReturnType<typeof summarizeCreators> }> }) {
  return (
    <section className="scout-summary-section">
      <h4>{title}</h4>
      <div className="staff-table-wrap">
        <table className="staff-table scout-summary-table">
          <thead>
            <tr>
              <th>{label}</th>
              <th>招募总数</th>
              <th>TikTok</th>
              <th>抖音</th>
              <th>5+1</th>
              <th>非5+1</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.summary.total}</td>
                <td>{row.summary.tiktok}</td>
                <td>{row.summary.douyin}</td>
                <td>{row.summary.plusFiveOne}</td>
                <td>{row.summary.nonFiveOne}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecruitMetricRow({ summary }: { summary: ReturnType<typeof summarizeCreators> }) {
  return (
    <div className="scout-total-grid">
      <span>招募总数 <b>{summary.total}</b></span>
      <span>TikTok <b>{summary.tiktok}</b></span>
      <span>抖音 <b>{summary.douyin}</b></span>
      <span>5+1 <b>{summary.plusFiveOne}</b></span>
      <span>非5+1 <b>{summary.nonFiveOne}</b></span>
    </div>
  );
}

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
        </div>
      </form>
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

function getCandidateStatusLabel(status: Candidate['status']) {
  if (status === 'accepted') return '已接受';
  if (status === 'rejected') return '已拒绝';
  return '待处理';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return '未知错误';
}
