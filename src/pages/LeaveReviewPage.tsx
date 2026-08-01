import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import { usePermissions } from '../hooks/usePermissions';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { type LeaveRequestItem, leaveService } from '../services/leave.service';
import { leaveStatusLabels, leaveTypeLabels } from './LeavePage';

export function LeaveReviewPage() {
  const permissions = usePermissions();
  const canUseLeaveReview = permissions.canUse('leave-review');
  const [requests, setRequests] = useState<LeaveRequestItem[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequestItem | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void loadPendingRequests();
  }, []);

  usePullToRefresh(loadPendingRequests);

  async function loadPendingRequests() {
    setLoading(true);
    setError('');

    try {
      const pendingRequests = await leaveService.listPendingLeaveRequests();
      setRequests(pendingRequests);
      setSelectedRequest((current) =>
        current && pendingRequests.some((request) => request.id === current.id) ? current : null,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取请假审核列表失败。');
    } finally {
      setLoading(false);
    }
  }

  function openReview(request: LeaveRequestItem) {
    setSelectedRequest(request);
    setReviewNote('');
    setError('');
    setMessage('');
  }

  async function handleApprove() {
    if (!selectedRequest) {
      return;
    }
    if (!canUseLeaveReview) {
      setError('没有审核操作权限。');
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      await leaveService.approveLeaveRequest(selectedRequest.id);
      setMessage('请假申请已通过。');
      setSelectedRequest(null);
      setReviewNote('');
      await loadPendingRequests();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : '审核通过失败。');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedRequest) {
      return;
    }
    if (!canUseLeaveReview) {
      setError('没有审核操作权限。');
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      await leaveService.rejectLeaveRequest(selectedRequest.id, reviewNote);
      setMessage('请假申请已拒绝。');
      setSelectedRequest(null);
      setReviewNote('');
      await loadPendingRequests();
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : '审核拒绝失败。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="review-page">
      {error && !selectedRequest ? <p className="form-alert">{error}</p> : null}
      {message && !selectedRequest ? <p className="form-success">{message}</p> : null}

      <div className="staff-list-panel">
        <div className="list-header">
          <div>
            <span>待审核列表</span>
            <h3>{requests.length} 条申请</h3>
          </div>
        </div>

        {loading ? (
          <div className="table-state">正在读取请假申请...</div>
        ) : requests.length === 0 ? (
          <div className="table-state">暂无待审核请假申请。</div>
        ) : (
          <div className="registration-list">
            {requests.map((request) => (
              <button key={request.id} className="registration-item" type="button" onClick={() => openReview(request)}>
                <span>
                  <strong>{request.employee?.full_name ?? '未关联员工'}</strong>
                  <small>
                    {leaveTypeLabels[request.leave_type]} · {formatLeaveDate(request)}
                  </small>
                </span>
                <em>{leaveStatusLabels[request.status]}</em>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedRequest ? (
        <SystemModal
          title={selectedRequest.employee?.full_name ?? '未关联员工'}
          subtitle="审核详情"
          ariaLabel="请假审核详情"
          onClose={() => setSelectedRequest(null)}
          footer={
            <>
              <button className="secondary-button compact-button" type="button" onClick={() => setSelectedRequest(null)}>
                关闭
              </button>
              {canUseLeaveReview ? (
                <>
                  <button className="primary-button compact-button" type="button" onClick={handleApprove} disabled={submitting}>
                    <CheckCircle2 size={18} />
                    <span>{submitting ? '处理中...' : '审核通过'}</span>
                  </button>
                  <button className="secondary-button compact-button danger-text-button" type="submit" form="leave-reject-form" disabled={submitting}>
                    <XCircle size={18} />
                    <span>{submitting ? '处理中...' : '审核拒绝'}</span>
                  </button>
                </>
              ) : null}
            </>
          }
        >
            <section className="employee-detail-section">
              <h4>基础资料</h4>
              <div className="detail-list">
              <div>
                <span>员工</span>
                <strong>{selectedRequest.employee?.full_name ?? '未关联员工'}</strong>
              </div>
              </div>
            </section>

            <section className="employee-detail-section">
              <h4>工作资料</h4>
              <div className="detail-list">
              <div>
                <span>假期类型</span>
                <strong>{leaveTypeLabels[selectedRequest.leave_type]}</strong>
              </div>
              <div>
                <span>{selectedRequest.leave_type === 'replacement' ? '调休日期' : '日期'}</span>
                <strong>{formatLeaveDate(selectedRequest)}</strong>
              </div>
              <div>
                <span>原因</span>
                <strong>{selectedRequest.reason}</strong>
              </div>
              </div>
            </section>

            <section className="employee-detail-section">
              <h4>薪资资料</h4>
              <div className="detail-list">
                <div>
                  <span>薪资影响</span>
                  <strong>{selectedRequest.leave_type === 'unpaid' ? '无薪假' : '无'}</strong>
                </div>
              </div>
            </section>

            <section className="employee-detail-section">
              <h4>班次资料</h4>
              <div className="detail-list">
                <div>
                  <span>申请日期</span>
                  <strong>{formatLeaveDate(selectedRequest)}</strong>
                </div>
              </div>
            </section>

            <section className="employee-detail-section">
              <h4>附件资料</h4>
              <div className="detail-list">
                {selectedRequest.leave_type === 'medical' ? (
                  <div>
                    <span>病假证明</span>
                    {selectedRequest.medical_attachment_url ? (
                      <a className="medical-proof-link" href={selectedRequest.medical_attachment_url} target="_blank" rel="noreferrer">
                        <img src={selectedRequest.medical_attachment_url} alt="病假证明" />
                        <strong>打开原图</strong>
                      </a>
                    ) : (
                      <strong>未上传</strong>
                    )}
                  </div>
                ) : (
                  <div>
                    <span>病假证明</span>
                    <strong>无需上传</strong>
                  </div>
                )}
              </div>
            </section>

            {error ? <p className="form-alert">{error}</p> : null}
            {message ? <p className="form-success">{message}</p> : null}

            <form id="leave-reject-form" className="reject-form" onSubmit={handleReject}>
              <label className="form-field">
                <span>拒绝原因</span>
                <textarea
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  placeholder="请输入拒绝原因"
                  required
                />
              </label>
            </form>
        </SystemModal>
      ) : null}
    </section>
  );
}

function formatLeaveDate(request: LeaveRequestItem) {
  if (request.leave_type === 'replacement') {
    return `补班日期 ${request.start_date}，调休日期 ${request.end_date}`;
  }

  return `${request.start_date} 至 ${request.end_date}`;
}
