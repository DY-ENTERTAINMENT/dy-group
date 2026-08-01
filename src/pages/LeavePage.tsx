import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarCheck2, FileClock, Plus, Wand2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { MonthSelect } from '../components/MonthSelect';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { SystemModal } from '../components/SystemModal';
import { useAuth } from '../hooks/useAuth';
import {
  type LeaveFormValues,
  type LeaveBalance,
  type LeaveRequestItem,
  type RestDayCalendarItem,
  leaveService,
} from '../services/leave.service';
import type { LeaveRequestStatus, LeaveType } from '../types/database';

const leaveTypeLabels: Record<LeaveType, string> = {
  annual: '年假',
  medical: '病假',
  unpaid: '无薪假',
  replacement: '换休假',
};

const statusLabels: Record<LeaveRequestStatus, string> = {
  pending: '审核中',
  approved: '已通过',
  rejected: '已拒绝',
};

const emptyForm: LeaveFormValues = {
  leave_type: 'annual',
  start_date: '',
  end_date: '',
  reason: '',
  medical_attachment_url: '',
};

export function LeavePage() {
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeView] = useState<'leave' | 'rest'>('leave');
  const [requests, setRequests] = useState<LeaveRequestItem[]>([]);
  const [balances, setBalances] = useState<LeaveBalance>({ annualRemaining: 0, medicalRemaining: 0 });
  const [restDays, setRestDays] = useState<RestDayCalendarItem[]>([]);
  const [restCycle, setRestCycle] = useState(getCurrentRestCycle());
  const [selectedRestDates, setSelectedRestDates] = useState<string[]>([]);
  const [formValues, setFormValues] = useState<LeaveFormValues>(emptyForm);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const restCycleRange = useMemo(() => getRestCycleRange(restCycle), [restCycle]);
  const restCalendarCells = useMemo(
    () => getCalendarCells(restCycleRange.startDate, restCycleRange.endDate),
    [restCycleRange.startDate, restCycleRange.endDate],
  );
  const restDaysByDate = useMemo(() => {
    const map = new Map<string, RestDayCalendarItem[]>();
    restDays.forEach((restDay) => {
      const current = map.get(restDay.rest_date) ?? [];
      current.push(restDay);
      current.sort((a, b) => a.employee_name.localeCompare(b.employee_name, 'zh-CN'));
      map.set(restDay.rest_date, current);
    });
    return map;
  }, [restDays]);
  const myRestDays = useMemo(
    () => restDays.filter((restDay) => restDay.profile_id === profile?.id).map((restDay) => restDay.rest_date),
    [profile?.id, restDays],
  );
  const isCurrentRestCycle = restCycle === getCurrentRestCycle();
  const restLocked =
    !isCurrentRestCycle ||
    new Date(`${restCycleRange.startDate}T00:00:00`).getTime() <= new Date().setHours(0, 0, 0, 0);

  useEffect(() => {
    if (profile?.id) {
      void loadLeaveRequests(profile.id);
    }
  }, [profile?.id]);

  usePullToRefresh(async () => {
    if (profile?.id) {
      await loadLeaveRequests(profile.id);
    }
  }, [profile?.id, restCycle]);

  useEffect(() => {
    if (searchParams.get('tab')) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function loadLeaveRequests(profileId = profile?.id) {
    if (!profileId) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const leaveRequests = await leaveService.listMyLeaveRequests(profileId);
      setRequests(leaveRequests);
      setBalances(await leaveService.getMyLeaveBalances(profileId, leaveRequests));
    } catch (loadError) {
      setError(`读取请假记录失败：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadRestDays() {
    setLoading(true);
    setError('');

    try {
      const [yearText, monthText] = restCycle.split('-');
      const restDayList = await leaveService.listRestDays(Number(yearText), Number(monthText));
      setRestDays(restDayList);
      setSelectedRestDates(
        restDayList.filter((restDay) => restDay.profile_id === profile?.id).map((restDay) => restDay.rest_date),
      );
    } catch (loadError) {
      setError(`读取排休日历失败：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!profile?.id) {
      setError('无法确认当前用户。');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      if (formValues.leave_type === 'medical' && !formValues.medical_attachment_url) {
        throw new Error('请先上传病假证明。');
      }

      await leaveService.createLeaveRequest(profile.id, {
        ...formValues,
        medical_attachment_url: formValues.leave_type === 'medical' ? formValues.medical_attachment_url : '',
      });
      setMessage('请假申请已提交。');
      setFormValues(emptyForm);
      setShowLeaveModal(false);
      await loadLeaveRequests(profile.id);
    } catch (saveError) {
      setError(`提交请假申请失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleMedicalAttachmentUpload(file: File | null | undefined) {
    if (!profile?.id || !file) {
      return;
    }

    setUploadingAttachment(true);
    setError('');
    setMessage('');

    try {
      const attachmentUrl = await leaveService.uploadMedicalAttachment(profile.id, file);
      setFormValues((current) => ({ ...current, medical_attachment_url: attachmentUrl }));
      setMessage('病假证明已上传。');
    } catch (uploadError) {
      setError(`病假证明上传失败：${getErrorMessage(uploadError)}`);
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function handleSaveRestDays() {
    const [yearText, monthText] = restCycle.split('-');
    const cycleYear = Number(yearText);
    const cycleMonth = Number(monthText);
    const restDatesToSave = [...new Set(selectedRestDates.map((date) => date.slice(0, 10)))].sort();

    console.info('提交排休', {
      selectedRestDates: restDatesToSave,
      normalizedDates: restDatesToSave,
      cycleYear,
      cycleMonth,
    });

    if (restLocked) {
      setError('已过排休截止日期，不能修改本周期排休。');
      setMessage('');
      return;
    }

    if (restDatesToSave.length === 0) {
      setError('请选择排休日期');
      setMessage('');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const result = await leaveService.saveMyRestDays(cycleYear, cycleMonth, restDatesToSave);
      console.info('提交排休完成', {
        result,
        error: null,
      });
      setMessage('排休已保存。');
      await loadRestDays();
    } catch (saveError) {
      console.info('提交排休失败', {
        result: null,
        error: saveError,
      });
      setError(`提交排休失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoFillRestDays() {
    const [yearText, monthText] = restCycle.split('-');

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const count = await leaveService.autoFillRestDays(Number(yearText), Number(monthText));
      setMessage(`已自动补足 ${count} 天排休。`);
      await loadRestDays();
    } catch (autoError) {
      setError(`自动排休失败：${getErrorMessage(autoError)}`);
    } finally {
      setSaving(false);
    }
  }

  function toggleRestDate(date: string) {
    if (restLocked) {
      setError('已过排休截止日期，不能修改本周期排休。');
      return;
    }

    setError('');
    setSelectedRestDates((current) => {
      if (current.includes(date)) {
        return current.filter((item) => item !== date);
      }

      if (current.length >= 8) {
        setError('每个周期最多只能选择 8 天排休。');
        return current;
      }

      return [...current, date].sort();
    });
  }

  return (
    <section className="leave-page">
      <div className="view-tabs-row">
        <div className="page-heading">
          <span>Leave</span>
          <h2>请假</h2>
        </div>

        <button className="secondary-action" type="button" onClick={() => setShowLeaveModal(true)}>
          <Plus size={17} />
          <span>提交申请</span>
        </button>
      </div>

      {activeView === 'rest' ? (
        <RestDayPlanner
          cycle={restCycle}
          setCycle={setRestCycle}
          cycleRange={restCycleRange}
          calendarCells={restCalendarCells}
          restDaysByDate={restDaysByDate}
          selectedRestDates={selectedRestDates}
          myRestDays={myRestDays}
          locked={restLocked}
          loading={loading}
          saving={saving}
          error={error}
          message={message}
          onToggleDate={toggleRestDate}
          onSave={handleSaveRestDays}
          onAutoFill={handleAutoFillRestDays}
        />
      ) : (
        <>
          {error ? <p className="form-alert">{error}</p> : null}
          {message ? <p className="form-success">{message}</p> : null}

          <div className="leave-stats-grid">
            <BalanceCard label="年假" days={balances.annualRemaining} />
            <BalanceCard label="病假" days={balances.medicalRemaining} />
          </div>

          <div className="staff-list-panel">
            <div className="list-header">
              <div>
                <span>申请记录</span>
                <h3>{requests.length} 条记录</h3>
              </div>
            </div>

            {loading ? (
              <div className="table-state">正在读取请假记录...</div>
            ) : requests.length === 0 ? (
              <div className="table-state">暂无请假申请。</div>
            ) : (
              <LeaveRequestTable requests={requests} />
            )}
          </div>
        </>
      )}

      {showLeaveModal ? (
        <LeaveRequestModal
          values={formValues}
          saving={saving}
          error={error}
          message={message}
          onChange={setFormValues}
          onUploadAttachment={handleMedicalAttachmentUpload}
          onClose={() => setShowLeaveModal(false)}
          onSubmit={handleSubmit}
          uploadingAttachment={uploadingAttachment}
        />
      ) : null}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="leave-stat-card">
      <CalendarCheck2 size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BalanceCard({ label, days }: { label: string; days: number }) {
  return (
    <div className="leave-stat-card">
      <CalendarCheck2 size={20} />
      <span>{label}</span>
      <strong>剩余 {days} 天</strong>
    </div>
  );
}

type LeaveRequestModalProps = {
  values: LeaveFormValues;
  saving: boolean;
  error: string;
  message: string;
  onChange: (values: LeaveFormValues) => void;
  onUploadAttachment: (file: File | null | undefined) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  uploadingAttachment: boolean;
};

function LeaveRequestModal({
  values,
  saving,
  error,
  message,
  onChange,
  onUploadAttachment,
  onClose,
  onSubmit,
  uploadingAttachment,
}: LeaveRequestModalProps) {
  const isMedical = values.leave_type === 'medical';
  const isReplacement = values.leave_type === 'replacement';

  return (
    <SystemModal
      title="提交申请"
      subtitle="请假&休假"
      ariaLabel="提交请假申请"
      wide={false}
      onClose={onClose}
      footer={
        <>
          <button className="secondary-button compact-button" type="button" onClick={onClose}>
            关闭
          </button>
          <button className="primary-button compact-button" type="submit" form="leave-request-form" disabled={saving}>
            <Plus size={18} />
            <span>{saving ? '提交中...' : '提交申请'}</span>
          </button>
        </>
      }
    >
        <form id="leave-request-form" onSubmit={onSubmit}>
          <div className="form-grid single">
            <label className="form-field">
              <span>假期类型</span>
              <select
                value={values.leave_type}
                onChange={(event) =>
                  onChange({
                    ...values,
                    leave_type: event.target.value as LeaveType,
                    medical_attachment_url: event.target.value === 'medical' ? values.medical_attachment_url : '',
                  })
                }
              >
                <option value="annual">年假</option>
                <option value="medical">病假</option>
                <option value="unpaid">无薪假</option>
                <option value="replacement">Replacement</option>
              </select>
            </label>

            <label className="form-field">
              <span>{isReplacement ? 'Make-up Saturday' : '开始日期'}</span>
              <input
                type="date"
                value={values.start_date}
                onChange={(event) => onChange({ ...values, start_date: event.target.value })}
                required
              />
            </label>

            <label className="form-field">
              <span>{isReplacement ? 'Leave Date' : '结束日期'}</span>
              <input
                type="date"
                value={values.end_date}
                onChange={(event) => onChange({ ...values, end_date: event.target.value })}
                required
              />
            </label>

            <label className="form-field">
              <span>原因</span>
              <textarea value={values.reason} onChange={(event) => onChange({ ...values, reason: event.target.value })} required />
            </label>

            {isMedical ? (
              <div className="form-field">
                <span>病假证明上传</span>
                <label className="secondary-action attachment-upload-action">
                  {uploadingAttachment ? '上传中...' : '上传图片 / 拍照上传'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={uploadingAttachment || saving}
                    onChange={(event) => {
                      onUploadAttachment(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                </label>
                {values.medical_attachment_url ? (
                  <a className="attachment-preview-link" href={values.medical_attachment_url} target="_blank" rel="noreferrer">
                    查看已上传病假证明
                  </a>
                ) : (
                  <p className="form-helper">请选择图片，手机端可直接拍照上传。</p>
                )}
              </div>
            ) : null}
          </div>

          {error ? <p className="form-alert">{error}</p> : null}
          {message ? <p className="form-success">{message}</p> : null}
        </form>
    </SystemModal>
  );
}

function LeaveRequestTable({ requests }: { requests: LeaveRequestItem[] }) {
  return (
    <div className="staff-table-wrap">
      <table className="staff-table">
        <thead>
          <tr>
            <th>假期类型</th>
            <th>日期</th>
            <th>原因</th>
            <th>状态</th>
            <th>审核备注</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td>{leaveTypeLabels[request.leave_type]}</td>
              <td>{formatLeaveDate(request)}</td>
              <td>{request.reason}</td>
              <td>
                <span className={`status-pill leave-status-${request.status}`}>{statusLabels[request.status]}</span>
              </td>
              <td>{request.review_note || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatLeaveDate(request: LeaveRequestItem) {
  if (request.leave_type === 'replacement') {
    return `原本休假日 ${request.start_date}，换去日期 ${request.end_date}`;
  }

  return `${request.start_date} 至 ${request.end_date}`;
}

export { leaveTypeLabels, statusLabels as leaveStatusLabels };

type RestDayPlannerProps = {
  cycle: string;
  setCycle: (cycle: string) => void;
  cycleRange: { startDate: string; endDate: string };
  calendarCells: Array<string | null>;
  restDaysByDate: Map<string, RestDayCalendarItem[]>;
  selectedRestDates: string[];
  myRestDays: string[];
  locked: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
  message: string;
  onToggleDate: (date: string) => void;
  onSave: () => void;
  onAutoFill: () => void;
};

function RestDayPlanner({
  cycle,
  setCycle,
  cycleRange,
  calendarCells,
  restDaysByDate,
  selectedRestDates,
  myRestDays,
  locked,
  loading,
  saving,
  error,
  message,
  onToggleDate,
  onSave,
  onAutoFill,
}: RestDayPlannerProps) {
  return (
    <div className="rest-planner">
      <div className="staff-list-panel schedule-filter-panel">
        <div className="attendance-filters">
          <label className="form-field">
            <span>排休月份</span>
            <MonthSelect value={cycle} onChange={setCycle} />
          </label>
          <div className="rest-cycle-summary">
            <span>排休周期</span>
            <strong>
              {cycleRange.startDate} 至 {cycleRange.endDate}
            </strong>
            <small>{locked ? '当前周期不可修改' : '截止日前可选择最多 8 天'}</small>
          </div>
        </div>
      </div>

      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <div className="leave-stats-grid">
        <StatCard label="已选排休" value={selectedRestDates.length} />
        <StatCard label="每月上限" value={8} />
        <StatCard label="已保存" value={myRestDays.length} />
        <StatCard label="剩余可选" value={Math.max(0, 8 - selectedRestDates.length)} />
      </div>

      <div className="staff-list-panel schedule-calendar-panel">
        <div className="list-header">
          <div>
            <span>排休日历</span>
            <h3>选择自己的休假日</h3>
          </div>
          <button className="secondary-action" type="button" onClick={onAutoFill} disabled={saving}>
            <Wand2 size={17} />
            <span>自动补足</span>
          </button>
        </div>

        {loading ? (
          <div className="table-state">正在读取排休日历...</div>
        ) : (
          <div className="leave-calendar-grid">
            {calendarCells.map((date, index) => {
              if (!date) {
                return <div className="leave-calendar-empty" key={`empty-${index}`} />;
              }

              const dayRestDays = restDaysByDate.get(date) ?? [];
              const selected = selectedRestDates.includes(date);

              return (
                <article className={selected ? 'leave-calendar-day rest-selected' : 'leave-calendar-day'} key={date}>
                  <header>
                    <strong>{formatDayMonth(date)}</strong>
                    <span>{weekdayLabel(date)}</span>
                  </header>

                  <button
                    className={selected ? 'rest-date-toggle selected' : 'rest-date-toggle'}
                    type="button"
                    onClick={() => onToggleDate(date)}
                    disabled={locked}
                  >
                    {selected ? '已选排休' : '选择排休'}
                  </button>

                  {dayRestDays.length === 0 ? (
                    <p>暂无排休</p>
                  ) : (
                    <div className="leave-calendar-list">
                      {dayRestDays.map((restDay) => (
                        <span className="leave-chip leave-type-rest" key={restDay.rest_day_id}>
                          {restDay.employee_name}：排休{restDay.source === 'auto' ? '（自动）' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <button className="primary-button rest-save-button" type="button" onClick={onSave} disabled={saving}>
          {saving ? null : <Plus size={18} />}
          <span>{saving ? '提交中...' : '提交排休'}</span>
        </button>
        {error ? <p className="form-alert rest-submit-feedback">{error}</p> : null}
        {message ? <p className="form-success rest-submit-feedback">{message}</p> : null}
      </div>
    </div>
  );
}

function getCurrentRestCycle() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const target = today.getDate() < 26 ? new Date(year, month, 1) : new Date(year, month + 1, 1);
  return `${target.getFullYear()}-${`${target.getMonth() + 1}`.padStart(2, '0')}`;
}

function getRestCycleRange(cycle: string) {
  const [yearText, monthText] = cycle.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const start = new Date(year, monthIndex - 1, 26);
  const end = new Date(year, monthIndex, 25);

  return {
    startDate: toDateKey(start),
    endDate: toDateKey(end),
  };
}

function getCalendarCells(startDate: string, endDate: string) {
  const date = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const dates: Array<string | null> = [];
  const mondayOffset = (date.getDay() + 6) % 7;

  for (let index = 0; index < mondayOffset; index += 1) {
    dates.push(null);
  }

  while (date <= end) {
    dates.push(toDateKey(date));
    date.setDate(date.getDate() + 1);
  }

  return dates;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekdayLabel(date: string) {
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(new Date(`${date}T00:00:00`));
}

function formatDayMonth(date: string) {
  const value = new Date(`${date}T00:00:00`);
  return `${String(value.getDate()).padStart(2, '0')}/${value.getMonth() + 1}`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return '未知错误';
}
