import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Clock3, FileText, Plus, RefreshCw, XCircle } from 'lucide-react';
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

  return (
    <section className="leave-page">
      <div className="staff-toolbar">
        <div className="page-heading">
          <span>员工申请</span>
          <h2>工时调整申请</h2>
          <p>员工如因工作或临时安排需要调整当天工作时间，可提前提交申请。</p>
        </div>

        <div className="row-actions">
          <button className="secondary-action" type="button" onClick={loadRequests} disabled={loading}>
            <RefreshCw size={17} />
            <span>{loading ? '读取中...' : '刷新'}</span>
          </button>
          <button className="primary-button compact-button" type="button" onClick={openCreateModal}>
            <Plus size={17} />
            <span>新增申请</span>
          </button>
        </div>
      </div>

      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <div className="staff-list-panel">
        <div className="list-header">
          <div>
            <span>我的申请记录</span>
            <h3>{requests.length} 条申请</h3>
          </div>
        </div>

        {loading ? (
          <div className="table-state">正在读取工时调整申请...</div>
        ) : requests.length === 0 ? (
          <div className="table-state">暂无工时调整申请。</div>
        ) : (
          <div className="registration-list">
            {requests.map((request) => (
              <article className="registration-item" key={request.id}>
                <span>
                  <strong>{formatDateRange(request.requested_start_date, request.requested_end_date)}</strong>
                  <small>
                    原工作时间 {formatTime(request.original_start_work_time)} 至 {formatTime(request.original_end_work_time)} ·{' '}
                    {formatRequestAdjustmentSummary(request)}
                  </small>
                  <small>申请原因：{request.reason}</small>
                  <small>申请时间：{formatDateTime(request.created_at)}</small>
                  {request.attachment_path ? (
                    <button
                      className="text-link-button"
                      type="button"
                      onClick={() => handleOpenAttachment(request)}
                      disabled={openingAttachmentPath === request.attachment_path}
                    >
                      <FileText size={15} />
                      <span>{openingAttachmentPath === request.attachment_path ? '读取附件中...' : '查看附件'}</span>
                    </button>
                  ) : (
                    <small>附件：未上传</small>
                  )}
                </span>
                <em>{summarizeRequestStatus(request.dates)}</em>

                <div className="staff-table-wrap">
                  <table className="staff-table">
                    <thead>
                      <tr>
                        <th>日期</th>
                        <th>原工作时间</th>
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
                            <td>{detail.review_note || detail.revoke_note || '-'}</td>
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
              </article>
            ))}
          </div>
        )}
      </div>

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

function summarizeRequestStatus(dates: WorkTimeAdjustmentRequestDate[]) {
  if (dates.length === 0) {
    return '暂无明细';
  }

  const pendingCount = dates.filter((detail) => detail.status === 'pending').length;
  if (pendingCount > 0) {
    return `${pendingCount} 天待审核`;
  }

  const approvedCount = dates.filter((detail) => detail.status === 'approved').length;
  if (approvedCount === dates.length) {
    return '全部已通过';
  }

  return '已处理';
}

function formatRequestAdjustmentSummary(request: WorkTimeAdjustmentRequestItem) {
  if (request.dates.length === 1) {
    const [detail] = request.dates;
    return `当前调整后 ${formatTime(detail.adjusted_start_time)} 至 ${formatTime(detail.adjusted_end_time)}`;
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
