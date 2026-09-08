import { useEffect, useMemo, useState, type FormEvent } from 'react';
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

type ManagedLeaveType = Extract<LeaveType, 'annual' | 'medical'>;
type AdjustmentMode = 'increase' | 'decrease';

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
  const canAdjust = permissions.canUse('leave-balance-management');
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
    void loadRegions();
  }, []);

  useEffect(() => {
    void loadBalances();
  }, [year, regionId, employeeStatus, search]);

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
              placeholder="搜索员工、工号、职称"
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
          <div className="staff-table-wrap leave-balance-management-table-wrap">
            <table className="staff-table leave-balance-management-table">
              <thead>
                <tr>
                  <th>员工</th>
                  <th>员工编号</th>
                  <th>区域</th>
                  <th>职称</th>
                  <th>年假年度额度</th>
                  <th>年假已使用</th>
                  <th>年假剩余</th>
                  <th>病假年度额度</th>
                  <th>病假已使用</th>
                  <th>病假剩余</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((row) => (
                  <tr key={row.employee_id}>
                    <td>
                      <strong>{row.employee_name}</strong>
                      <span>{employeeStatusLabels[row.employee_status] ?? row.employee_status}</span>
                    </td>
                    <td>{row.employee_code || '-'}</td>
                    <td>{row.region_code || '-'}</td>
                    <td>{row.job_title || '-'}</td>
                    <BalanceTableCell value={row.annual_effective_entitlement} adjustment={row.annual_adjustment_total} />
                    <td>{formatDays(row.annual_used_days)}</td>
                    <td className={row.annual_remaining_days < 0 ? 'leave-balance-negative' : undefined}>
                      {formatDays(row.annual_remaining_days)}
                    </td>
                    <BalanceTableCell value={row.medical_effective_entitlement} adjustment={row.medical_adjustment_total} />
                    <td>{formatDays(row.medical_used_days)}</td>
                    <td className={row.medical_remaining_days < 0 ? 'leave-balance-negative' : undefined}>
                      {formatDays(row.medical_remaining_days)}
                    </td>
                    <td>
                      <div className="row-actions leave-balance-row-actions">
                        {canAdjust ? (
                          <>
                            <button className="secondary-button compact-button" type="button" onClick={() => openAdjustment(row, 'annual')}>
                              <PlusCircle size={15} />
                              年假
                            </button>
                            <button className="secondary-button compact-button" type="button" onClick={() => openAdjustment(row, 'medical')}>
                              <PlusCircle size={15} />
                              病假
                            </button>
                          </>
                        ) : null}
                        <button className="secondary-button compact-button" type="button" onClick={() => openHistory(row)}>
                          <History size={15} />
                          记录
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
    </section>
  );
}

function BalanceTableCell({ value, adjustment }: { value: number; adjustment: number }) {
  return (
    <td>
      <strong className="leave-balance-table-number">{formatDays(value)}</strong>
      {adjustment !== 0 ? <span>{formatSignedDays(adjustment)}</span> : null}
    </td>
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
