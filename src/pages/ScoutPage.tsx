import { Fragment, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Check, ChevronRight, Edit3, Layers, MessageSquarePlus, Plus, RefreshCw, Search, UsersRound, X } from 'lucide-react';
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
  type CreatorEntityFormValues,
  type CreatorManagerDisplayName,
  type CreatorRegistrationType,
  type CreatorFormValues,
  type CreatorPlatform,
  type CreatorPlatformFormValues,
  type CreatorProfile,
  type CreatorStatus,
  type CreatorStatusFilter,
  type CreatorType,
  type FollowStatus,
  type OnboardingManagerOption,
  type OnboardingCollaboratorOption,
  type OnboardingScoutOption,
  type ScoutOptions,
  type WorkloadGranularity,
} from '../services/scout.service';
import type { EmployeeStatus } from '../types/database';

type ScoutPageMode = 'personal-recruiting' | 'recruit-list' | 'onboarding' | 'personal-streamers' | 'management-recruiting' | 'management-streamers';

type ScoutPageProps = {
  mode: ScoutPageMode;
};

const currentMonth = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);
type CandidateFollowFilter = 'all' | 'today' | 'overdue';
type CandidateStatusFilter = Candidate['status'] | 'all';
const candidateStatusFilters: CandidateStatusFilter[] = ['pending', 'accepted', 'rejected', 'all'];
type TeamWorkloadView = WorkloadGranularity | 'last-week';
type WorkloadView = TeamWorkloadView | 'scout-records';
type ScoutRecordView = Extract<WorkloadGranularity, 'daily' | 'monthly'>;
type ManagementWorkloadDisplayStat = ManagementWorkloadStat & { onboarded_count: number; onboarded_creator_details: string[] };
const teamWorkloadViews: TeamWorkloadView[] = ['daily', 'weekly', 'last-week', 'monthly'];
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
const teamWorkloadDisplayLabels: Record<TeamWorkloadView, string> = {
  ...teamWorkloadViewLabels,
  'last-week': '上周',
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
  platform_public_id: '',
  region_id: '',
  creator_name: '',
  scout_employee_id: '',
  manager_employee_id: '',
  creator_type: '5+1',
  bank_account_name: '',
  bank_name: '',
  bank_account: '',
};

function emptyCreatorPlatformForm(enabled = false): CreatorPlatformFormValues {
  return {
    enabled,
    joined_date: today,
    platform_user_id: '',
    platform_account: '',
    platform_public_id: '',
    creator_type: '5+1',
    bank_account_name: '',
    bank_name: '',
    bank_account: '',
  };
}

const emptyCreatorEntityForm: CreatorEntityFormValues = {
  display_name: '',
  registration_type: 'new_onboarding',
  guild_joined_date: today,
  region_id: '',
  scout_employee_id: '',
  manager_employee_id: '',
  has_secondary_scout: false,
  secondary_scout_employee_id: '',
  has_secondary_manager: false,
  secondary_manager_employee_id: '',
  platforms: {
    tiktok: emptyCreatorPlatformForm(true),
    douyin: emptyCreatorPlatformForm(false),
  },
};

const creatorTypes: CreatorType[] = ['5+1', 'online', 'offline', 'company'];
const followStatuses: FollowStatus[] = ['pending', 'following', 'interview', 'ready_onboarding'];

type CreatorGroupStatus = CreatorStatus | 'mixed';

type CreatorProfileGroup = {
  id: string;
  displayName: string;
  profiles: CreatorProfile[];
  managerName: string;
  status: CreatorGroupStatus;
};

type CreatorGroupSummary = {
  total: number;
  tiktok: number;
  douyin: number;
  dualPlatform: number;
};

export function ScoutPage({ mode }: ScoutPageProps) {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const isManagementMode = mode.startsWith('management');
  const canManageCreators = permissions.canUse(isManagementMode ? 'management-streamer-stats' : 'scout-onboarding');
  const canManageCreatorStatus = mode === 'management-streamers' && permissions.isSuperAdmin;
  const [options, setOptions] = useState<ScoutOptions>({ regions: [], employees: [] });
  const [managerOptions, setManagerOptions] = useState<OnboardingManagerOption[]>([]);
  const [onboardingScoutOptions, setOnboardingScoutOptions] = useState<OnboardingScoutOption[]>([]);
  const [historicalOnboardingScoutOptions, setHistoricalOnboardingScoutOptions] = useState<OnboardingScoutOption[]>([]);
  const [secondaryManagerOptions, setSecondaryManagerOptions] = useState<OnboardingCollaboratorOption[]>([]);
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
  const [candidateStatusFilter, setCandidateStatusFilter] = useState<CandidateStatusFilter>('pending');
  const [candidateFollowFilter, setCandidateFollowFilter] = useState<CandidateFollowFilter>('all');
  const [candidateUidQuery, setCandidateUidQuery] = useState('');
  const [workloadGranularity, setWorkloadGranularity] = useState<WorkloadGranularity>('daily');
  const [workloadView, setWorkloadView] = useState<WorkloadView>('daily');
  const [candidateForm, setCandidateForm] = useState<CandidateFormValues>(emptyCandidateForm);
  const [editingCandidate, setEditingCandidate] = useState<Candidate | null>(null);
  const [followUpCandidate, setFollowUpCandidate] = useState<Candidate | null>(null);
  const [followUpForm, setFollowUpForm] = useState<CandidateFollowUpFormValues>(emptyFollowUpForm);
  const [followUpHistory, setFollowUpHistory] = useState<CandidateFollowUpHistory[]>([]);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [creatorForm, setCreatorForm] = useState<CreatorFormValues>(emptyCreatorForm);
  const [creatorEntityForm, setCreatorEntityForm] = useState<CreatorEntityFormValues>(emptyCreatorEntityForm);
  const [editingCreator, setEditingCreator] = useState<CreatorProfile | null>(null);
  const [statusCreator, setStatusCreator] = useState<CreatorProfile | null>(null);
  const [selectedCreatorGroup, setSelectedCreatorGroup] = useState<CreatorProfileGroup | null>(null);
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
        if (platformFilter && platformFilter !== 'dual_platform' && creator.platform !== platformFilter) return false;
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
    const normalizedUidQuery = candidateUidQuery.trim();
    const filteredCandidates = candidates.filter((candidate) => {
      if (candidateStatusFilter !== 'all' && candidate.status !== candidateStatusFilter) return false;

      if (normalizedUidQuery && !(candidate.platform_user_id ?? '').includes(normalizedUidQuery)) return false;

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
  }, [candidateFollowFilter, candidateStatusFilter, candidateUidQuery, candidates]);

  useEffect(() => {
    void loadData();
  }, [creatorStatusFilter, mode, month, profile?.id, regionFilter, workloadGranularity, workloadView]);

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
        mode === 'management-recruiting' ? listManagementWorkloadStatsForView({ month, regionId: regionFilter, granularity: workloadGranularity, view: workloadView }) : Promise.resolve([]),
      ]);

      const creatorsWithScoutDisplayNames = mode === 'management-recruiting'
        ? await attachScoutDisplayNames(nextCreators)
        : nextCreators;

      setOptions(nextOptions);
      setCreators(creatorsWithScoutDisplayNames);
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

      try {
        setOnboardingScoutOptions(await scoutService.listOnboardingScoutOptions('new_onboarding'));
      } catch (scoutOptionsError) {
        console.error('Failed to load onboarding scout options', scoutOptionsError);
        setOnboardingScoutOptions([]);
      }
      try {
        setHistoricalOnboardingScoutOptions(await scoutService.listOnboardingScoutOptions('existing_creator'));
      } catch (historicalScoutOptionsError) {
        console.error('Failed to load historical onboarding scout options', historicalScoutOptionsError);
        setHistoricalOnboardingScoutOptions([]);
      }
      try {
        setSecondaryManagerOptions(await scoutService.listOnboardingCollaboratorOptions('manager'));
      } catch (secondaryManagerOptionsError) {
        console.error('Failed to load onboarding secondary manager options', secondaryManagerOptionsError);
        setSecondaryManagerOptions([]);
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

  async function attachScoutDisplayNames(nextCreators: CreatorProfile[]) {
    try {
      const scoutDisplayNames = await scoutService.listCreatorScoutDisplayNames(nextCreators.map((creator) => creator.id));
      const displayNameByCreatorId = new Map(
        scoutDisplayNames.map((scout) => [scout.creator_profile_id, scout.display_name]),
      );

      return nextCreators.map((creator) => ({
        ...creator,
        scout_display_name: displayNameByCreatorId.get(creator.id) ?? creator.scout_display_name ?? null,
      }));
    } catch (displayNameError) {
      console.error('Failed to load scout display names', displayNameError);
      return nextCreators;
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
        await scoutService.createCreatorEntityWithPlatforms(creatorEntityForm);
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

  function openCreatorCreate(registrationType: CreatorRegistrationType = 'new_onboarding') {
    const currentEmployee = onboardingScoutOptions.find((employee) => employee.id === options.employees.find((option) => option.profile_id === profile?.id)?.id);
    setEditingCreator(null);
    setCreatorForm({
      ...emptyCreatorForm,
      scout_employee_id: currentEmployee?.id ?? '',
      region_id: currentEmployee?.region_id ?? '',
    });
    setCreatorEntityForm({
      ...emptyCreatorEntityForm,
      registration_type: registrationType,
      guild_joined_date: today,
      region_id: currentEmployee?.region_id ?? '',
      scout_employee_id: currentEmployee?.id ?? '',
      platforms: {
        tiktok: emptyCreatorPlatformForm(true),
        douyin: emptyCreatorPlatformForm(false),
      },
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
      platform_public_id: creator.platform_public_id ?? '',
      region_id: creator.region_id ?? '',
      creator_name: creator.creator_name,
      scout_employee_id: creator.scout_employee_id ?? '',
      manager_employee_id: creator.manager_employee_id ?? '',
      creator_type: creator.creator_type,
      bank_name: creator.bank_name ?? '',
      bank_account_name: creator.bank_account_name ?? '',
      bank_account: creator.bank_account ?? '',
    });
    setCreatorModalOpen(true);
  }

  function closeCreatorModal() {
    setCreatorModalOpen(false);
    setEditingCreator(null);
    setCreatorForm(emptyCreatorForm);
    setCreatorEntityForm(emptyCreatorEntityForm);
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
    <section className={`scout-page${mode === 'recruit-list' ? ' scout-candidate-page' : ''}`}>
      {mode !== 'recruit-list' ? (
        <div className="toolbar-actions staff-actions-row">
          {mode === 'management-streamers' && canManageCreators ? (
            <button className="secondary-action creator-create-action" type="button" onClick={() => openCreatorCreate()}>
              <Plus size={17} />
              <span>新增主播</span>
            </button>
          ) : null}
          <button className="secondary-action" type="button" onClick={loadData} disabled={loading}>
            <RefreshCw size={17} />
            <span>刷新</span>
          </button>
        </div>
      ) : null}

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
        <CandidateEntryPanel loading={loading} onCreate={openCandidateCreate} onRefresh={loadData} />
      ) : null}

      {mode === 'recruit-list' ? (
        <CandidatePanel
          loading={loading}
          candidates={sortedCandidates}
          hasAnyCandidates={candidates.length > 0}
          statusFilter={candidateStatusFilter}
          onStatusFilter={setCandidateStatusFilter}
          followFilter={candidateFollowFilter}
          onFollowFilter={setCandidateFollowFilter}
          uidQuery={candidateUidQuery}
          onUidQuery={setCandidateUidQuery}
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
          onView={setSelectedCreatorGroup}
        />
      ) : null}

      {selectedCreatorGroup ? (
        <CreatorDetailDrawer
          group={selectedCreatorGroup}
          managerDisplayNameByCreatorId={managerDisplayNameByCreatorId}
          canEdit={canManageCreators}
          canManageStatus={canManageCreatorStatus}
          onClose={() => setSelectedCreatorGroup(null)}
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
          creators={filteredCreators}
          workloadStats={managementWorkloadStats}
          workloadView={workloadView}
          onWorkloadView={setWorkloadView}
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
          entityValues={creatorEntityForm}
          options={options}
          scoutOptions={creatorEntityForm.registration_type === 'existing_creator' ? historicalOnboardingScoutOptions : onboardingScoutOptions}
          secondaryManagerOptions={secondaryManagerOptions}
          managerOptions={managerOptions}
          editingCreator={editingCreator}
          saving={saving}
          onChange={setCreatorForm}
          onEntityChange={setCreatorEntityForm}
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
    <div className="staff-list-panel personal-recruiting-panel">
      <div className="list-header">
        <div className="personal-recruiting-title">
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
        <>
          <div className="staff-table-wrap personal-daily-work-desktop">
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
          <div className="personal-daily-work-mobile" hidden>
            {rows.map((row) => (
              <DailyWorkLogCard
                key={row.workDate}
                workDate={row.workDate}
                log={row.log}
                editable={canEdit && isRecentDailyWorkDate(row.workDate)}
                saving={savingDate === row.workDate}
                onSave={onSave}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function useDailyWorkLogForm({
  workDate,
  log,
  editable,
  onSave,
}: {
  workDate: string;
  log: DailyWorkLog | null;
  editable: boolean;
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

  return { values, setValues, rowError, contactedCount, repliedCount, submit };
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
  const { values, setValues, rowError, contactedCount, repliedCount, submit } = useDailyWorkLogForm({ workDate, log, editable, onSave });

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
      <td>{formatDailyWorkReplyRate(contactedCount, repliedCount)}</td>
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

function DailyWorkLogCard({
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
  const { values, setValues, rowError, contactedCount, repliedCount, submit } = useDailyWorkLogForm({ workDate, log, editable, onSave });
  const formId = `daily-work-mobile-${workDate}`;

  return (
    <article className="personal-daily-work-card">
      <div className="personal-daily-work-card-head">
        <h5>{workDate}</h5>
        <span>{formatDailyWorkReplyRate(contactedCount, repliedCount)}</span>
      </div>
      <div className="personal-daily-work-card-metrics">
        <label>
          <span>联系人数</span>
          {editable ? (
            <input className="daily-work-input" type="number" min="0" step="1" value={values.contacted_count} onChange={(event) => setValues({ ...values, contacted_count: event.target.value })} form={formId} />
          ) : (
            <b>{log?.contacted_count ?? 0}</b>
          )}
        </label>
        <label>
          <span>回复人数</span>
          {editable ? (
            <input className="daily-work-input" type="number" min="0" step="1" value={values.replied_count} onChange={(event) => setValues({ ...values, replied_count: event.target.value })} form={formId} />
          ) : (
            <b>{log?.replied_count ?? 0}</b>
          )}
        </label>
      </div>
      <label className="personal-daily-work-note">
        <span>备注 / 今日进度</span>
        {editable ? (
          <textarea
            className="daily-work-input"
            rows={3}
            value={values.note}
            onChange={(event) => setValues({ ...values, note: event.target.value })}
            placeholder="例如：今天主要联系 TikTok，有 3 位主播有兴趣，明天继续跟进"
            form={formId}
          />
        ) : (
          <b title={log?.note ?? undefined}>{log?.note || '-'}</b>
        )}
      </label>
      <div className="personal-daily-work-card-action">
        {editable ? (
          <form id={formId} onSubmit={submit}>
            <button className="primary-button compact-button" type="submit" disabled={saving}>
              {saving ? '保存中...' : log ? '修改' : '填写'}
            </button>
            {rowError ? <small className="form-error">{rowError}</small> : null}
          </form>
        ) : (
          <span>只读</span>
        )}
      </div>
    </article>
  );
}

function RecruitBreakdownCards({ breakdown }: { breakdown: ReturnType<typeof createRecruitBreakdown> }) {
  return (
    <div className="personal-platform-grid">
      <RecruitCard title="TikTok" summary={breakdown.tiktok} logoUrl={tiktokLogoUrl} variant="tiktok" />
      <RecruitCard title="抖音" summary={breakdown.douyin} logoUrl={douyinLogoUrl} variant="douyin" />
    </div>
  );
}

function RecruitCard({ title, summary, logoUrl, variant }: { title: string; summary: { total: number; plusFiveOne: number; nonFiveOne: number }; logoUrl: string; variant: 'tiktok' | 'douyin' }) {
  return (
    <section className={`personal-platform-card personal-platform-card--${variant}`}>
      <PlatformLogoTitle logoUrl={logoUrl} title={title} logoSize={32} fontSize={21} />
      <div className="personal-platform-total">
        <span>招募总数</span>
        <strong>{summary.total}</strong>
      </div>
      <div className="personal-platform-breakdown">
        <span>
          <small>5+1</small>
          <b>{summary.plusFiveOne}</b>
        </span>
        <span>
          <small>非5+1</small>
          <b>{summary.nonFiveOne}</b>
        </span>
      </div>
    </section>
  );
}

function CandidateEntryPanel({ loading, onCreate, onRefresh }: { loading: boolean; onCreate: () => void; onRefresh: () => void }) {
  return (
    <section className="candidate-entry-panel">
      <div className="candidate-entry-topline">
        <div className="candidate-entry-intro">
          <h3>新增人员名单</h3>
          <p>记录需要持续跟进的主播名单，方便后续持续跟进与管理。</p>
          <p className="candidate-entry-muted">可填写主播资料、平台身份、跟进日期与备注。</p>
          <button className="primary-action candidate-create-button" type="button" onClick={onCreate}>
            <Plus size={17} />
            <span>新增名单</span>
          </button>
        </div>
        <button className="secondary-action candidate-refresh-button" type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={17} />
          <span>刷新</span>
        </button>
      </div>
    </section>
  );
}

function CandidatePanel({
  loading,
  candidates,
  hasAnyCandidates,
  statusFilter,
  onStatusFilter,
  followFilter,
  onFollowFilter,
  uidQuery,
  onUidQuery,
  onEdit,
  onFollowUp,
  onStatus,
}: {
  loading: boolean;
  candidates: Candidate[];
  hasAnyCandidates: boolean;
  statusFilter: CandidateStatusFilter;
  onStatusFilter: (filter: CandidateStatusFilter) => void;
  followFilter: CandidateFollowFilter;
  onFollowFilter: (filter: CandidateFollowFilter) => void;
  uidQuery: string;
  onUidQuery: (value: string) => void;
  onEdit: (candidate: Candidate) => void;
  onFollowUp: (candidate: Candidate) => void;
  onStatus: (candidate: Candidate, status: 'accepted' | 'rejected') => void;
}) {
  return (
    <div className="staff-list-panel candidate-list-panel">
      <div className="candidate-reminder-header">
        <h3>跟进提醒</h3>
        <div className="candidate-filter-toolbar">
          <div className="candidate-filter-row">
            <div className="candidate-filter-group">
              <span>状态</span>
              <div className="segmented-control candidate-filter-control candidate-status-control" role="group" aria-label="名单状态筛选">
                {candidateStatusFilters.map((filter) => (
                  <button key={filter} className={statusFilter === filter ? 'active' : ''} type="button" onClick={() => onStatusFilter(filter)}>
                    {getCandidateStatusFilterLabel(filter)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="candidate-filter-row candidate-filter-row-search">
            <div className="candidate-filter-group">
              <span>跟进</span>
              <div className="segmented-control candidate-filter-control candidate-follow-control" role="group" aria-label="名单跟进筛选">
                {(['all', 'today', 'overdue'] as CandidateFollowFilter[]).map((filter) => (
                  <button key={filter} className={followFilter === filter ? 'active' : ''} type="button" onClick={() => onFollowFilter(filter)}>
                    {getCandidateFollowFilterLabel(filter)}
                  </button>
                ))}
              </div>
            </div>
            <label className="candidate-search">
              <span className="visually-hidden">搜索 TikTok / 抖音 UID</span>
              <input value={uidQuery} onChange={(event) => onUidQuery(event.target.value)} placeholder="搜索 TikTok / 抖音 UID" />
              {uidQuery.trim() ? (
                <button type="button" onClick={() => onUidQuery('')} aria-label="清空 UID 搜索">
                  <X size={15} />
                </button>
              ) : null}
            </label>
          </div>
        </div>
      </div>
      {loading ? (
        <div className="table-state">正在读取名单...</div>
      ) : candidates.length === 0 ? (
        <div className="table-state">{hasAnyCandidates ? '暂无符合条件的名单' : '暂无名单。'}</div>
      ) : (
        <>
          <div className="staff-table-wrap candidate-desktop-table">
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
                    <td><span className={`candidate-status-badge candidate-status-badge--${candidate.status}`}>{getCandidateStatusLabel(candidate.status)}</span></td>
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
          <div className="candidate-mobile-card-list" hidden>
            {candidates.map((candidate) => (
              <CandidateMobileCard key={candidate.id} candidate={candidate} onEdit={onEdit} onFollowUp={onFollowUp} onStatus={onStatus} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CandidateMobileCard({
  candidate,
  onEdit,
  onFollowUp,
  onStatus,
}: {
  candidate: Candidate;
  onEdit: (candidate: Candidate) => void;
  onFollowUp: (candidate: Candidate) => void;
  onStatus: (candidate: Candidate, status: 'accepted' | 'rejected') => void;
}) {
  const profileLine = [candidate.gender, candidate.age ? `${candidate.age}岁` : ''].filter(Boolean).join(' · ') || '-';

  return (
    <article className={`candidate-mobile-card candidate-mobile-card--${candidate.status}`}>
      <div className="candidate-mobile-head">
        <div>
          <h4>{candidate.name}</h4>
          <span>{profileLine}</span>
        </div>
        <span className={`candidate-status-badge candidate-status-badge--${candidate.status}`}>{getCandidateStatusLabel(candidate.status)}</span>
      </div>

      <section className="candidate-mobile-section">
        <strong>{candidate.platform ? platformLabels[candidate.platform] : '-'}</strong>
        <span>UID：{candidate.platform_user_id || '-'}</span>
        <span>账号：{candidate.platform_account || '-'}</span>
      </section>

      <section className="candidate-mobile-section candidate-mobile-follow">
        <strong>{getFollowStatusLabel(candidate.follow_status)} · {candidate.next_follow_up_date || '-'}</strong>
        <span>来源：{candidate.source || '-'}</span>
        <span>联系：{candidate.contact || '-'}</span>
      </section>

      <section className="candidate-mobile-section">
        <span>才艺：{candidate.talent || '-'}</span>
        <span>目前就职：{candidate.current_job || '-'}</span>
        <p>备注：{candidate.remark || '-'}</p>
      </section>

      <div className="candidate-mobile-actions">
        <button className="icon-button" type="button" onClick={() => onFollowUp(candidate)} aria-label="跟进">
          <MessageSquarePlus size={17} />
        </button>
        <button className="icon-button" type="button" onClick={() => onEdit(candidate)} aria-label="编辑">
          <Edit3 size={17} />
        </button>
        <button className="icon-button accept-button" type="button" onClick={() => onStatus(candidate, 'accepted')} aria-label="接受">
          <Check size={17} />
        </button>
        <button className="icon-button reject-button" type="button" onClick={() => onStatus(candidate, 'rejected')} aria-label="拒绝">
          <X size={17} />
        </button>
      </div>
    </article>
  );
}

function OnboardingPanel({ canCreate, onCreate }: { canCreate: boolean; onCreate: (registrationType: CreatorRegistrationType) => void }) {
  return (
    <div className="onboarding-entry-panel">
      <section className="onboarding-entry-intro">
        <h3>入公会登记管理</h3>
        <p>统一管理新入公会主播登记与现有主播资料补录，主播共同资料填写一次，TikTok 与抖音平台资料分别记录。</p>
        <div className="onboarding-platform-note">TikTok + 抖音 · 支持单平台/双平台</div>
        <button className="primary-action onboarding-create-button" type="button" onClick={() => onCreate('new_onboarding')} disabled={!canCreate}>
          <Plus size={17} />
          <span>新入公会主播登记</span>
        </button>
        <button className="secondary-action onboarding-create-button" type="button" onClick={() => onCreate('existing_creator')} disabled={!canCreate}>
          <Plus size={17} />
          <span>现有主播资料补录</span>
        </button>
      </section>
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
  onView,
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
  onView: (group: CreatorProfileGroup) => void;
}) {
  const [creatorSearchQuery, setCreatorSearchQuery] = useState('');
  const visibleCreators = useMemo(() => filterCreatorsBySearch(creators, creatorSearchQuery), [creators, creatorSearchQuery]);
  const creatorGroups = useMemo(() => filterCreatorGroupsByPlatform(groupCreatorProfiles(visibleCreators, managerDisplayNameByCreatorId), platformFilter), [visibleCreators, managerDisplayNameByCreatorId, platformFilter]);
  const summary = useMemo(() => summarizeCreatorGroups(creatorGroups), [creatorGroups]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => getDefaultCreatorPageSize());
  const totalItems = creatorGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = (safeCurrentPage - 1) * pageSize;
  const paginatedCreatorGroups = useMemo(() => creatorGroups.slice(pageStartIndex, pageStartIndex + pageSize), [creatorGroups, pageSize, pageStartIndex]);
  const pageNumbers = useMemo(() => createPaginationItems(safeCurrentPage, totalPages), [safeCurrentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [creatorSearchQuery, platformFilter, regionFilter, scoutFilter, managerFilter, creatorTypeFilter, creatorStatusFilter, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  return (
    <div className="staff-list-panel creator-stats-panel">
      <CreatorSummaryCards summary={summary} isManagement={isManagement} />
      <CreatorFilters
        options={options}
        isManagement={isManagement}
        searchQuery={creatorSearchQuery}
        platformFilter={platformFilter}
        regionFilter={regionFilter}
        scoutFilter={scoutFilter}
        managerFilter={managerFilter}
        creatorTypeFilter={creatorTypeFilter}
        creatorStatusFilter={creatorStatusFilter}
        onPlatformFilter={onPlatformFilter}
        onSearchQuery={setCreatorSearchQuery}
        onRegionFilter={onRegionFilter}
        onScoutFilter={onScoutFilter}
        onManagerFilter={onManagerFilter}
        onCreatorTypeFilter={onCreatorTypeFilter}
        onCreatorStatusFilter={onCreatorStatusFilter}
      />
      {loading ? (
        <div className="table-state">正在读取主播统计...</div>
      ) : creatorGroups.length === 0 ? (
        <div className="table-state">暂无主播资料。</div>
      ) : (
        <>
          <CreatorTable creatorGroups={paginatedCreatorGroups} onView={onView} />
          <CreatorPagination
            currentPage={safeCurrentPage}
            pageSize={pageSize}
            pageNumbers={pageNumbers}
            totalItems={totalItems}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}
    </div>
  );
}

function CreatorSummaryCards({ summary, isManagement }: { summary: CreatorGroupSummary; isManagement: boolean }) {
  return (
    <div className="creator-summary-grid">
      <CreatorSummaryCard title={isManagement ? '总主播统计' : '我的主播'} value={summary.total} icon={<UsersRound size={20} />} />
      <CreatorSummaryCard title="TikTok 主播" value={summary.tiktok} logoUrl={tiktokLogoUrl} />
      <CreatorSummaryCard title="抖音主播" value={summary.douyin} logoUrl={douyinLogoUrl} />
      <CreatorSummaryCard title="双平台主播" value={summary.dualPlatform} icon={<Layers size={20} />} />
    </div>
  );
}

function CreatorSummaryCard({ title, value, icon, logoUrl }: { title: string; value: number; icon?: ReactNode; logoUrl?: string }) {
  return (
    <article className="creator-summary-card">
      <div className="creator-summary-card-header">
        <div className="creator-summary-icon">{logoUrl ? <img src={logoUrl} alt="" /> : icon}</div>
        <div className="creator-summary-card-title">{title}</div>
      </div>
      <div className="creator-summary-card-value">
        <span className="creator-summary-number">{value}</span>
        <span className="creator-summary-unit">位</span>
      </div>
    </article>
  );
}

function CreatorFilters(props: {
  options: ScoutOptions;
  isManagement: boolean;
  searchQuery: string;
  platformFilter: string;
  regionFilter: string;
  scoutFilter: string;
  managerFilter: string;
  creatorTypeFilter: string;
  creatorStatusFilter: CreatorStatusFilter;
  onPlatformFilter: (value: string) => void;
  onSearchQuery: (value: string) => void;
  onRegionFilter: (value: string) => void;
  onScoutFilter: (value: string) => void;
  onManagerFilter: (value: string) => void;
  onCreatorTypeFilter: (value: string) => void;
  onCreatorStatusFilter: (value: CreatorStatusFilter) => void;
}) {
  return (
    <div className="scout-filters">
      <label className="form-field creator-search-field">
        <span>搜索</span>
        <div className="creator-search-input">
          <Search size={16} />
          <input value={props.searchQuery} onChange={(event) => props.onSearchQuery(event.target.value)} placeholder="搜索主播名字 / 主播号 / UID" />
        </div>
      </label>
      <SelectField label="平台" value={props.platformFilter} onChange={props.onPlatformFilter}>
        <option value="">全部</option>
        <option value="tiktok">TikTok</option>
        <option value="douyin">抖音</option>
        <option value="dual_platform">双平台</option>
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

function CreatorTable({ creatorGroups, onView }: { creatorGroups: CreatorProfileGroup[]; onView: (group: CreatorProfileGroup) => void }) {
  return (
    <div className="creator-list-wrap">
      <table className="staff-table scout-table creator-profile-table">
        <thead>
          <tr>
            <th>主播名字</th>
            <th>平台账号（UID / 类型）</th>
            <th>经纪人</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {creatorGroups.map((group) => (
            <tr key={group.id} className="creator-profile-row">
              <td>
                <strong className="creator-row-name">{group.displayName}</strong>
              </td>
              <td>
                <div className="creator-platform-lines">
                  {group.profiles.map((creator) => (
                    <div key={creator.id} className="creator-platform-line">
                      <span className="creator-platform-name">
                        <PlatformLogo platform={creator.platform} />
                        <span>{platformLabels[creator.platform]}</span>
                      </span>
                      <span className="creator-platform-uid"><span>UID</span> {creator.platform_user_id}</span>
                      <CreatorTypeBadge type={creator.creator_type} />
                    </div>
                  ))}
                </div>
              </td>
              <td>{group.managerName}</td>
              <td>
                <CreatorStatusBadge status={group.status} />
              </td>
              <td>
                <button className="creator-view-button" type="button" onClick={() => onView(group)}>
                  <span>查看资料</span>
                  <ChevronRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreatorPagination({
  currentPage,
  pageSize,
  pageNumbers,
  totalItems,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  currentPage: number;
  pageSize: number;
  pageNumbers: Array<number | 'ellipsis'>;
  totalItems: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  return (
    <div className="creator-pagination">
      <div className="creator-pagination-total">共 {totalItems} 位主播</div>
      <div className="creator-pagination-controls" aria-label="主播分页">
        <button className="creator-page-button" type="button" disabled={!canGoPrevious} onClick={() => onPageChange(currentPage - 1)} aria-label="上一页">
          ‹
        </button>
        <div className="creator-page-numbers">
          {pageNumbers.map((item, index) =>
            item === 'ellipsis' ? (
              <span key={`ellipsis-${index}`} className="creator-page-ellipsis">…</span>
            ) : (
              <button key={item} className={`creator-page-button${item === currentPage ? ' active' : ''}`} type="button" onClick={() => onPageChange(item)} aria-current={item === currentPage ? 'page' : undefined}>
                {item}
              </button>
            ),
          )}
        </div>
        <span className="creator-page-compact">{currentPage} / {totalPages}</span>
        <button className="creator-page-button" type="button" disabled={!canGoNext} onClick={() => onPageChange(currentPage + 1)} aria-label="下一页">
          ›
        </button>
      </div>
      <label className="creator-page-size">
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          <option value={10}>10 条/页</option>
          <option value={20}>20 条/页</option>
          <option value={50}>50 条/页</option>
        </select>
      </label>
    </div>
  );
}

function CreatorTypeBadge({ type }: { type: CreatorType }) {
  return <span className={`creator-type-badge creator-type-badge--${type === '5+1' ? 'plus' : 'standard'}`}>{type === '5+1' ? '5+1' : '非5+1'}</span>;
}

function CreatorStatusBadge({ status }: { status: CreatorGroupStatus }) {
  return <span className={`creator-status-badge creator-status-badge--${status}`}>{getCreatorStatusLabel(status)}</span>;
}

function PlatformLogo({ platform }: { platform: CreatorPlatform }) {
  return <img className="creator-platform-logo" src={platform === 'tiktok' ? tiktokLogoUrl : douyinLogoUrl} alt="" />;
}

function CreatorDetailDrawer({
  group,
  managerDisplayNameByCreatorId,
  canEdit,
  canManageStatus,
  onClose,
  onEdit,
  onStatus,
}: {
  group: CreatorProfileGroup;
  managerDisplayNameByCreatorId: Record<string, string>;
  canEdit: boolean;
  canManageStatus: boolean;
  onClose: () => void;
  onEdit: (creator: CreatorProfile) => void;
  onStatus: (creator: CreatorProfile) => void;
}) {
  const primaryCreator = group.profiles[0];

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="creator-detail-drawer" role="dialog" aria-modal="true" aria-label="主播资料" onMouseDown={(event) => event.stopPropagation()}>
        <div className="creator-drawer-header">
          <div>
            <span>主播资料</span>
            <h3>{group.displayName}</h3>
          </div>
          <div className="creator-drawer-header-actions">
            <CreatorStatusBadge status={group.status} />
            <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="creator-drawer-body">
          <DrawerSection title="平台账号">
            {sortCreatorProfiles(group.profiles).map((creator) => (
              <article key={creator.id} className="creator-platform-detail-card">
                <div className="creator-platform-detail-head">
                  <strong className="creator-platform-detail-title">
                    <PlatformLogo platform={creator.platform} />
                    <span>{platformLabels[creator.platform]}</span>
                  </strong>
                  <CreatorTypeBadge type={creator.creator_type} />
                </div>
                <DrawerField label="主播号" value={creator.platform_account} />
                <DrawerField label="UID" value={creator.platform_user_id} />
                <DrawerField label="加入日期" value={creator.joined_date} />
                <DrawerField label="主播形式" value={creatorTypeLabels[creator.creator_type]} />
                <DrawerField label="状态" value={<CreatorStatusBadge status={(creator.status ?? 'active') as CreatorStatus} />} />
                {canEdit || canManageStatus ? (
                  <div className="creator-platform-actions">
                    {canEdit ? (
                      <button className="secondary-button compact-button" type="button" onClick={() => { onClose(); onEdit(creator); }}>
                        <Edit3 size={15} />
                        <span>编辑</span>
                      </button>
                    ) : null}
                    {canManageStatus ? (
                      <button className="secondary-button compact-button" type="button" onClick={() => { onClose(); onStatus(creator); }}>
                        状态
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </DrawerSection>

          <DrawerSection title="所属资料">
            <div className="creator-drawer-field-grid">
              <DrawerField label="区域" value={getConsistentValue(group.profiles, (creator) => creator.region?.code ?? creator.region?.name ?? '')} />
              <DrawerField label="星探" value={getConsistentValue(group.profiles, (creator) => getEmployeeName(creator.scout))} />
              <DrawerField label="经纪人" value={getConsistentValue(group.profiles, (creator) => getCreatorManagerName(creator, managerDisplayNameByCreatorId))} />
            </div>
          </DrawerSection>

          <DrawerSection title="主播资料">
            <div className="creator-drawer-field-grid">
              <DrawerField label="主播形式" value={getCreatorTypeDetail(group.profiles)} />
              <DrawerField label="状态" value={<CreatorStatusBadge status={group.status} />} />
            </div>
          </DrawerSection>

          <DrawerSection title="银行资料">
            <div className="creator-drawer-field-grid">
              <DrawerField label="银行" value={getConsistentValue(group.profiles, (creator) => creator.bank_name ?? '') || primaryCreator.bank_name || '-'} />
              <DrawerField label="银行户口" value={getConsistentValue(group.profiles, (creator) => creator.bank_account ?? '') || primaryCreator.bank_account || '-'} />
            </div>
          </DrawerSection>
        </div>
      </aside>
    </div>
  );
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="creator-drawer-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function DrawerField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="creator-drawer-field">
      <span>{label}</span>
      <strong>{value || '-'}</strong>
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
  creators,
  workloadStats,
  workloadView,
  onWorkloadView,
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
  creators: CreatorProfile[];
  workloadStats: ManagementWorkloadStat[];
  workloadView: WorkloadView;
  onWorkloadView: (value: WorkloadView) => void;
  workloadGranularity: WorkloadGranularity;
  onWorkloadGranularity: (value: WorkloadGranularity) => void;
}) {
  const [selectedWorkloadScout, setSelectedWorkloadScout] = useState<ManagementWorkloadStat | null>(null);
  const [recordGranularity, setRecordGranularity] = useState<ScoutRecordView>('daily');

  return (
    <div className="staff-list-panel management-recruiting-panel">
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
          <ScoutRecruitSummaryTable rows={scoutRecruitRows} />
          <ManagementWorkloadPanel
            stats={workloadStats}
            creators={creators}
            granularity={workloadGranularity}
            onGranularity={onWorkloadGranularity}
            view={workloadView}
            onView={onWorkloadView}
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
  creators,
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
  creators: CreatorProfile[];
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
  const activeTeamView = view === 'scout-records' ? granularity : view;
  const activeTeamGranularity: WorkloadGranularity = activeTeamView === 'last-week' ? 'weekly' : activeTeamView;
  const teamRows = getTeamWorkloadRows(stats, activeTeamView, malaysiaToday);
  const showOnboarded = activeTeamView === 'last-week';
  const teamDisplayRows = showOnboarded ? addOnboardedCountsToWorkloadRows(teamRows, creators, malaysiaToday) : teamRows;
  const teamTotal = summarizeWorkloadStats(teamDisplayRows);
  const scoutRows = getUniqueWorkloadScouts(stats);
  const selectedScoutRows = selectedScout
    ? stats
        .filter((row) => isSameWorkloadScout(row, selectedScout))
        .sort((first, second) => second.period_start.localeCompare(first.period_start))
    : [];
  const selectedScoutTotal = summarizeWorkloadStats(selectedScoutRows);
  const isScoutRecords = view === 'scout-records';
  const activeLabel = isScoutRecords ? '星探记录' : teamWorkloadDisplayLabels[activeTeamView];

  function openTeamView(nextGranularity: WorkloadGranularity) {
    onView(nextGranularity);
    onSelectedScout(null);
    onGranularity(nextGranularity);
  }

  function openLastWeekView() {
    onView('last-week');
    onSelectedScout(null);
    onGranularity('weekly');
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
          {teamWorkloadViews.map((item) => (
            <button
              key={item}
              className={!isScoutRecords && activeTeamView === item ? 'active' : ''}
              type="button"
              onClick={item === 'last-week' ? openLastWeekView : () => openTeamView(item)}
            >
              {teamWorkloadDisplayLabels[item]}
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
          <WorkloadTotalCards view={activeTeamView} total={teamTotal} showOnboarded={showOnboarded} />
          <WorkloadStatsTable rows={teamDisplayRows} granularity={activeTeamGranularity} showOnboarded={showOnboarded} />
        </>
      )}
    </section>
  );
}

function WorkloadTotalCards({
  view,
  total,
  showOnboarded = false,
}: {
  view: TeamWorkloadView;
  total: { contacted_count: number; replied_count: number; onboarded_count?: number };
  showOnboarded?: boolean;
}) {
  const prefix = teamWorkloadDisplayLabels[view];

  return (
    <div className="scout-total-panel">
      <h4>{prefix}团队总计</h4>
      <div className="workload-total-card-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${showOnboarded ? 4 : 3}, minmax(140px, 1fr))`, gap: 10 }}>
        <WorkloadTotalCard title={`${prefix}联系人数`} value={total.contacted_count} />
        <WorkloadTotalCard title={`${prefix}回复人数`} value={total.replied_count} />
        <WorkloadTotalCard title={`${prefix}回复率`} value={formatReplyRate(total.contacted_count, total.replied_count)} />
        {showOnboarded ? <WorkloadTotalCard title={`${prefix}新增入公会主播人数`} value={total.onboarded_count ?? 0} /> : null}
      </div>
    </div>
  );
}

function WorkloadTotalCard({ title, value }: { title: string; value: number | string }) {
  return (
    <section className="scout-stat-card workload-total-card" style={{ gap: 8, minHeight: 0, padding: '12px 14px' }}>
      <h4 style={{ fontSize: 14 }}>{title}</h4>
      <strong style={{ fontSize: 24 }}>{value}</strong>
    </section>
  );
}

function ScoutMonthlySummary({ total }: { total: { contacted_count: number; replied_count: number } }) {
  return (
    <div className="scout-total-panel">
      <div className="workload-total-card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(140px, 1fr))', gap: 10 }}>
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
    <>
    <div className="staff-table-wrap scout-record-desktop-table">
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
    <div className="scout-record-mobile-card-list" hidden>
      {rows.map((row) => (
        <article className="scout-record-mobile-card" key={`${row.scout_employee_id ?? row.scout_profile_id ?? row.scout_name}-${row.region_id ?? 'none'}`}>
          <h5>{row.scout_name}</h5>
          <span>{row.region_code ?? '-'}</span>
          <button className="secondary-button compact-button" type="button" onClick={() => onOpen(row)}>
            查看记录
          </button>
        </article>
      ))}
    </div>
    </>
  );
}

function WorkloadStatsTable({
  rows,
  granularity,
  personal = false,
  showOnboarded = false,
}: {
  rows: ManagementWorkloadStat[];
  granularity: WorkloadGranularity;
  personal?: boolean;
  showOnboarded?: boolean;
}) {
  if (rows.length === 0) {
    return <div className="table-state">暂无星探工作量记录。</div>;
  }

  const teamTableClassName = [
    'staff-table',
    'scout-summary-table',
    !personal ? 'workload-team-table' : '',
    !personal && granularity === 'daily' ? 'workload-team-table--daily' : '',
    !personal && showOnboarded ? 'workload-team-table--onboarded' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
    <div className={!personal ? 'staff-table-wrap workload-detail-desktop-table' : granularity === 'daily' ? 'staff-table-wrap workload-daily-desktop-table' : 'staff-table-wrap'}>
      <table className={teamTableClassName}>
        {!personal ? <WorkloadTeamTableColumns granularity={granularity} showOnboarded={showOnboarded} /> : null}
        <thead>
          <tr>
            {showOnboarded && !personal ? <th>星探</th> : null}
            <th>{granularity === 'daily' && personal ? '日期' : granularity === 'monthly' && personal ? '月份' : '周期'}</th>
            {!personal && !showOnboarded ? <th>星探</th> : null}
            {!personal ? <th>区域</th> : null}
            <th>联系人数</th>
            <th>回复人数</th>
            <th>回复率</th>
            {showOnboarded ? <th>新增入公会</th> : null}
            {showOnboarded ? <th className="workload-new-creators-head">新增主播</th> : null}
            {granularity === 'daily' ? <th>备注 / 今日进度</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.period_start}-${row.period_end}-${row.scout_employee_id ?? row.scout_profile_id ?? row.scout_name}-${row.region_id ?? 'none'}`}>
              {showOnboarded && !personal ? <td>{row.scout_name}</td> : null}
              <td>{row.period_label}</td>
              {!personal && !showOnboarded ? <td>{row.scout_name}</td> : null}
              {!personal ? <td>{row.region_code ?? '-'}</td> : null}
              <td>{row.contacted_count}</td>
              <td>{row.replied_count}</td>
              <td>{formatReplyRate(row.contacted_count, row.replied_count)}</td>
              {showOnboarded ? <td>{getWorkloadOnboardedCount(row)}</td> : null}
              {showOnboarded ? (
                <td className="workload-new-creators-cell">
                  <span className="workload-new-creators-list" title={formatWorkloadOnboardedCreatorDetails(row).join('\n')}>
                    {formatWorkloadOnboardedCreatorDetails(row).map((detail, index) => (
                      <span className="workload-new-creators-line" key={`${detail}-${index}`}>
                        {detail}
                      </span>
                    ))}
                  </span>
                </td>
              ) : null}
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
    {!personal ? <MobileWorkloadDetailCards rows={rows} granularity={granularity} showOnboarded={showOnboarded} /> : null}
    {granularity === 'daily' && personal ? <MobileDailyWorkloadCards rows={rows} /> : null}
    </>
  );
}

function WorkloadTeamTableColumns({ granularity, showOnboarded }: { granularity: WorkloadGranularity; showOnboarded: boolean }) {
  if (showOnboarded) {
    return (
      <colgroup>
        <col className="workload-col-scout" />
        <col className="workload-col-period" />
        <col className="workload-col-region" />
        <col className="workload-col-metric" />
        <col className="workload-col-metric" />
        <col className="workload-col-metric" />
        <col className="workload-col-metric" />
        <col className="workload-col-creators" />
      </colgroup>
    );
  }

  return (
    <colgroup>
      <col className="workload-col-period" />
      <col className="workload-col-scout" />
      <col className="workload-col-region" />
      <col className="workload-col-metric" />
      <col className="workload-col-metric" />
      <col className="workload-col-metric" />
      {granularity === 'daily' ? <col className="workload-col-note" /> : null}
    </colgroup>
  );
}

function MobileDailyWorkloadCards({ rows }: { rows: ManagementWorkloadStat[] }) {
  return (
    <div className="workload-daily-mobile-card-list" hidden>
      {rows.map((row) => (
        <article className="workload-mobile-detail-card workload-daily-mobile-card" key={`${row.period_start}-${row.period_end}-${row.scout_employee_id ?? row.scout_profile_id ?? row.scout_name}-${row.region_id ?? 'none'}`}>
          <h5>{row.period_label}</h5>
          <div className="workload-mobile-metrics">
            <span>
              <small>联系人数</small>
              <b>{row.contacted_count}</b>
            </span>
            <span>
              <small>回复人数</small>
              <b>{row.replied_count}</b>
            </span>
            <span>
              <small>回复率</small>
              <b>{formatReplyRate(row.contacted_count, row.replied_count)}</b>
            </span>
          </div>
          <div className="workload-daily-note">
            <span>备注 / 今日进度</span>
            <p>{row.note || '-'}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function MobileWorkloadDetailCards({ rows, granularity, showOnboarded = false }: { rows: ManagementWorkloadStat[]; granularity: WorkloadGranularity; showOnboarded?: boolean }) {
  return (
    <div className="workload-mobile-card-list" hidden>
      {rows.map((row) => (
        <article className="workload-mobile-detail-card" key={`${row.period_start}-${row.period_end}-${row.scout_employee_id ?? row.scout_profile_id ?? row.scout_name}-${row.region_id ?? 'none'}`}>
          <div className="workload-mobile-detail-head">
            <h5>{row.scout_name}</h5>
            <span>{row.region_code ?? '-'}</span>
          </div>
          <p>
            <span>{granularity === 'daily' ? '日期' : '周期'}</span>
            <b>{row.period_label}</b>
          </p>
          <div className="workload-mobile-metrics">
            <span>
              <small>联系人数</small>
              <b>{row.contacted_count}</b>
            </span>
            <span>
              <small>回复人数</small>
              <b>{row.replied_count}</b>
            </span>
            <span>
              <small>回复率</small>
              <b>{formatReplyRate(row.contacted_count, row.replied_count)}</b>
            </span>
          </div>
          {showOnboarded ? (
            <>
              <div className="workload-mobile-onboarded-count">
                <span>
                  <small>新增入公会</small>
                  <b>{getWorkloadOnboardedCount(row)}</b>
                </span>
              </div>
              <section className="workload-mobile-new-creators">
                <span>新增主播</span>
                <div>
                  {formatWorkloadOnboardedCreatorDetails(row).map((detail, index) => (
                    <b key={`${detail}-${index}`}>{detail}</b>
                  ))}
                </div>
              </section>
            </>
          ) : null}
          {granularity === 'daily' ? (
            <div className="workload-daily-note">
              <span>备注 / 今日进度</span>
              <p>{row.note || '-'}</p>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

type WorkloadDateRange = {
  startIso: string;
  endIso: string;
  label: string;
};

async function listManagementWorkloadStatsForView(input: { month: string; regionId?: string; granularity: WorkloadGranularity; view: WorkloadView }) {
  if (input.view !== 'last-week') {
    return scoutService.listManagementWorkloadStats({ month: input.month, regionId: input.regionId, granularity: input.granularity });
  }

  const lastWeek = getCompleteWeekRange(getMalaysiaDateString(), -1);
  const monthStats = await Promise.all(
    getMonthsInDateRange(lastWeek.startIso, lastWeek.endIso).map((targetMonth) =>
      scoutService.listManagementWorkloadStats({ month: targetMonth, regionId: input.regionId, granularity: 'weekly' }),
    ),
  );

  return mergeWorkloadStats(monthStats.flat())
    .filter((row) => row.period_start === lastWeek.startIso && row.period_end === lastWeek.endIso)
    .map((row) => ({ ...row, period_label: lastWeek.label }));
}

function getTeamWorkloadRows(stats: ManagementWorkloadStat[], view: TeamWorkloadView, malaysiaToday: string) {
  if (view === 'daily') {
    return stats.filter((row) => row.period_start === malaysiaToday);
  }

  if (view === 'weekly') {
    return stats.filter((row) => row.period_start <= malaysiaToday && malaysiaToday <= row.period_end);
  }

  if (view === 'last-week') {
    const lastWeek = getCompleteWeekRange(malaysiaToday, -1);
    return stats
      .filter((row) => row.period_start === lastWeek.startIso && row.period_end === lastWeek.endIso)
      .map((row) => ({ ...row, period_label: lastWeek.label }));
  }

  return stats;
}

function summarizeWorkloadStats(rows: ManagementWorkloadStat[]) {
  return rows.reduce(
    (summary, row) => ({
      contacted_count: summary.contacted_count + row.contacted_count,
      replied_count: summary.replied_count + row.replied_count,
      onboarded_count: summary.onboarded_count + getWorkloadOnboardedCount(row),
    }),
    { contacted_count: 0, replied_count: 0, onboarded_count: 0 },
  );
}

function addOnboardedCountsToWorkloadRows(rows: ManagementWorkloadStat[], creators: CreatorProfile[], malaysiaToday: string): ManagementWorkloadDisplayStat[] {
  const lastWeek = getCompleteWeekRange(malaysiaToday, -1);
  const rowMap = new Map<string, ManagementWorkloadDisplayStat>();

  rows.forEach((row) => {
    rowMap.set(getWorkloadRowKey(row), { ...row, onboarded_count: 0, onboarded_creator_details: [] });
  });

  const people = new Map<string, CreatorProfile[]>();
  creators.forEach((creator) => {
    if (creator.status !== 'active') return;
    if (!isCreatorJoinedInRange(creator, lastWeek)) return;

    const personKey = getCreatorPersonKey(creator);
    people.set(personKey, [...(people.get(personKey) ?? []), creator]);
  });

  people.forEach((personCreators) => {
    const creator = getWorkloadRepresentativeCreator(personCreators);
    const rowKey = getCreatorWorkloadRowKey(creator);
    const row = rowMap.get(rowKey) ?? createWorkloadRowFromCreator(creator, lastWeek);
    row.onboarded_count += 1;
    row.onboarded_creator_details.push(formatWorkloadOnboardedCreatorDetail(personCreators));
    rowMap.set(rowKey, row);
  });

  return Array.from(rowMap.values()).sort((first, second) => {
    const periodOrder = first.period_start.localeCompare(second.period_start);
    if (periodOrder !== 0) return periodOrder;
    return first.scout_name.localeCompare(second.scout_name);
  });
}

function getWorkloadRowKey(row: ManagementWorkloadStat) {
  const scoutKey = row.scout_profile_id ?? row.scout_employee_id ?? row.scout_name;
  return `${scoutKey}|${row.region_id ?? 'none'}`;
}

function getCreatorWorkloadRowKey(creator: CreatorProfile) {
  const scoutName = (creator.scout_display_name ?? getEmployeeName(creator.scout)) || '未填写';
  const scoutKey = creator.scout_profile_id ?? creator.scout_employee_id ?? scoutName;
  return `${scoutKey}|${creator.region_id ?? 'none'}`;
}

function createWorkloadRowFromCreator(creator: CreatorProfile, range: WorkloadDateRange): ManagementWorkloadDisplayStat {
  const scoutName = (creator.scout_display_name ?? getEmployeeName(creator.scout)) || '未填写';

  return {
    period_start: range.startIso,
    period_end: range.endIso,
    period_label: range.label,
    scout_employee_id: creator.scout_employee_id,
    scout_profile_id: creator.scout_profile_id,
    scout_name: scoutName,
    region_id: creator.region_id,
    region_code: creator.region?.code ?? null,
    contacted_count: 0,
    replied_count: 0,
    onboarded_count: 0,
    onboarded_creator_details: [],
    note: null,
  };
}

function isCreatorJoinedInRange(creator: CreatorProfile, range: WorkloadDateRange) {
  if (creator.registration_type === 'existing_creator') return false;
  const joinedDate = creator.guild_joined_date ?? creator.joined_date;
  return range.startIso <= joinedDate && joinedDate <= range.endIso;
}

function getCreatorPersonKey(creator: CreatorProfile) {
  return creator.creator_entity_id ? `entity:${creator.creator_entity_id}` : `profile:${creator.id}`;
}

function getWorkloadOnboardedCount(row: ManagementWorkloadStat) {
  return (row as Partial<ManagementWorkloadDisplayStat>).onboarded_count ?? 0;
}

function getWorkloadOnboardedCreatorDetails(row: ManagementWorkloadStat) {
  return (row as Partial<ManagementWorkloadDisplayStat>).onboarded_creator_details ?? [];
}

function getWorkloadRepresentativeCreator(creators: CreatorProfile[]) {
  return creators.reduce((current, creator) => {
    if (creator.joined_date < current.joined_date) return creator;
    if (creator.joined_date === current.joined_date && creator.id < current.id) return creator;
    return current;
  });
}

function formatWorkloadOnboardedCreatorDetails(row: ManagementWorkloadStat) {
  const details = getWorkloadOnboardedCreatorDetails(row);
  return details.length > 0 ? details : ['—'];
}

function formatWorkloadOnboardedCreatorDetail(creators: CreatorProfile[]) {
  const sortedCreators = sortCreatorProfiles(creators);
  const creatorName = sortedCreators[0]?.creator_name.trim() || '-';
  const platformDetails = sortedCreators
    .map((creator) => `${platformLabels[creator.platform]} · ${getCreatorFiveOneLabel(creator)}`)
    .join(' / ');

  return `${creatorName} · ${platformDetails}`;
}

function getCreatorFiveOneLabel(creator: CreatorProfile) {
  return creator.creator_type === '5+1' ? '5+1' : '非5+1';
}

function getWorkloadPeriodRowKey(row: ManagementWorkloadStat) {
  return `${row.period_start}|${row.period_end}|${getWorkloadRowKey(row)}`;
}

function getCompleteWeekRange(dateIso: string, weekOffset: number): WorkloadDateRange {
  const date = parseDateOnly(dateIso);
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const start = addUtcDays(date, mondayOffset + weekOffset * 7);
  const end = addUtcDays(start, 6);
  const startIso = formatUtcDate(start);
  const endIso = formatUtcDate(end);

  return {
    startIso,
    endIso,
    label: `${startIso} ～ ${endIso}`,
  };
}

function getMonthsInDateRange(startIso: string, endIso: string) {
  const months: string[] = [];
  const endMonth = endIso.slice(0, 7);
  let cursor = parseDateOnly(`${startIso.slice(0, 7)}-01`);

  while (true) {
    const month = formatUtcDate(cursor).slice(0, 7);
    months.push(month);
    if (month === endMonth) return months;
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
}

function mergeWorkloadStats(rows: ManagementWorkloadStat[]) {
  const merged = new Map<string, ManagementWorkloadStat>();

  rows.forEach((row) => {
    const key = getWorkloadPeriodRowKey(row);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...row });
      return;
    }

    merged.set(key, {
      ...current,
      contacted_count: current.contacted_count + row.contacted_count,
      replied_count: current.replied_count + row.replied_count,
      note: current.note ?? row.note ?? null,
    });
  });

  return Array.from(merged.values());
}

function parseDateOnly(dateIso: string) {
  const [year, month, day] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function formatUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
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
    const label = creator.scout_display_name || getEmployeeName(creator.scout) || '未分配星探';
    const group = groups.get(key);

    if (group) {
      if (group.label === '未分配星探' && label !== '未分配星探') group.label = label;
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
    <section className="scout-summary-section scout-recruit-summary-block">
      <h4 style={summarySectionTitleStyle}>{title}</h4>
      {rows.length === 0 ? (
        <div className="table-state">暂无统计数据。</div>
      ) : (
        <div className="recruit-summary-group-list">
          {rows.map((row) => (
            <article className="recruit-summary-group-card" key={row.key}>
              <h5>{row.label}</h5>
              <RecruitPlatformCardGrid tiktok={row.breakdown.tiktok} douyin={row.breakdown.douyin} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ScoutRecruitSummaryTable({ rows }: { rows: RecruitBreakdownRow[] }) {
  const sortedRows = rows
    .map((row, index) => ({ row, index }))
    .sort((first, second) => {
      const firstTotal = getRecruitBreakdownTotal(first.row.breakdown);
      const secondTotal = getRecruitBreakdownTotal(second.row.breakdown);

      if (secondTotal !== firstTotal) return secondTotal - firstTotal;
      return first.index - second.index;
    })
    .map(({ row }) => row);

  return (
    <section className="scout-summary-section scout-recruit-summary-block scout-compact-summary-section">
      <h4 style={summarySectionTitleStyle}>每位星探统计</h4>
      {sortedRows.length === 0 ? (
        <div className="table-state">暂无统计数据。</div>
      ) : (
        <>
          <div className="staff-table-wrap scout-compact-table-wrap">
            <table className="staff-table scout-compact-summary-table">
              <colgroup>
                <col className="scout-compact-name-col" />
                <col className="scout-compact-metric-col" />
                <col className="scout-compact-metric-col" />
                <col className="scout-compact-metric-col" />
                <col className="scout-compact-metric-col" />
                <col className="scout-compact-metric-col" />
                <col className="scout-compact-metric-col" />
              </colgroup>
              <thead>
                <tr>
                  <th rowSpan={2} className="scout-compact-name-head">
                    星探
                  </th>
                  <th colSpan={3} className="scout-compact-platform-head scout-compact-platform-head--tiktok">
                    <PlatformLogoTitle logoUrl={tiktokLogoUrl} title="TikTok" logoSize={22} fontSize={13} />
                  </th>
                  <th colSpan={3} className="scout-compact-platform-head scout-compact-platform-head--douyin">
                    <PlatformLogoTitle logoUrl={douyinLogoUrl} title="抖音" logoSize={22} fontSize={13} />
                  </th>
                </tr>
                <tr>
                  <th className="scout-compact-metric-head scout-compact-cell--tiktok">招募总数</th>
                  <th className="scout-compact-metric-head scout-compact-cell--tiktok">5+1</th>
                  <th className="scout-compact-metric-head scout-compact-cell--tiktok">非5+1</th>
                  <th className="scout-compact-metric-head scout-compact-cell--douyin">招募总数</th>
                  <th className="scout-compact-metric-head scout-compact-cell--douyin">5+1</th>
                  <th className="scout-compact-metric-head scout-compact-cell--douyin">非5+1</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.key}>
                    <td className="scout-compact-name-cell">{row.label}</td>
                    <td className="scout-compact-number-cell scout-compact-cell--tiktok">{row.breakdown.tiktok.total}</td>
                    <td className="scout-compact-number-cell scout-compact-cell--tiktok">{row.breakdown.tiktok.plusFiveOne}</td>
                    <td className="scout-compact-number-cell scout-compact-cell--tiktok">{row.breakdown.tiktok.nonFiveOne}</td>
                    <td className="scout-compact-number-cell scout-compact-cell--douyin">{row.breakdown.douyin.total}</td>
                    <td className="scout-compact-number-cell scout-compact-cell--douyin">{row.breakdown.douyin.plusFiveOne}</td>
                    <td className="scout-compact-number-cell scout-compact-cell--douyin">{row.breakdown.douyin.nonFiveOne}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="scout-compact-mobile-list" hidden>
            <ScoutRecruitMobilePlatformTable title="TikTok" platform="tiktok" rows={sortedRows} logoUrl={tiktokLogoUrl} />
            <ScoutRecruitMobilePlatformTable title="抖音" platform="douyin" rows={sortedRows} logoUrl={douyinLogoUrl} />
          </div>
        </>
      )}
    </section>
  );
}

function ScoutRecruitMobilePlatformTable({
  title,
  platform,
  rows,
  logoUrl,
}: {
  title: string;
  platform: 'tiktok' | 'douyin';
  rows: RecruitBreakdownRow[];
  logoUrl: string;
}) {
  return (
    <section className={`scout-compact-mobile-platform-card scout-compact-mobile-platform-card--${platform}`}>
      <PlatformLogoTitle logoUrl={logoUrl} title={title} logoSize={20} fontSize={13} />
      <div className="scout-compact-mobile-platform-table">
        <span className="scout-compact-mobile-name-head">星探</span>
        <span>招募总数</span>
        <span>5+1</span>
        <span>非5+1</span>
        {rows.map((row) => {
          const breakdown = row.breakdown[platform];

          return (
            <Fragment key={`${platform}-${row.key}`}>
              <b className="scout-compact-mobile-name-cell">{row.label}</b>
              <b>{breakdown.total}</b>
              <b>{breakdown.plusFiveOne}</b>
              <b>{breakdown.nonFiveOne}</b>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

function getRecruitBreakdownTotal(breakdown: RecruitBreakdownRow['breakdown']) {
  return breakdown.tiktok.total + breakdown.douyin.total;
}

const summarySectionTitleStyle = {
  fontSize: 18,
  fontWeight: 600,
} as const;

function ManagementRecruitBreakdownPanel({ breakdown }: { breakdown: ReturnType<typeof createRecruitBreakdown> }) {
  return (
    <div className="scout-total-panel scout-recruit-summary-block">
      <h4 style={summarySectionTitleStyle}>DY Group 总计</h4>
      <RecruitPlatformCardGrid tiktok={breakdown.tiktok} douyin={breakdown.douyin} />
    </div>
  );
}

function RecruitPlatformCardGrid({ tiktok, douyin }: { tiktok: RecruitPlatformSummary; douyin: RecruitPlatformSummary }) {
  return (
    <div className="recruit-platform-card-grid">
      <RecruitPlatformSummaryCard title="TikTok" breakdown={tiktok} platform="tiktok" logoUrl={tiktokLogoUrl} />
      <RecruitPlatformSummaryCard title="抖音" breakdown={douyin} platform="douyin" logoUrl={douyinLogoUrl} />
    </div>
  );
}

type RecruitPlatformSummary = ReturnType<typeof createRecruitBreakdown>['tiktok'];

function RecruitPlatformSummaryCard({
  title,
  breakdown,
  platform,
  logoUrl,
}: {
  title: string;
  breakdown: RecruitPlatformSummary;
  platform: 'tiktok' | 'douyin';
  logoUrl: string;
}) {
  return (
    <section className={`recruit-platform-summary-card recruit-platform-summary-card--${platform}`}>
      <PlatformLogoTitle logoUrl={logoUrl} title={title} logoSize={34} fontSize={18} />
      <div className="recruit-platform-total">
        <span>招募总数</span>
        <strong>{breakdown.total}</strong>
      </div>
      <div className="recruit-platform-breakdown">
        <span>
          <small>5+1</small>
          <b>{breakdown.plusFiveOne}</b>
        </span>
        <span>
          <small>非5+1</small>
          <b>{breakdown.nonFiveOne}</b>
        </span>
      </div>
    </section>
  );
}

function PlatformLogoTitle({ logoUrl, title, logoSize, fontSize }: { logoUrl: string; title: string; logoSize: number; fontSize: number }) {
  return (
    <span className="platform-logo-title" style={{ ...platformLogoTitleStyle, fontSize }}>
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
  entityValues: CreatorEntityFormValues;
  options: ScoutOptions;
  scoutOptions: OnboardingScoutOption[];
  secondaryManagerOptions: OnboardingCollaboratorOption[];
  managerOptions: OnboardingManagerOption[];
  editingCreator: CreatorProfile | null;
  saving: boolean;
  onChange: (values: CreatorFormValues) => void;
  onEntityChange: (values: CreatorEntityFormValues) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const platformIdLabel = props.values.platform === 'tiktok' ? 'TikTok User ID' : '抖音 User ID';
  const platformAccountLabel = props.values.platform === 'tiktok' ? 'TikTok 用户名' : '抖音用户名';
  const platformNameLabel = props.values.platform === 'tiktok' ? 'TikTok 名字' : '抖音名字';

  function updateEntity(values: Partial<CreatorEntityFormValues>) {
    const nextValues = { ...props.entityValues, ...values, platforms: { ...props.entityValues.platforms } };
    if (values.display_name !== undefined) {
      (Object.keys(nextValues.platforms) as CreatorPlatform[]).forEach((platform) => {
        nextValues.platforms[platform] = { ...nextValues.platforms[platform], bank_account_name: values.display_name ?? '' };
      });
    }
    if (values.guild_joined_date !== undefined) {
      (Object.keys(nextValues.platforms) as CreatorPlatform[]).forEach((platform) => {
        nextValues.platforms[platform] = { ...nextValues.platforms[platform], joined_date: values.guild_joined_date ?? '' };
      });
    }
    if (values.scout_employee_id && values.scout_employee_id === nextValues.secondary_scout_employee_id) nextValues.secondary_scout_employee_id = '';
    if (values.manager_employee_id && values.manager_employee_id === nextValues.secondary_manager_employee_id) nextValues.secondary_manager_employee_id = '';
    if (values.has_secondary_scout === false) nextValues.secondary_scout_employee_id = '';
    if (values.has_secondary_manager === false) nextValues.secondary_manager_employee_id = '';
    props.onEntityChange(nextValues);
  }

  function updatePlatform(platform: CreatorPlatform, values: Partial<CreatorPlatformFormValues>) {
    props.onEntityChange({
      ...props.entityValues,
      platforms: {
        ...props.entityValues.platforms,
        [platform]: {
          ...props.entityValues.platforms[platform],
          ...values,
        },
      },
    });
  }

  if (!props.editingCreator) {
    const selectedPlatforms = (Object.keys(props.entityValues.platforms) as CreatorPlatform[]).filter((platform) => props.entityValues.platforms[platform].enabled);
    const sharedBankValues = props.entityValues.platforms[selectedPlatforms[0] ?? 'tiktok'];

    return (
      <SystemModal
        title={props.entityValues.registration_type === 'existing_creator' ? '现有主播补录' : '新增入公会'}
        ariaLabel="主播资料"
        onClose={props.onClose}
        footer={
          <>
            <button className="secondary-button compact-button" type="button" onClick={props.onClose}>
              取消
            </button>
            <button className="primary-button compact-button creator-confirm-button" type="submit" form="creator-form" disabled={props.saving || selectedPlatforms.length === 0}>
              {props.saving ? '保存中...' : '确认'}
            </button>
          </>
        }
      >
        <form id="creator-form" className="creator-onboarding-form" onSubmit={props.onSubmit}>
          <div className="form-grid">
            <div className="form-section-title">共同资料</div>
            {props.entityValues.registration_type === 'existing_creator' ? <p className="form-field-wide">用于录入公司现有主播，不计入新增入公会统计。</p> : null}
            <TextField label="主播名字" value={props.entityValues.display_name} onChange={(value) => updateEntity({ display_name: value })} required />
            <TextField label={props.entityValues.registration_type === 'existing_creator' ? '真实入公会日期' : '入会日期'} type="date" value={props.entityValues.guild_joined_date} onChange={(value) => updateEntity({ guild_joined_date: value })} required />
            <SelectField label="区域" value={props.entityValues.region_id} onChange={(value) => updateEntity({ region_id: value })} required>
              <option value="">请选择</option>
              {props.options.regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.code}
                </option>
              ))}
            </SelectField>
            <SearchableEmployeeSelect label="星探" value={props.entityValues.scout_employee_id} options={props.scoutOptions} regionId={props.entityValues.region_id} onChange={(value) => updateEntity({ scout_employee_id: value })} placeholder="搜索星探" required />
            <SearchableEmployeeSelect label="经纪人" value={props.entityValues.manager_employee_id} options={props.managerOptions} onChange={(value) => updateEntity({ manager_employee_id: value })} placeholder="搜索经纪人" required />
            <div className="form-field-wide collaborator-row">
              <label className="collaborator-toggle"><input type="checkbox" checked={props.entityValues.has_secondary_scout} onChange={(event) => updateEntity({ has_secondary_scout: event.target.checked })} /> 还有第二位星探</label>
              {props.entityValues.has_secondary_scout ? (
                <SearchableEmployeeSelect label="第二位星探" hideLabel value={props.entityValues.secondary_scout_employee_id} options={props.scoutOptions.filter((scout) => scout.id !== props.entityValues.scout_employee_id)} regionId={props.entityValues.region_id} onChange={(value) => updateEntity({ secondary_scout_employee_id: value })} placeholder="搜索星探" required />
              ) : null}
            </div>
            <div className="form-field-wide collaborator-row">
              <label className="collaborator-toggle"><input type="checkbox" checked={props.entityValues.has_secondary_manager} onChange={(event) => updateEntity({ has_secondary_manager: event.target.checked })} /> 还有第二位经纪人</label>
              {props.entityValues.has_secondary_manager ? (
                <SearchableEmployeeSelect label="第二位经纪人" hideLabel value={props.entityValues.secondary_manager_employee_id} options={props.secondaryManagerOptions.filter((manager) => manager.id !== props.entityValues.manager_employee_id)} regionId={props.entityValues.region_id} onChange={(value) => updateEntity({ secondary_manager_employee_id: value })} placeholder="搜索经纪人" required />
              ) : null}
            </div>

            <div className="form-section-title">平台</div>
            <div className="platform-checkbox-grid">
              {(Object.keys(props.entityValues.platforms) as CreatorPlatform[]).map((platform) => (
                <label key={platform} className={`platform-checkbox-option${props.entityValues.platforms[platform].enabled ? ' selected' : ''}`}>
                  <span>{platformLabels[platform]}</span>
                  <input type="checkbox" checked={props.entityValues.platforms[platform].enabled} onChange={(event) => updatePlatform(platform, { enabled: event.target.checked })} />
                </label>
              ))}
            </div>

            {selectedPlatforms.map((platform) => {
              const platformValues = props.entityValues.platforms[platform];
              return (
                <div className="form-grid form-field-wide" key={platform}>
                  <div className="form-section-title platform-form-section-title">{platformLabels[platform]}</div>
                  <TextField label="入会日期" type="date" value={platformValues.joined_date} onChange={(value) => updatePlatform(platform, { joined_date: value })} required />
                  <TextField label={platform === 'tiktok' ? 'TikTok User ID' : '抖音 User ID'} value={platformValues.platform_user_id} onChange={(value) => updatePlatform(platform, { platform_user_id: value })} required />
                  <TextField label={platform === 'tiktok' ? 'TikTok 用户名' : '抖音用户名'} value={platformValues.platform_account} onChange={(value) => updatePlatform(platform, { platform_account: value })} required />
                  <TextField label={platform === 'tiktok' ? 'TikTok ID' : '抖音号'} value={platformValues.platform_public_id} onChange={(value) => updatePlatform(platform, { platform_public_id: value })} required />
                  <SelectField label="主播形式" value={platformValues.creator_type} onChange={(value) => updatePlatform(platform, { creator_type: value as CreatorType })}>
                    {creatorTypes.map((type) => (
                      <option key={type} value={type}>
                        {creatorTypeLabels[type]}
                      </option>
                    ))}
                  </SelectField>
                </div>
              );
            })}
            <div className="form-section-title">银行资料</div>
            <TextField label="银行账户名字" value={props.entityValues.display_name} onChange={() => undefined} readOnly />
            <TextField label="银行名字" value={sharedBankValues.bank_name} onChange={(value) => selectedPlatforms.forEach((platform) => updatePlatform(platform, { bank_name: value }))} required />
            <TextField label="银行账号" value={sharedBankValues.bank_account} onChange={(value) => selectedPlatforms.forEach((platform) => updatePlatform(platform, { bank_account: value }))} required />
          </div>
        </form>
      </SystemModal>
    );
  }

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
          <TextField label={props.values.platform === 'tiktok' ? 'TikTok ID' : '抖音号'} value={props.values.platform_public_id} onChange={(value) => props.onChange({ ...props.values, platform_public_id: value })} />
          <SelectField label="区域" value={props.values.region_id} onChange={(value) => props.onChange({ ...props.values, region_id: value })} required>
            <option value="">请选择</option>
            {props.options.regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.code}
              </option>
            ))}
          </SelectField>
          <TextField label={platformNameLabel} value={props.values.creator_name} onChange={(value) => props.onChange({ ...props.values, creator_name: value })} required />
          <SearchableEmployeeSelect label="星探" value={props.values.scout_employee_id} options={props.scoutOptions} regionId={props.values.region_id} onChange={(value) => props.onChange({ ...props.values, scout_employee_id: value })} placeholder="搜索星探" required />
          <SearchableEmployeeSelect label="经纪人" value={props.values.manager_employee_id} options={props.managerOptions} onChange={(value) => props.onChange({ ...props.values, manager_employee_id: value })} placeholder="搜索经纪人" required />
          <SelectField label="主播形式" value={props.values.creator_type} onChange={(value) => props.onChange({ ...props.values, creator_type: value as CreatorType })}>
            {creatorTypes.map((type) => (
              <option key={type} value={type}>
                {creatorTypeLabels[type]}
              </option>
            ))}
          </SelectField>
          <div className="form-section-title">银行资料</div>
          <TextField label="银行账户名字" value={props.values.bank_account_name} onChange={(value) => props.onChange({ ...props.values, bank_account_name: value })} />
          <TextField label="银行名字" value={props.values.bank_name} onChange={(value) => props.onChange({ ...props.values, bank_name: value })} />
          <TextField label="银行账号" value={props.values.bank_account} onChange={(value) => props.onChange({ ...props.values, bank_account: value })} />
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
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  readOnly?: boolean;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} readOnly={readOnly} />
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

type SearchableEmployeeOption = {
  id: string;
  display_name: string;
  region_id?: string;
  employee_status?: EmployeeStatus;
};

function SearchableEmployeeSelect({
  label,
  value,
  options,
  regionId,
  onChange,
  placeholder,
  required,
  hideLabel = false,
}: {
  label: string;
  value: string;
  options: SearchableEmployeeOption[];
  regionId?: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  hideLabel?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = options.filter((option) =>
    (!regionId || !option.region_id || option.region_id === regionId)
    && (!normalizedQuery || option.display_name.toLowerCase().includes(normalizedQuery)),
  );
  const selectedOption = options.find((option) => option.id === value);
  const formatDisplayName = (option: SearchableEmployeeOption) => option.employee_status === 'left' ? `${option.display_name}（已离职）` : option.display_name;
  const inputValue = isOpen ? query : selectedOption ? formatDisplayName(selectedOption) : query;

  return (
    <div className="form-field searchable-employee-select">
      {hideLabel ? null : <span>{label}</span>}
      <input
        type="search"
        aria-label={hideLabel ? label : undefined}
        value={inputValue}
        placeholder={placeholder}
        required={required}
        onFocus={() => { setQuery(''); setIsOpen(true); }}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onChange={(event) => { setQuery(event.target.value); setIsOpen(true); }}
      />
      {isOpen ? (
        <div className="searchable-employee-options" role="listbox" aria-label={label}>
          {visibleOptions.length ? visibleOptions.map((option) => (
            <button key={option.id} type="button" role="option" aria-selected={option.id === value} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option.id); setQuery(''); setIsOpen(false); }}>
              {formatDisplayName(option)}
            </button>
          )) : <p>没有符合条件的人员</p>}
        </div>
      ) : null}
    </div>
  );
}

function groupCreatorProfiles(creators: CreatorProfile[], managerDisplayNameByCreatorId: Record<string, string>): CreatorProfileGroup[] {
  const groups = new Map<string, CreatorProfile[]>();

  creators.forEach((creator) => {
    const key = creator.creator_entity_id ? `entity:${creator.creator_entity_id}` : `profile:${creator.id}`;
    groups.set(key, [...(groups.get(key) ?? []), creator]);
  });

  return Array.from(groups.entries()).map(([id, profiles]) => {
    const sortedProfiles = sortCreatorProfiles(profiles);
    return {
      id,
      displayName: getConsistentValue(sortedProfiles, (creator) => creator.creator_name),
      profiles: sortedProfiles,
      managerName: getConsistentValue(sortedProfiles, (creator) => getCreatorManagerName(creator, managerDisplayNameByCreatorId)),
      status: getCreatorGroupStatus(sortedProfiles),
    };
  });
}

function summarizeCreatorGroups(groups: CreatorProfileGroup[]): CreatorGroupSummary {
  return groups.reduce<CreatorGroupSummary>(
    (summary, group) => {
      const platforms = new Set(group.profiles.map((creator) => creator.platform));
      summary.total += 1;
      if (platforms.has('tiktok')) summary.tiktok += 1;
      if (platforms.has('douyin')) summary.douyin += 1;
      if (platforms.has('tiktok') && platforms.has('douyin')) summary.dualPlatform += 1;
      return summary;
    },
    { total: 0, tiktok: 0, douyin: 0, dualPlatform: 0 },
  );
}

function filterCreatorGroupsByPlatform(groups: CreatorProfileGroup[], platformFilter: string) {
  if (platformFilter !== 'dual_platform') return groups;

  return groups.filter((group) => {
    if (!group.profiles.some((creator) => creator.creator_entity_id)) return false;
    const platforms = new Set(group.profiles.map((creator) => creator.platform));
    return platforms.has('tiktok') && platforms.has('douyin');
  });
}

function filterCreatorsBySearch(creators: CreatorProfile[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return creators;

  return creators.filter((creator) =>
    [creator.creator_name, creator.platform_account, creator.platform_user_id].some((value) => value.toLowerCase().includes(normalizedQuery)),
  );
}

function getDefaultCreatorPageSize() {
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches) return 10;
  return 20;
}

function createPaginationItems(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages]);
  for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
    if (page > 1 && page < totalPages) pages.add(page);
  }

  const sortedPages = Array.from(pages).sort((first, second) => first - second);
  return sortedPages.reduce<Array<number | 'ellipsis'>>((items, page, index) => {
    const previousPage = sortedPages[index - 1];
    if (previousPage && page - previousPage > 1) items.push('ellipsis');
    items.push(page);
    return items;
  }, []);
}

function sortCreatorProfiles(creators: CreatorProfile[]) {
  const platformOrder: Record<CreatorPlatform, number> = { tiktok: 0, douyin: 1 };
  return [...creators].sort((first, second) => platformOrder[first.platform] - platformOrder[second.platform]);
}

function getCreatorManagerName(creator: CreatorProfile, managerDisplayNameByCreatorId: Record<string, string>) {
  return getEmployeeName(creator.manager) || managerDisplayNameByCreatorId[creator.id] || '';
}

function getCreatorGroupStatus(creators: CreatorProfile[]): CreatorGroupStatus {
  const statuses = new Set(creators.map((creator) => creator.status ?? 'active'));
  return statuses.size === 1 ? ([...statuses][0] as CreatorStatus) : 'mixed';
}

function getCreatorStatusLabel(status: CreatorGroupStatus) {
  if (status === 'invalid') return '无效';
  if (status === 'mixed') return '状态不同';
  return '在职';
}

function getCreatorTypeDetail(creators: CreatorProfile[]) {
  const labels = Array.from(new Set(creators.map((creator) => creatorTypeLabels[creator.creator_type])));
  if (labels.length <= 1) return labels[0] ?? '-';

  return sortCreatorProfiles(creators)
    .map((creator) => `${platformLabels[creator.platform]}：${creatorTypeLabels[creator.creator_type]}`)
    .join(' ｜ ');
}

function getConsistentValue(creators: CreatorProfile[], getValue: (creator: CreatorProfile) => string) {
  const values = Array.from(new Set(creators.map((creator) => getValue(creator).trim()).filter(Boolean)));
  if (values.length === 0) return '-';
  if (values.length > 1) return '资料不同';
  return values[0];
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

function formatDailyWorkReplyRate(contactedCount: number, repliedCount: number) {
  if (repliedCount > contactedCount) return '--';
  return formatReplyRate(contactedCount, repliedCount);
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

function getCandidateStatusFilterLabel(filter: CandidateStatusFilter) {
  if (filter === 'all') return '全部';
  return getCandidateStatusLabel(filter);
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
