import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { History, PlusCircle, RefreshCw, Search } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import { usePermissions } from '../hooks/usePermissions';
import {
  leaveBalanceManagementService,
  type LeaveBalanceAdjustmentHistoryItem,
  type LeaveBalanceManagementStatusFilter,
  type ManagementLeaveBalanceRow,
} from '../services/leave-balance-management.service';
import type { LeaveType, Region } from '../types/database';
import { LeaveReviewPage } from './LeaveReviewPage';
import { leaveService } from '../services/leave.service';
import { replacementWorkChangeService } from '../services/replacement-work-change.service';

type ManagedLeaveType = Extract<LeaveType, 'annual' | 'medical'>;
type AdjustmentMode = 'increase' | 'decrease';

type ActionMenuPosition = {
  right: number;
  top?: number;
  bottom?: number;
};

type OpenActionMenu = {
  row: ManagementLeaveBalanceRow;
  position: ActionMenuPosition;
};

type AdjustmentFormValues = {
  leaveType: ManagedLeaveType;
  mode: AdjustmentMode;
  days: string;
  reason: string;
};

const leaveTypeLabels: Record<ManagedLeaveType, string> = {
  annual: '年假',
  medical: '病假',
};

const employeeStatusLabels: Record<LeaveBalanceManagementStatusFilter, string> = {
  working: '全部在职',
  active: '正式员工',
  probation: '试用期',
  inactive: '停用',
  left: '已离职',
  all: '全部员工',
};

const emptyAdjustmentForm: AdjustmentFormValues = {
  leaveType: 'annual',
  mode: 'increase',
  days: '',
  reason: '',
};

export function LeaveBalanceManagementPage() {
  const permissions = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab = requestedTab === 'replacement' || requestedTab === 'balance'
    ? requestedTab
    : permissions.canView('leave-review') ? 'leave' : 'balance';
  const canAdjust = permissions.canUse('leave-balance-management');
  const canViewBalances = permissions.canView('leave-balance-management');
  const canViewReviews = permissions.canView('leave-review');
  const [year, setYear] = useState(new Date().getFullYear());
  const [regionId, setRegionId] = useState('');
  const [employeeStatus, setEmployeeStatus] = useState<LeaveBalanceManagementStatusFilter>('working');
  const [search, setSearch] = useState('');
  const [regions, setRegions] = useState<Region[]>([]);
  const [balances, setBalances] = useState<ManagementLeaveBalanceRow[]>([]);
  const [adjustmentTarget, setAdjustmentTarget] = useState<ManagementLeaveBalanceRow | null>(null);
  const [adjustmentForm, setAdjustmentForm] = useState<AdjustmentFormValues>(emptyAdjustmentForm);
  const [historyTarget, setHistoryTarget] = useState<ManagementLeaveBalanceRow | null>(null);
  const [historyItems, setHistoryItems] = useState<LeaveBalanceAdjustmentHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pendingCounts, setPendingCounts] = useState({ leave: 0, replacement: 0 });
  const [openActionMenu, setOpenActionMenu] = useState<OpenActionMenu | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const actionMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const canSwitchRegion = regions.length > 1;
  const adjustmentPreview = useMemo(() => {
    if (!adjustmentTarget) return null;
    const days = Number(adjustmentForm.days);
    const signedDays = adjustmentForm.mode === 'increase' ? days : -days;
    const balance = getBalanceValues(adjustmentTarget, adjustmentForm.leaveType);
    const nextEffective = balance.effective + (Number.isFinite(signedDays) ? signedDays : 0);
    return {
      ...balance,
      signedDays,
      nextEffective,
      nextRemaining: nextEffective - balance.used,
    };
  }, [adjustmentForm, adjustmentTarget]);

  useEffect(() => {
    if (activeTab !== 'balance' || !canViewBalances) return;
    void loadRegions();
  }, [activeTab, canViewBalances]);

  useEffect(() => {
    if (activeTab !== 'balance' || !canViewBalances) return;
    void loadBalances();
  }, [activeTab, canViewBalances, year, regionId, employeeStatus, search]);

  useEffect(() => {
    if (!canViewReviews) return;
    void Promise.all([leaveService.listPendingLeaveRequests(), replacementWorkChangeService.listPending()])
      .then(([leave, replacement]) => setPendingCounts({
        leave: leave.filter((request) => request.leave_type === 'annual' || request.leave_type === 'medical' || request.leave_type === 'unpaid').length,
        replacement: leave.filter((request) => request.leave_type === 'replacement').length + replacement.length,
      }))
      .catch(() => setPendingCounts({ leave: 0, replacement: 0 }));
  }, [canViewReviews]);

  useEffect(() => {
    if (!openActionMenu) return;

    function closeMenu(event: MouseEvent) {
      const target = event.target as Node;
      if (!actionMenuRef.current?.contains(target) && !actionMenuTriggerRef.current?.contains(target)) {
        setOpenActionMenu(null);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenActionMenu(null);
    }

    function closeOnViewportChange() {
      setOpenActionMenu(null);
    }

    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [openActionMenu]);

  function selectTab(tab: 'leave' | 'replacement' | 'balance') {
    setSearchParams({ tab });
  }

  function toggleActionMenu(row: ManagementLeaveBalanceRow, trigger: HTMLButtonElement) {
    if (openActionMenu?.row.employee_id === row.employee_id) {
      setOpenActionMenu(null);
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const menuHeight = canAdjust ? 118 : 48;
    const right = Math.max(12, window.innerWidth - rect.right);
    const fitsBelow = window.innerHeight - rect.bottom >= menuHeight + 12;
    setOpenActionMenu({
      row,
      position: fitsBelow
        ? { top: rect.bottom + 6, right }
        : { bottom: Math.max(12, window.innerHeight - rect.top + 6), right },
    });
  }

  function renderActionTrigger(row: ManagementLeaveBalanceRow) {
    const isOpen = openActionMenu?.row.employee_id === row.employee_id;
    return (
      <button
        ref={isOpen ? actionMenuTriggerRef : undefined}
        className="secondary-button compact-button leave-balance-action-trigger"
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={isOpen ? `leave-balance-actions-${row.employee_id}` : undefined}
        onClick={(event) => toggleActionMenu(row, event.currentTarget)}
      >
        操作 <span aria-hidden="true">⌄</span>
      </button>
    );
  }

  async function loadRegions() {
    try {
      const regionOptions = await leaveBalanceManagementService.listAuthorizedRegions();
      setRegions(regionOptions);
      if (regionOptions.length === 1) {
        setRegionId(regionOptions[0].id);
      }
    } catch (loadError) {
      setError(`读取区域失败：${getErrorMessage(loadError)}`);
    }
  }

  async function loadBalances() {
    setLoading(true);
    setError('');

    try {
      const rows = await leaveBalanceManagementService.listBalances({
        year,
        regionId,
        employeeStatus,
        search,
      });
      setBalances(rows);
    } catch (loadError) {
      setError(`读取假期额度失败：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  function openAdjustment(row: ManagementLeaveBalanceRow, leaveType: ManagedLeaveType) {
    setAdjustmentTarget(row);
    setAdjustmentForm({ ...emptyAdjustmentForm, leaveType });
    setError('');
    setMessage('');
  }

  async function openHistory(row: ManagementLeaveBalanceRow) {
    setHistoryTarget(row);
    setHistoryItems([]);
    setHistoryLoading(true);
    setError('');
    setMessage('');

    try {
      const items = await leaveBalanceManagementService.listAdjustmentHistory(row.employee_id, year);
      setHistoryItems(items);
    } catch (loadError) {
      setError(`读取调整记录失败：${getErrorMessage(loadError)}`);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleAdjustmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjustmentTarget || !adjustmentPreview) return;

    const days = Number(adjustmentForm.days);
    if (!Number.isInteger(days) || days <= 0) {
      setError('请输入大于 0 的整数天数。');
      return;
    }

    if (!adjustmentForm.reason.trim()) {
      setError('请填写调整原因。');
      return;
    }

    if (adjustmentPreview.nextRemaining < 0) {
      setError('调整后剩余额度不可小于 0。');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await leaveBalanceManagementService.adjustBalance({
        employeeId: adjustmentTarget.employee_id,
        leaveYear: year,
        leaveType: adjustmentForm.leaveType,
        adjustmentDays: adjustmentPreview.signedDays,
        reason: adjustmentForm.reason,
      });
      setAdjustmentTarget(null);
      setMessage('假期额度已调整。');
      await loadBalances();
    } catch (saveError) {
      setError(`调整失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="leave-balance-management-page">
      <div className="holiday-management-tabs" role="tablist" aria-label="假期管理功能">
        <button className={`holiday-management-tab leave${activeTab === 'leave' ? ' active' : ''}`} type="button" role="tab" aria-selected={activeTab === 'leave'} onClick={() => selectTab('leave')} disabled={!canViewReviews}>请假审批 <b>{pendingCounts.leave}</b></button>
        <button className={`holiday-management-tab replacement${activeTab === 'replacement' ? ' active' : ''}`} type="button" role="tab" aria-selected={activeTab === 'replacement'} onClick={() => selectTab('replacement')} disabled={!canViewReviews}>调休审批 <b>{pendingCounts.replacement}</b></button>
        <button className={`holiday-management-tab balance${activeTab === 'balance' ? ' active' : ''}`} type="button" role="tab" aria-selected={activeTab === 'balance'} onClick={() => selectTab('balance')} disabled={!canViewBalances}>假期额度</button>
      </div>
      {activeTab === 'leave' || activeTab === 'replacement' ? (
        canViewReviews ? <LeaveReviewPage initialSection={activeTab} embedded onPendingCountsChange={setPendingCounts} /> : <div className="staff-list-panel"><div className="table-state compact">您没有查看审批资料的权限。</div></div>
      ) : !canViewBalances ? <div className="staff-list-panel"><div className="table-state compact">您没有查看假期额度的权限。</div></div> : <>
      {error && !adjustmentTarget && !historyTarget ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <div className="staff-list-panel leave-balance-management-panel">
        <div className="list-header leave-balance-management-header">
          <div>
            <span>年度假期额度</span>
            <h3>{balances.length} 位员工</h3>
            <p>按员工查看年假、病假年度额度、已使用天数与剩余额度。</p>
          </div>
          <button className="secondary-action" type="button" onClick={() => loadBalances()} disabled={loading}>
            <RefreshCw size={17} />
            <span>刷新</span>
          </button>
        </div>

        <div className="attendance-filters leave-balance-management-filters">
          <label className="form-field">
            <span>年份</span>
            <input
              type="number"
              min="2000"
              max="2100"
              value={year}
              onChange={(event) => setYear(Number(event.target.value) || new Date().getFullYear())}
            />
          </label>

          <label className="form-field">
            <span>区域</span>
            <select value={regionId} disabled={!canSwitchRegion} onChange={(event) => setRegionId(event.target.value)}>
              {canSwitchRegion ? <option value="">全部可查看区域</option> : null}
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.code}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>员工状态</span>
            <select
              value={employeeStatus}
              onChange={(event) => setEmployeeStatus(event.target.value as LeaveBalanceManagementStatusFilter)}
            >
              {Object.entries(employeeStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="table-search leave-balance-management-search">
            <Search size={16} />
            <input
              type="search"
              placeholder="搜索员工或工号"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        {loading ? (
          <div className="table-state">正在读取假期额度...</div>
        ) : balances.length === 0 ? (
          <div className="table-state">暂无假期额度数据。</div>
        ) : (
          <>
          <div className="staff-table-wrap leave-balance-management-table-wrap">
            <table className="staff-table leave-balance-management-table">
              <thead>
                <tr>
                  <th className="leave-balance-column-employee">员工</th>
                  <th className="leave-balance-column-code">员工编号</th>
                  <th className="leave-balance-column-region">区域</th>
                  <th className="leave-balance-column-annual-entitlement leave-balance-annual-heading leave-balance-group-start">年假年度额度</th>
                  <th className="leave-balance-column-annual-used leave-balance-annual-heading">年假已使用</th>
                  <th className="leave-balance-column-annual-remaining leave-balance-annual-heading leave-balance-group-end">年假剩余</th>
                  <th className="leave-balance-column-medical-entitlement leave-balance-medical-heading leave-balance-group-start">病假年度额度</th>
                  <th className="leave-balance-column-medical-used leave-balance-medical-heading">病假已使用</th>
                  <th className="leave-balance-column-medical-remaining leave-balance-medical-heading leave-balance-group-end">病假剩余</th>
                  <th className="leave-balance-column-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((row) => (
                  <tr key={row.employee_id}>
                    <td className="leave-balance-column-employee">
                      <strong>{row.employee_name}</strong>
                      <span>{employeeStatusLabels[row.employee_status] ?? row.employee_status}</span>
                    </td>
                    <td className="leave-balance-column-code">{row.employee_code || '-'}</td>
                    <td className="leave-balance-column-region">{row.region_code || '-'}</td>
                    <BalanceTableCell value={row.annual_effective_entitlement} adjustment={row.annual_adjustment_total} type="annual" />
                    <td className="leave-balance-column-annual-used leave-balance-used"><strong className="leave-balance-value-pill">{formatDays(row.annual_used_days)}</strong></td>
                    <td className={`leave-balance-column-annual-remaining ${getRemainingClassName(row.annual_remaining_days)}`}>
                      <strong className="leave-balance-value-pill">{formatDays(row.annual_remaining_days)}</strong>
                    </td>
                    <BalanceTableCell value={row.medical_effective_entitlement} adjustment={row.medical_adjustment_total} type="medical" />
                    <td className="leave-balance-column-medical-used leave-balance-used"><strong className="leave-balance-value-pill">{formatDays(row.medical_used_days)}</strong></td>
                    <td className={`leave-balance-column-medical-remaining ${getRemainingClassName(row.medical_remaining_days)}`}>
                      <strong className="leave-balance-value-pill">{formatDays(row.medical_remaining_days)}</strong>
                    </td>
                    <td className="leave-balance-column-actions">{renderActionTrigger(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="leave-balance-management-cards">
            {balances.map((row) => (
              <article className="leave-balance-management-card" key={row.employee_id}>
                <header>
                  <div>
                    <strong>{row.employee_name}</strong>
                    <span>{row.employee_code || '-'} · {row.region_code || '-'}</span>
                  </div>
                  <small>{employeeStatusLabels[row.employee_status] ?? row.employee_status}</small>
                </header>
                <BalanceCardGroup title="年假" tone="annual" values={{ entitlement: row.annual_effective_entitlement, used: row.annual_used_days, remaining: row.annual_remaining_days }} />
                <BalanceCardGroup title="病假" tone="medical" values={{ entitlement: row.medical_effective_entitlement, used: row.medical_used_days, remaining: row.medical_remaining_days }} />
                <footer>{renderActionTrigger(row)}</footer>
              </article>
            ))}
          </div>
          </>
        )}
      </div>

      {openActionMenu ? createPortal(
        <div
          ref={actionMenuRef}
          id={`leave-balance-actions-${openActionMenu.row.employee_id}`}
          className="leave-balance-action-dropdown leave-balance-action-portal"
          role="menu"
          style={openActionMenu.position}
        >
          {canAdjust ? <button className="leave-balance-annual-button" type="button" role="menuitem" onClick={() => { setOpenActionMenu(null); openAdjustment(openActionMenu.row, 'annual'); }}><PlusCircle size={15} />调整年假</button> : null}
          {canAdjust ? <button className="leave-balance-medical-button" type="button" role="menuitem" onClick={() => { setOpenActionMenu(null); openAdjustment(openActionMenu.row, 'medical'); }}><PlusCircle size={15} />调整病假</button> : null}
          <button className="leave-balance-history-button" type="button" role="menuitem" onClick={() => { setOpenActionMenu(null); void openHistory(openActionMenu.row); }}><History size={15} />查看记录</button>
        </div>,
        document.body,
      ) : null}

      {adjustmentTarget ? (
        <SystemModal
          title={`${adjustmentTarget.employee_name} · 额度调整`}
          subtitle={`${year} 年 ${leaveTypeLabels[adjustmentForm.leaveType]}`}
          ariaLabel="假期额度调整"
          onClose={() => setAdjustmentTarget(null)}
          footer={
            <>
              <button className="secondary-button compact-button" type="button" onClick={() => setAdjustmentTarget(null)}>
                取消
              </button>
              <button className="primary-button compact-button" type="submit" form="leave-balance-adjustment-form" disabled={saving}>
                {saving ? '保存中...' : '保存调整'}
              </button>
            </>
          }
        >
          <form id="leave-balance-adjustment-form" className="leave-balance-adjustment-form" onSubmit={handleAdjustmentSubmit}>
            {error ? <p className="form-alert">{error}</p> : null}
            <div className="leave-balance-summary-grid">
              <MetricItem label="基础额度" value={formatDays(adjustmentPreview?.base ?? 0)} />
              <MetricItem label="调整合计" value={formatSignedDays(adjustmentPreview?.adjustment ?? 0)} />
              <MetricItem label="年度额度" value={formatDays(adjustmentPreview?.effective ?? 0)} />
              <MetricItem label="已使用" value={formatDays(adjustmentPreview?.used ?? 0)} />
              <MetricItem label="调整后剩余" value={formatDays(adjustmentPreview?.nextRemaining ?? 0)} />
            </div>

            <div className="form-grid">
              <label className="form-field">
                <span>假期类型</span>
                <select
                  value={adjustmentForm.leaveType}
                  onChange={(event) =>
                    setAdjustmentForm((current) => ({ ...current, leaveType: event.target.value as ManagedLeaveType }))
                  }
                >
                  <option value="annual">年假</option>
                  <option value="medical">病假</option>
                </select>
              </label>

              <label className="form-field">
                <span>调整方向</span>
                <select
                  value={adjustmentForm.mode}
                  onChange={(event) => setAdjustmentForm((current) => ({ ...current, mode: event.target.value as AdjustmentMode }))}
                >
                  <option value="increase">增加</option>
                  <option value="decrease">减少</option>
                </select>
              </label>

              <label className="form-field">
                <span>调整天数</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={adjustmentForm.days}
                  onChange={(event) => setAdjustmentForm((current) => ({ ...current, days: event.target.value }))}
                />
              </label>
            </div>

            <label className="form-field">
              <span>调整原因</span>
              <textarea
                value={adjustmentForm.reason}
                onChange={(event) => setAdjustmentForm((current) => ({ ...current, reason: event.target.value }))}
              />
            </label>
          </form>
        </SystemModal>
      ) : null}

      {historyTarget ? (
        <SystemModal
          title={`${historyTarget.employee_name} · 调整记录`}
          subtitle={`${year} 年`}
          ariaLabel="假期额度调整记录"
          onClose={() => setHistoryTarget(null)}
          footer={
            <button className="secondary-button compact-button" type="button" onClick={() => setHistoryTarget(null)}>
              关闭
            </button>
          }
        >
          {error ? <p className="form-alert">{error}</p> : null}
          {historyLoading ? (
            <div className="table-state compact">正在读取调整记录...</div>
          ) : historyItems.length === 0 ? (
            <div className="table-state compact">暂无调整记录。</div>
          ) : (
            <div className="leave-balance-history-list">
              {historyItems.map((item) => (
                <article key={item.id} className="leave-balance-history-item">
                  <div>
                    <strong>{leaveTypeLabels[item.leave_type as ManagedLeaveType]}</strong>
                    <span>{formatDateTime(item.created_at)}</span>
                  </div>
                  <b className={item.adjustment_days < 0 ? 'leave-balance-negative' : undefined}>
                    {formatSignedDays(item.adjustment_days)}
                  </b>
                  <p>{item.reason}</p>
                  <small>操作人：{item.adjusted_by_name || '-'}</small>
                </article>
              ))}
            </div>
          )}
        </SystemModal>
      ) : null}
      </>}
    </section>
  );
}

function BalanceTableCell({ value, adjustment, type }: { value: number; adjustment: number; type: ManagedLeaveType }) {
  return (
    <td className={`leave-balance-column-${type}-entitlement leave-balance-entitlement leave-balance-entitlement-${type}`}>
      <strong className={`leave-balance-table-number leave-balance-value-pill`}>{formatDays(value)}</strong>
      {adjustment !== 0 ? <span>{formatSignedDays(adjustment)}</span> : null}
    </td>
  );
}

function BalanceCardGroup({
  title,
  tone,
  values,
}: {
  title: string;
  tone: ManagedLeaveType;
  values: { entitlement: number; used: number; remaining: number };
}) {
  return (
    <section className={`leave-balance-card-group leave-balance-card-group-${tone}`} aria-label={title}>
      <h4>{title}</h4>
      <div>
        <BalanceCardValue label="年度额度" className={`leave-balance-entitlement-${tone}`} value={values.entitlement} />
        <BalanceCardValue label="已使用" className="leave-balance-used" value={values.used} />
        <BalanceCardValue label="剩余" className={getRemainingClassName(values.remaining)} value={values.remaining} />
      </div>
    </section>
  );
}

function BalanceCardValue({ label, className, value }: { label: string; className: string; value: number }) {
  return (
    <div className="leave-balance-card-value">
      <span>{label}</span>
      <strong className={`${className} leave-balance-value-pill`}>{formatDays(value)}</strong>
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="leave-balance-summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getBalanceValues(row: ManagementLeaveBalanceRow, leaveType: ManagedLeaveType) {
  if (leaveType === 'annual') {
    return {
      base: row.annual_base_entitlement,
      adjustment: row.annual_adjustment_total,
      effective: row.annual_effective_entitlement,
      used: row.annual_used_days,
      remaining: row.annual_remaining_days,
    };
  }

  return {
    base: row.medical_base_entitlement,
    adjustment: row.medical_adjustment_total,
    effective: row.medical_effective_entitlement,
    used: row.medical_used_days,
    remaining: row.medical_remaining_days,
  };
}

function formatDays(days: number) {
  return `${days} 天`;
}

function getRemainingClassName(days: number) {
  if (days < 0) return 'leave-balance-negative';
  if (days === 0) return 'leave-balance-zero';
  return 'leave-balance-remaining';
}

function formatSignedDays(days: number) {
  return `${days > 0 ? '+' : ''}${days} 天`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}
