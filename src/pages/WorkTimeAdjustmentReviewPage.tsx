import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import {
  type WorkTimeAdjustmentReviewDetail,
  type WorkTimeAdjustmentReviewDecision,
  type WorkTimeAdjustmentReviewStatusFilter,
  workTimeAdjustmentService,
  workTimeAdjustmentStatusLabels,
} from '../services/work-time-adjustment.service';

const statusFilterOptions: Array<{ value: WorkTimeAdjustmentReviewStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'cancelled', label: '已取消' },
  { value: 'revoked', label: '已撤销' },
];

type ReviewModalState = {
  detail: WorkTimeAdjustmentReviewDetail;
  status: WorkTimeAdjustmentReviewDecision;
};

export function WorkTimeAdjustmentReviewPage() {
  const [details, setDetails] = useState<WorkTimeAdjustmentReviewDetail[]>([]);
  const [statusFilter, setStatusFilter] = useState<WorkTimeAdjustmentReviewStatusFilter>('pending');
  const [selectedReview, setSelectedReview] = useState<ReviewModalState | null>(null);
  const [selectedRevoke, setSelectedRevoke] = useState<WorkTimeAdjustmentReviewDetail | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [revokeNote, setRevokeNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void loadDetails();
  }, [statusFilter]);

  usePullToRefresh(loadDetails, [statusFilter]);

  async function loadDetails() {
    setLoading(true);
    setError('');

    try {
      const reviewDetails = await workTimeAdjustmentService.listReviewDetails(statusFilter);
      setDetails(reviewDetails);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取工时调整审核列表失败。');
    } finally {
      setLoading(false);
    }
  }

  function openReview(detail: WorkTimeAdjustmentReviewDetail, status: WorkTimeAdjustmentReviewDecision) {
    setSelectedReview({ detail, status });
    setReviewNote('');
    setError('');
    setMessage('');
  }

  function openRevoke(detail: WorkTimeAdjustmentReviewDetail) {
    setSelectedRevoke(detail);
    setRevokeNote('');
    setError('');
    setMessage('');
  }

  async function handleSubmitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedReview || submitting) {
      return;
    }

    if (selectedReview.status === 'rejected' && !reviewNote.trim()) {
      setError('请填写拒绝原因。');
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      await workTimeAdjustmentService.reviewDate(selectedReview.detail.id, selectedReview.status, reviewNote);
      setMessage(selectedReview.status === 'approved' ? '工时调整申请已通过。' : '工时调整申请已拒绝。');
      setSelectedReview(null);
      setReviewNote('');
      await loadDetails();
    } catch (reviewError) {
      console.error('工时调整审核失败', reviewError);
      setError(reviewError instanceof Error ? `工时调整审核失败：${reviewError.message}` : '工时调整审核失败。');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitRevoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedRevoke || submitting) {
      return;
    }

    const trimmedNote = revokeNote.trim();
    if (!trimmedNote) {
      setError('请填写撤销原因。');
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      await workTimeAdjustmentService.revokeApprovedDate(selectedRevoke.id, trimmedNote);
      setMessage('工时调整申请已撤销通过。');
      setSelectedRevoke(null);
      setRevokeNote('');
      await loadDetails();
    } catch (revokeError) {
      console.error('工时调整撤销失败', revokeError);
      setError(revokeError instanceof Error ? `工时调整撤销失败：${revokeError.message}` : '工时调整撤销失败。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="leave-page">
      <div className="staff-toolbar">
        <div className="page-heading">
          <span>人事部</span>
          <h2>工时调整审核</h2>
          <p>用于查看员工提交的工时调整申请明细。</p>
        </div>

        <div className="row-actions">
          <label className="form-field compact-field">
            <span>状态筛选</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as WorkTimeAdjustmentReviewStatusFilter)}
              disabled={loading}
            >
              {statusFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-action" type="button" onClick={loadDetails} disabled={loading}>
            <RefreshCw size={17} />
            <span>{loading ? '读取中...' : '刷新'}</span>
          </button>
        </div>
      </div>

      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <div className="staff-list-panel">
        <div className="list-header">
          <div>
            <span>审核明细</span>
            <h3>{details.length} 条记录</h3>
          </div>
        </div>

        {loading ? (
          <div className="table-state">正在读取工时调整审核列表...</div>
        ) : details.length === 0 ? (
          <div className="table-state">暂无符合条件的工时调整申请。</div>
        ) : (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>员工姓名</th>
                  <th>员工编号</th>
                  <th>申请日期</th>
                  <th>原工作时间</th>
                  <th>调整后工作时间</th>
                  <th>申请原因</th>
                  <th>状态</th>
                  <th>审核 / 撤销备注</th>
                  <th>申请时间</th>
                  <th>附件</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {details.map((detail) => (
                  <tr key={detail.id}>
                    <td>{detail.employee?.full_name ?? '未取得员工姓名'}</td>
                    <td>{detail.employee?.employee_code ?? '未取得'}</td>
                    <td>{formatDate(detail.work_date)}</td>
                    <td>
                      {formatTime(detail.original_start_work_time)} 至 {formatTime(detail.original_end_work_time)}
                    </td>
                    <td>
                      {formatTime(detail.adjusted_start_time)} 至 {formatTime(detail.adjusted_end_time)}
                    </td>
                    <td>{detail.request?.reason ?? '未取得申请原因'}</td>
                    <td>
                      <span className={`status-pill work-time-adjustment-status-${detail.status}`}>
                        {workTimeAdjustmentStatusLabels[detail.status]}
                      </span>
                    </td>
                    <td>{formatReviewNote(detail)}</td>
                    <td>{detail.request ? formatDateTime(detail.request.created_at) : '未取得'}</td>
                    <td>{detail.request?.attachment_path ? '有附件' : '无附件'}</td>
                    <td>
                      {detail.status === 'pending' ? (
                        <div className="row-actions">
                          <button
                            className="primary-button compact-button"
                            type="button"
                            onClick={() => openReview(detail, 'approved')}
                          >
                            <CheckCircle2 size={15} />
                            <span>通过</span>
                          </button>
                          <button
                            className="secondary-button compact-button danger-text-button"
                            type="button"
                            onClick={() => openReview(detail, 'rejected')}
                          >
                            <XCircle size={15} />
                            <span>拒绝</span>
                          </button>
                        </div>
                      ) : detail.status === 'approved' ? (
                        <button
                          className="secondary-button compact-button danger-text-button"
                          type="button"
                          onClick={() => openRevoke(detail)}
                        >
                          <RotateCcw size={15} />
                          <span>撤销通过</span>
                        </button>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedReview ? (
        <SystemModal
          title={selectedReview.status === 'approved' ? '确认通过工时调整申请' : '确认拒绝工时调整申请'}
          subtitle="工时调整审核"
          ariaLabel={selectedReview.status === 'approved' ? '确认通过工时调整申请' : '确认拒绝工时调整申请'}
          wide={false}
          onClose={() => setSelectedReview(null)}
          footer={
            <>
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={() => setSelectedReview(null)}
                disabled={submitting}
              >
                取消
              </button>
              <button
                className={
                  selectedReview.status === 'approved'
                    ? 'primary-button compact-button'
                    : 'secondary-button compact-button danger-text-button'
                }
                type="submit"
                form="work-time-adjustment-review-form"
                disabled={submitting}
              >
                {selectedReview.status === 'approved' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                <span>
                  {submitting
                    ? '处理中...'
                    : selectedReview.status === 'approved'
                      ? '确认通过'
                      : '确认拒绝'}
                </span>
              </button>
            </>
          }
        >
          <form id="work-time-adjustment-review-form" onSubmit={handleSubmitReview}>
            <div className="detail-list">
              <div>
                <span>员工</span>
                <strong>{selectedReview.detail.employee?.full_name ?? '未取得员工姓名'}</strong>
              </div>
              <div>
                <span>申请日期</span>
                <strong>{formatDate(selectedReview.detail.work_date)}</strong>
              </div>
              <div>
                <span>调整后工作时间</span>
                <strong>
                  {formatTime(selectedReview.detail.adjusted_start_time)} 至 {formatTime(selectedReview.detail.adjusted_end_time)}
                </strong>
              </div>
            </div>

            <label className="form-field">
              <span>{selectedReview.status === 'approved' ? '审核备注' : '拒绝原因'}</span>
              <textarea
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                placeholder={selectedReview.status === 'approved' ? '可填写审核备注' : '请填写拒绝原因'}
                required={selectedReview.status === 'rejected'}
              />
            </label>

            {error ? <p className="form-alert">{error}</p> : null}
          </form>
        </SystemModal>
      ) : null}

      {selectedRevoke ? (
        <SystemModal
          title="撤销已通过的工时调整"
          subtitle="工时调整审核"
          ariaLabel="撤销已通过的工时调整"
          wide={false}
          onClose={() => setSelectedRevoke(null)}
          footer={
            <>
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={() => setSelectedRevoke(null)}
                disabled={submitting}
              >
                取消
              </button>
              <button
                className="secondary-button compact-button danger-text-button"
                type="submit"
                form="work-time-adjustment-revoke-form"
                disabled={submitting}
              >
                <RotateCcw size={18} />
                <span>{submitting ? '处理中...' : '确认撤销'}</span>
              </button>
            </>
          }
        >
          <form id="work-time-adjustment-revoke-form" onSubmit={handleSubmitRevoke}>
            <div className="detail-list">
              <div>
                <span>员工姓名</span>
                <strong>{selectedRevoke.employee?.full_name ?? '未取得员工姓名'}</strong>
              </div>
              <div>
                <span>申请日期</span>
                <strong>{formatDate(selectedRevoke.work_date)}</strong>
              </div>
              <div>
                <span>调整后工作时间</span>
                <strong>
                  {formatTime(selectedRevoke.adjusted_start_time)} 至 {formatTime(selectedRevoke.adjusted_end_time)}
                </strong>
              </div>
            </div>

            <label className="form-field">
              <span>撤销原因</span>
              <textarea
                value={revokeNote}
                onChange={(event) => setRevokeNote(event.target.value)}
                placeholder="请输入撤销原因"
                required
              />
            </label>

            {error ? <p className="form-alert">{error}</p> : null}
          </form>
        </SystemModal>
      ) : null}
    </section>
  );
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

function formatReviewNote(detail: WorkTimeAdjustmentReviewDetail) {
  if (detail.status === 'revoked') {
    return detail.revoke_note || '-';
  }

  if (detail.status === 'approved' || detail.status === 'rejected') {
    return detail.review_note || '-';
  }

  return '-';
}

function formatTime(value: string) {
  return value.slice(0, 5);
}
