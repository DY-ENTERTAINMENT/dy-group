import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, FileText, Hourglass, Plus, RefreshCw, XCircle } from 'lucide-react';
import { profileService } from '../services/profile.service';
import './WorkTimeAdjustmentPage.css';
import { SystemModal } from '../components/SystemModal';
import {
  workTimeAdjustmentService,
  workTimeAdjustmentStatusLabels,
  type WorkTimeAdjustmentRequestItem,
} from '../services/work-time-adjustment.service';
import type { WorkTimeAdjustmentRequestDate } from '../types/database';

type FormValues = {
  startDate: string;
  endDate: string;
  adjustedStartTime: string;
  reason: string;
};

const emptyForm: FormValues = {
  startDate: '',
  endDate: '',
  adjustedStartTime: '09:00',
  reason: '',
};

const timeOptions = createTimeOptions();

export function WorkTimeAdjustmentPage() {
  const editTimeSelectRefs = useRef<Record<string, HTMLSelectElement | null>>({});
  const [standardTime, setStandardTime] = useState<Pick<import('../types/database').Employee, 'start_work_time' | 'end_work_time'> | null>(null);
  const [month, setMonth] = useState(getMalaysiaMonth);
  const [status, setStatus] = useState('all');
  const [moreStatusesOpen, setMoreStatusesOpen] = useState(false);
  const [requests, setRequests] = useState<WorkTimeAdjustmentRequestItem[]>([]);
  const [formValues, setFormValues] = useState<FormValues>(emptyForm);
  const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
  const [editTimes, setEditTimes] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingDetailId, setUpdatingDetailId] = useState('');
  const [openingAttachmentPath, setOpeningAttachmentPath] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const adjustedEndTimePreview = useMemo(
    () => formatAdjustedEndTimePreview(formValues.adjustedStartTime),
    [formValues.adjustedStartTime],
  );
  const tomorrow = useMemo(() => getTomorrowDateKey(), []);

  useEffect(() => {
    void loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    setError('');

    void profileService.getMyProfile().then((data) => setStandardTime(data.employee)).catch(() => setStandardTime(null));
    try {
      const requestList = await workTimeAdjustmentService.listMyRequests();
      setRequests(requestList);
      setEditTimes(createEditTimeState(requestList));
    } catch (loadError) {
      setError(`读取工时调整申请失败：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setFormValues({
      ...emptyForm,
      startDate: tomorrow,
      endDate: tomorrow,
    });
    setSelectedAttachment(null);
    setError('');
    setMessage('');
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formValues.startDate || !formValues.endDate || !formValues.adjustedStartTime || !formValues.reason.trim()) {
      setError('请完整填写申请日期、调整后上班时间和调整原因。');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const attachment = selectedAttachment ? await workTimeAdjustmentService.uploadAttachment(selectedAttachment) : null;
      await workTimeAdjustmentService.createRequest({
        startDate: formValues.startDate,
        endDate: formValues.endDate,
        adjustedStartTime: formValues.adjustedStartTime,
        reason: formValues.reason.trim(),
        attachment,
      });

      setMessage('工时调整申请已提交。');
      setFormOpen(false);
      setSelectedAttachment(null);
      setFormValues(emptyForm);
      await loadRequests();
    } catch (saveError) {
      setError(`提交工时调整申请失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateDate(detail: WorkTimeAdjustmentRequestDate) {
    const currentStartTime = detail.adjusted_start_time.slice(0, 5);
    const adjustedStartTime = editTimeSelectRefs.current[detail.id]?.value ?? editTimes[detail.id] ?? currentStartTime;

    if (adjustedStartTime === currentStartTime) {
      setError('请选择不同的调整时间。');
      setMessage('');
      return;
    }

    setUpdatingDetailId(detail.id);
    setError('');
    setMessage('');

    try {
      await workTimeAdjustmentService.updatePendingDate(detail.id, adjustedStartTime);
      setMessage('工时调整日期已更新。');
      await loadRequests();
    } catch (updateError) {
      setError(`更新工时调整日期失败：${getErrorMessage(updateError)}`);
    } finally {
      setUpdatingDetailId('');
    }
  }

  async function handleCancelDate(detail: WorkTimeAdjustmentRequestDate) {
    setUpdatingDetailId(detail.id);
    setError('');
    setMessage('');

    try {
      await workTimeAdjustmentService.cancelPendingDate(detail.id);
      setMessage('工时调整日期已取消。');
      await loadRequests();
    } catch (cancelError) {
      setError(`取消工时调整日期失败：${getErrorMessage(cancelError)}`);
    } finally {
      setUpdatingDetailId('');
    }
  }

  async function handleOpenAttachment(request: WorkTimeAdjustmentRequestItem) {
    if (!request.attachment_path) return;

    setOpeningAttachmentPath(request.attachment_path);
    setError('');

    const attachmentWindow = window.open('', '_blank');
    if (!attachmentWindow) {
      setError('浏览器阻止了新窗口，请允许弹出窗口后重试。');
      setOpeningAttachmentPath('');
      return;
    }

    attachmentWindow.opener = null;

    try {
      const signedUrl = await workTimeAdjustmentService.createAttachmentSignedUrl(request.attachment_path);
      attachmentWindow.location.href = signedUrl;
    } catch (attachmentError) {
      const errorMessage = `读取附件失败：${getErrorMessage(attachmentError)}`;
      setError(errorMessage);
      attachmentWindow.document.body.textContent = errorMessage;
    } finally {
      setOpeningAttachmentPath('');
    }
  }

  const monthRequests = requests.filter((request) => malaysiaMonthOf(request.created_at) === month);
  const isProcessed = (request: WorkTimeAdjustmentRequestItem) => request.dates.length > 0 && request.dates.every((detail) => ['approved', 'rejected', 'cancelled', 'revoked'].includes(detail.status));
  const pendingCount = monthRequests.filter((request) => request.dates.some((detail) => detail.status === 'pending')).length;
  const processedCount = monthRequests.filter(isProcessed).length;
  const visibleRequests = monthRequests.filter((request) => status === 'all' || (status === 'processed' ? isProcessed(request) : request.dates.some((detail) => detail.status === status))).slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const filters = [['all', '全部'], ['pending', '待审核'], ['processed', '已处理'], ['approved', '已批准'], ['rejected', '已拒绝'], ['cancelled', '已取消'], ['revoked', '已撤销']];
  const selectedExtraStatus = filters.slice(3).find(([value]) => value === status);
  const renderStatusFilter = ([value, label]: string[]) => (
    <button type="button" key={value} className={status === value ? 'active' : ''} aria-pressed={status === value} onClick={() => setStatus(value)}>{label} ({value === 'all' ? monthRequests.length : value === 'processed' ? processedCount : monthRequests.filter((r) => r.dates.some((d) => d.status === value)).length})</button>
  );
  return (
    <section className="leave-page wta-page">
      <div className="wta-standard"><div><span>当前标准工作时间</span><strong><Clock3 size={24} /> {formatCurrentStandardWorkTime(standardTime)}</strong></div><div className="wta-actions"><button className="secondary-action" type="button" onClick={loadRequests} disabled={loading}><RefreshCw size={17} />{loading ? '读取中...' : '刷新'}</button><button className="primary-button compact-button wta-create" type="button" onClick={openCreateModal}><Plus size={17} />新增申请</button></div></div>
      {error ? <p className="form-alert">{error}</p> : null}{message ? <p className="form-success">{message}</p> : null}
      <div className="wta-panel"><div className="wta-heading"><h3><FileText size={22} /> 我的申请记录</h3><div className="wta-stats">
        <button type="button" aria-pressed={status === 'all'} onClick={() => setStatus('all')}><CalendarDays size={23} /><span><small>本月申请</small><strong>{monthRequests.length}</strong></span></button>
        <button type="button" aria-pressed={status === 'pending'} onClick={() => setStatus('pending')}><Hourglass size={23} /><span><small>待审核</small><strong>{pendingCount}</strong></span></button>
        <button type="button" aria-pressed={status === 'processed'} onClick={() => setStatus('processed')}><Check size={24} /><span><small>已处理</small><strong>{processedCount}</strong></span></button>
      </div></div>
      <div className="wta-month"><button type="button" aria-label="上个月" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={18} /></button><strong>{month.slice(0, 4)}年{Number(month.slice(5))}月</strong><button type="button" aria-label="下个月" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={18} /></button><button type="button" onClick={() => setMonth(getMalaysiaMonth())}><CalendarDays size={16} /> 返回本月</button></div>
      <div className="wta-filters" aria-label="申请状态筛选">
        <div className="wta-filter-row">{filters.slice(0, 3).map(renderStatusFilter)}<button type="button" className={selectedExtraStatus ? 'wta-more-selected' : ''} aria-expanded={moreStatusesOpen} aria-controls="wta-extra-statuses" onClick={() => setMoreStatusesOpen((open) => !open)}>更多{selectedExtraStatus ? ` · ${selectedExtraStatus[1]}` : ''}<ChevronDown size={16} className={moreStatusesOpen ? 'wta-more-open' : ''} /></button></div>
        <div id="wta-extra-statuses" className="wta-filter-row wta-extra-filters" hidden={!moreStatusesOpen}>{filters.slice(3).map(renderStatusFilter)}</div>
      </div>
      {loading ? <div className="table-state">正在读取工时调整申请...</div> : visibleRequests.length === 0 ? <div className="table-state">该月份和状态暂无工时调整申请。</div> : <div className="wta-list">{visibleRequests.map((request) => <details className="wta-record" key={request.id}><summary><span className="wta-date"><CalendarDays size={19} /><strong>{formatDateRange(request.requested_start_date, request.requested_end_date)}</strong></span><span><small>原标准工作时间</small><strong>{formatTime(request.original_start_work_time)} 至 {formatTime(request.original_end_work_time)}</strong></span><span className="wta-adjusted"><small>申请调整后</small><strong>{formatRequestAdjustmentSummary(request)}</strong></span><span className="wta-reason"><small>申请原因</small><strong>{request.reason}</strong></span><span className="wta-badges">{request.dates.length ? [...new Set(request.dates.map((d) => d.status))].map((item) => <em key={item} className={`wta-status wta-status-${item}`}>{workTimeAdjustmentStatusLabels[item]}</em>) : '暂无明细'}</span><span className="wta-expand" aria-hidden="true"><ChevronDown size={20} /></span></summary><div className="wta-details"><p>申请时间：{formatDateTime(request.created_at)}</p><p>申请原因：{request.reason}</p>{request.attachment_path ? <button className="text-link-button" type="button" onClick={() => handleOpenAttachment(request)} disabled={openingAttachmentPath === request.attachment_path}><FileText size={15} />{openingAttachmentPath === request.attachment_path ? '读取附件中...' : '查看附件'}</button> : <p>附件：未上传</p>}
                <div className="staff-table-wrap">
                  <table className="staff-table">
                    <thead>
                      <tr>
                        <th>日期</th>
                        <th>原标准工作时间</th>
                        <th>调整后工作时间</th>
                        <th>状态</th>
                        <th>审核备注</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {request.dates.length === 0 ? (
                        <tr>
                          <td colSpan={6}>暂无日期明细。</td>
                        </tr>
                      ) : (
                        request.dates.map((detail) => (
                          <tr key={detail.id}>
                            <td>{formatDate(detail.work_date)}</td>
                            <td>
                              {formatTime(detail.original_start_work_time)} 至 {formatTime(detail.original_end_work_time)}
                            </td>
                            <td>
                              {detail.status === 'pending' ? (
                                <div className="row-actions">
                                  <select
                                    ref={(element) => {
                                      editTimeSelectRefs.current[detail.id] = element;
                                    }}
                                    value={editTimes[detail.id] ?? detail.adjusted_start_time.slice(0, 5)}
                                    onChange={(event) =>
                                      setEditTimes((current) => ({ ...current, [detail.id]: event.target.value }))
                                    }
                                    disabled={updatingDetailId === detail.id}
                                  >
                                    {timeOptions.map((time) => (
                                      <option key={time} value={time}>
                                        {time}
                                      </option>
                                    ))}
                                  </select>
                                  <span>
                                    至 {formatAdjustedEndTimePreview(editTimes[detail.id] ?? detail.adjusted_start_time.slice(0, 5))}
                                  </span>
                                </div>
                              ) : (
                                `${formatTime(detail.adjusted_start_time)} 至 ${formatTime(detail.adjusted_end_time)}`
                              )}
                            </td>
                            <td>
                              <span className={`status-pill work-time-adjustment-status-${detail.status}`}>
                                {workTimeAdjustmentStatusLabels[detail.status]}
                              </span>
                            </td>
                            <td>{formatDetailNote(detail)}</td>
                            <td>
                              {detail.status === 'pending' ? (
                                <div className="row-actions">
                                  <button
                                    className="secondary-button compact-button"
                                    type="button"
                                    onClick={() => handleUpdateDate(detail)}
                                    disabled={updatingDetailId === detail.id}
                                  >
                                    <Clock3 size={15} />
                                    <span>{updatingDetailId === detail.id ? '处理中...' : '更新时间'}</span>
                                  </button>
                                  <button
                                    className="secondary-button compact-button danger-text-button"
                                    type="button"
                                    onClick={() => handleCancelDate(detail)}
                                    disabled={updatingDetailId === detail.id}
                                  >
                                    <XCircle size={15} />
                                    <span>{updatingDetailId === detail.id ? '处理中...' : '取消申请'}</span>
                                  </button>
                                </div>
                              ) : (
                                '不可操作'
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
      </div></details>)}</div>}</div>

      {formOpen ? (
        <SystemModal
          title="新增工时调整申请"
          subtitle="工时调整申请"
          ariaLabel="新增工时调整申请"
          wide={false}
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <button className="secondary-button compact-button" type="button" onClick={() => setFormOpen(false)} disabled={saving}>
                关闭
              </button>
              <button className="primary-button compact-button" type="submit" form="work-time-adjustment-form" disabled={saving}>
                <Plus size={18} />
                <span>{saving ? '提交中...' : '提交申请'}</span>
              </button>
            </>
          }
        >
          <form id="work-time-adjustment-form" onSubmit={handleSubmit}>
            <div className="form-grid single">
              <label className="form-field">
                <span>调整开始日期</span>
                <input
                  type="date"
                  min={tomorrow}
                  value={formValues.startDate}
                  onChange={(event) =>
                    setFormValues((current) => ({
                      ...current,
                      startDate: event.target.value,
                      endDate: current.endDate && current.endDate >= event.target.value ? current.endDate : event.target.value,
                    }))
                  }
                  required
                />
              </label>

              <label className="form-field">
                <span>调整结束日期</span>
                <input
                  type="date"
                  min={formValues.startDate || tomorrow}
                  value={formValues.endDate}
                  onChange={(event) => setFormValues((current) => ({ ...current, endDate: event.target.value }))}
                  required
                />
              </label>

              <label className="form-field">
                <span>调整后上班时间</span>
                <select
                  value={formValues.adjustedStartTime}
                  onChange={(event) => setFormValues((current) => ({ ...current, adjustedStartTime: event.target.value }))}
                  required
                >
                  {timeOptions.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </label>

              <div className="form-field">
                <span>调整后下班时间</span>
                <div className="location-preview">
                  <strong>{adjustedEndTimePreview}</strong>
                  <span className="muted-text">下班时间根据 8 小时 30 分钟规则预览，最终以数据库计算结果为准。</span>
                </div>
              </div>

              <label className="form-field">
                <span>调整原因</span>
                <textarea
                  value={formValues.reason}
                  onChange={(event) => setFormValues((current) => ({ ...current, reason: event.target.value }))}
                  placeholder="请填写需要调整工作时间的原因"
                  required
                />
              </label>

              <div className="form-field">
                <span>附件（可选）</span>
                <label className="secondary-action attachment-upload-action">
                  {selectedAttachment ? '重新选择附件' : '选择附件'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    disabled={saving}
                    onChange={(event) => setSelectedAttachment(event.target.files?.[0] ?? null)}
                  />
                </label>
                {selectedAttachment ? (
                  <p className="form-helper">已选择：{selectedAttachment.name}</p>
                ) : (
                  <p className="form-helper">支持 JPG、JPEG、PNG 或 PDF，最大 5MB。附件会上传到私有储存空间。</p>
                )}
              </div>

              <p className="form-helper">申请日期需至少提前 1 天提交，系统会以数据库规则作为最终判断。</p>
            </div>

            {error ? <p className="form-alert">{error}</p> : null}
            {message ? <p className="form-success">{message}</p> : null}
          </form>
        </SystemModal>
      ) : null}
    </section>
  );
}

function createEditTimeState(requests: WorkTimeAdjustmentRequestItem[]) {
  return requests.reduce<Record<string, string>>((state, request) => {
    request.dates.forEach((detail) => {
      state[detail.id] = detail.adjusted_start_time.slice(0, 5);
    });
    return state;
  }, {});
}

function createTimeOptions() {
  const options: string[] = [];

  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
    const minute = String(minutes % 60).padStart(2, '0');
    options.push(`${hour}:${minute}`);
  }

  return options;
}

function formatAdjustedEndTimePreview(startTime: string) {
  const [hourText, minuteText] = startTime.split(':');
  const startMinutes = Number(hourText) * 60 + Number(minuteText);

  if (!Number.isFinite(startMinutes)) {
    return '-';
  }

  const endMinutes = startMinutes + 8 * 60 + 30;
  const dayOffset = Math.floor(endMinutes / (24 * 60));
  const normalizedMinutes = endMinutes % (24 * 60);
  const hour = String(Math.floor(normalizedMinutes / 60)).padStart(2, '0');
  const minute = String(normalizedMinutes % 60).padStart(2, '0');

  return `${dayOffset > 0 ? '次日 ' : ''}${hour}:${minute}`;
}

function formatRequestAdjustmentSummary(request: WorkTimeAdjustmentRequestItem) {
  if (request.dates.length === 1) {
    const [detail] = request.dates;
    return `${formatTime(detail.adjusted_start_time)} 至 ${formatTime(detail.adjusted_end_time)}`;
  }

  if (request.dates.length > 1) {
    return '调整后工作时间以每日明细为准';
  }

  return '暂无日期明细';
}

function formatDateRange(startDate: string, endDate: string) {
  if (startDate === endDate) {
    return formatDate(startDate);
  }

  return `${formatDate(startDate)} 至 ${formatDate(endDate)}`;
}

function formatDetailNote(detail: WorkTimeAdjustmentRequestDate) {
  if (detail.status === 'revoked') {
    return `撤销原因：${detail.revoke_note || '-'}`;
  }

  return detail.review_note || '-';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(`${value}T00:00:00`));
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

function formatTime(value: string) {
  return value.slice(0, 5);
}

function formatCurrentStandardWorkTime(
  workTime: Pick<import('../types/database').Employee, 'start_work_time' | 'end_work_time'> | null,
) {
  if (!workTime?.start_work_time || !workTime.end_work_time) {
    return '当前标准工作时间不可用';
  }

  return `${formatTime(workTime.start_work_time)} 至 ${formatTime(workTime.end_work_time)}`;
}

function getTomorrowDateKey() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
function malaysiaMonthOf(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit' }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}
function getMalaysiaMonth() { return malaysiaMonthOf(new Date().toISOString()); }
function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
