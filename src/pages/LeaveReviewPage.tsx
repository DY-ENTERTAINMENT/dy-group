import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import { usePermissions } from '../hooks/usePermissions';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { notifyLeavePendingApprovalsChanged } from '../hooks/useLeavePendingApprovalCount';
import { type LeaveRequestItem, type LeaveReviewHistoryItem, leaveService } from '../services/leave.service';
import { leaveStatusLabels, leaveTypeLabels } from './LeavePage';
import { replacementReviewHistoryRecordTypeLabels, replacementWorkChangeLabels, replacementWorkChangeService, type ReplacementWorkChangeReviewItem, type ReplacementWorkChangeReviewHistoryItem } from '../services/replacement-work-change.service';
import { leaveBalanceManagementService } from '../services/leave-balance-management.service';
import type { Region } from '../types/database';

type PendingReviewCounts = { leave: number; replacement: number };

export function LeaveReviewPage({ initialSection, embedded = false, onPendingCountsChange }: { initialSection?: 'leave' | 'replacement'; embedded?: boolean; onPendingCountsChange?: (counts: PendingReviewCounts) => void }) {
  const permissions = usePermissions();
  const canUseLeaveReview = permissions.canUse('leave-review');
  const [requests, setRequests] = useState<LeaveRequestItem[]>([]);
  const [replacementChanges, setReplacementChanges] = useState<ReplacementWorkChangeReviewItem[]>([]);
  const [selectedReplacementChange, setSelectedReplacementChange] = useState<ReplacementWorkChangeReviewItem | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequestItem | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('all');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [view, setView] = useState<'pending' | 'history'>('pending');
  const [historyYear, setHistoryYear] = useState(new Date().getFullYear());
  const [historyMonth, setHistoryMonth] = useState(new Date().getMonth() + 1);
  const [historyType, setHistoryType] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');
  const [historyRegionId, setHistoryRegionId] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [regions, setRegions] = useState<Region[]>([]);
  const [leaveHistory, setLeaveHistory] = useState<LeaveReviewHistoryItem[]>([]);
  const [replacementHistory, setReplacementHistory] = useState<ReplacementWorkChangeReviewHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [selectedHistory, setSelectedHistory] = useState<LeaveReviewHistoryItem | ReplacementWorkChangeReviewHistoryItem | null>(null);
  const [historyFilterSection, setHistoryFilterSection] = useState(initialSection);
  const historyRequestId = useRef(0);
  const pendingCountsChangeRef = useRef(onPendingCountsChange);
  const ordinaryLeaveRequests = useMemo(
    () => requests.filter((request) => request.leave_type === 'annual' || request.leave_type === 'medical' || request.leave_type === 'unpaid'),
    [requests],
  );
  const replacementLeaveRequests = useMemo(
    () => requests.filter((request) => request.leave_type === 'replacement'),
    [requests],
  );
  const leaveRequests = useMemo(() => ordinaryLeaveRequests.filter((request) => {
    const search = employeeSearch.trim().toLowerCase();
    return (leaveTypeFilter === 'all' || request.leave_type === leaveTypeFilter)
      && (!search || `${request.employee?.full_name ?? ''} ${request.employee?.employee_code ?? ''}`.toLowerCase().includes(search));
  }), [employeeSearch, leaveTypeFilter, ordinaryLeaveRequests]);
  const filteredReplacementLeaveRequests = useMemo(() => replacementLeaveRequests.filter((request) => {
    const search = employeeSearch.trim().toLowerCase();
    return !search || `${request.employee?.full_name ?? ''} ${request.employee?.employee_code ?? ''}`.toLowerCase().includes(search);
  }), [employeeSearch, replacementLeaveRequests]);
  const filteredReplacementChanges = useMemo(() => replacementChanges.filter((change) => {
    const search = employeeSearch.trim().toLowerCase();
    return !search || `${change.employee?.full_name ?? ''} ${change.employee?.employee_code ?? ''}`.toLowerCase().includes(search);
  }), [employeeSearch, replacementChanges]);

  useEffect(() => {
    void loadPendingRequests();
  }, []);

  useEffect(() => { void leaveBalanceManagementService.listAuthorizedRegions().then(setRegions).catch(() => setRegions([])); }, []);

  useEffect(() => {
    pendingCountsChangeRef.current = onPendingCountsChange;
  }, [onPendingCountsChange]);

  useEffect(() => {
    historyRequestId.current += 1;
    setHistoryType('');
    setHistoryStatus('');
    setHistoryRegionId('');
    setHistorySearch('');
    setHistoryPage(1);
    setHistoryError('');
    setHistoryLoading(false);
    setLeaveHistory([]);
    setReplacementHistory([]);
    setSelectedHistory(null);
    setHistoryFilterSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (view !== 'history') return;
    if (historyFilterSection !== initialSection) return;
    void loadHistory();
  }, [view, initialSection, historyFilterSection, historyYear, historyMonth, historyType, historyStatus, historyRegionId, historySearch, historyPage]);

  usePullToRefresh(loadPendingRequests);

  async function loadPendingRequests() {
    setLoading(true);
    setError('');

    try {
      const [pendingRequests, pendingChanges] = await Promise.all([leaveService.listPendingLeaveRequests(), replacementWorkChangeService.listPending()]);
      setRequests(pendingRequests);
      setReplacementChanges(pendingChanges);
      pendingCountsChangeRef.current?.({
        leave: pendingRequests.filter((request) => request.leave_type === 'annual' || request.leave_type === 'medical' || request.leave_type === 'unpaid').length,
        replacement: pendingRequests.filter((request) => request.leave_type === 'replacement').length + pendingChanges.length,
      });
      notifyLeavePendingApprovalsChanged();
      setSelectedRequest((current) =>
        current && pendingRequests.some((request) => request.id === current.id) ? current : null,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取请假审核列表失败。');
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    const requestId = ++historyRequestId.current;
    setHistoryLoading(true); setHistoryError('');
    try {
      if (initialSection === 'replacement') {
        const rows = await replacementWorkChangeService.listReviewHistory({ year: historyYear, month: historyMonth, changeType: historyType, status: historyStatus, regionId: historyRegionId, search: historySearch, page: historyPage, pageSize: 25 });
        if (requestId === historyRequestId.current) setReplacementHistory(rows);
      } else {
        const rows = await leaveService.listReviewHistory({ year: historyYear, month: historyMonth, leaveType: historyType, status: historyStatus, regionId: historyRegionId, search: historySearch, page: historyPage, pageSize: 25 });
        if (requestId === historyRequestId.current) setLeaveHistory(rows);
      }
    } catch (historyLoadError) {
      if (requestId === historyRequestId.current) setHistoryError(historyLoadError instanceof Error ? historyLoadError.message : '审批历史暂时不可用。');
    } finally {
      if (requestId === historyRequestId.current) setHistoryLoading(false);
    }
  }

  async function reviewReplacementChange(status: 'approved' | 'rejected') {
    if (!selectedReplacementChange) return;
    if (status === 'rejected' && !reviewNote.trim()) { setError('请填写拒绝原因。'); return; }
    setSubmitting(true); setError('');
    try { await replacementWorkChangeService.review(selectedReplacementChange.id, status, reviewNote); setSelectedReplacementChange(null); setReviewNote(''); setMessage('调休补班变更申请已处理。'); await loadPendingRequests(); }
    catch (reviewError) { setError(reviewError instanceof Error ? reviewError.message : '审核失败。'); }
    finally { setSubmitting(false); }
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
    <section className={embedded ? 'review-page holiday-review-page' : 'review-page'}>
      {error && !selectedRequest ? <p className="form-alert">{error}</p> : null}
      {message && !selectedRequest ? <p className="form-success">{message}</p> : null}

      <div className="holiday-review-view-switcher" role="tablist" aria-label="审批记录视图"><button className={view === 'pending' ? 'active' : ''} type="button" onClick={() => setView('pending')}>待审批</button><button className={view === 'history' ? 'active' : ''} type="button" onClick={() => setView('history')}>审批历史</button></div>

      {view === 'pending' && initialSection !== 'replacement' ? <div className="staff-list-panel">
        <div className="list-header">
          <div>
            <span>待审批</span>
            <h3>{ordinaryLeaveRequests.length} 条请假申请</h3>
          </div>
        </div>

        <div className="holiday-review-filters">
          <input type="search" value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="搜索员工姓名或工号" aria-label="员工搜索" />
        </div>

        <div className="leave-type-quick-filters" role="group" aria-label="请假类型快捷筛选">
          <button className={leaveTypeFilter === 'all' ? 'active' : ''} type="button" onClick={() => setLeaveTypeFilter('all')}>全部类型</button>
          {(['annual', 'medical', 'unpaid'] as const).map((type) => (
            <button key={type} className={leaveTypeFilter === type ? 'active' : ''} type="button" onClick={() => setLeaveTypeFilter(type)}>{leaveTypeLabels[type]}</button>
          ))}
        </div>

        {loading ? (
          <div className="table-state">正在读取请假申请...</div>
        ) : leaveRequests.length === 0 ? (
          <div className="table-state">暂无待审核请假申请。</div>
        ) : (
          <div className="registration-list">
            {leaveRequests.map((request) => (
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
      </div> : null}

      {view === 'pending' && initialSection !== 'leave' ? <div className="staff-list-panel">
        <div className="list-header"><div><span>待审批</span><h3>{replacementLeaveRequests.length + replacementChanges.length} 条调休申请</h3></div></div>
        <div className="holiday-review-filters"><input type="search" value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="搜索员工姓名或工号" aria-label="员工搜索" /></div>
        {loading ? <div className="table-state">正在读取调休申请...</div> : filteredReplacementLeaveRequests.length + filteredReplacementChanges.length === 0 ? <div className="table-state">暂无待审核调休申请。</div> : <div className="registration-list">{filteredReplacementLeaveRequests.map((request) => <button key={`leave-${request.id}`} className="registration-item" type="button" onClick={() => openReview(request)}><span><strong>{request.employee?.full_name ?? '未关联员工'}</strong><small>{leaveTypeLabels[request.leave_type]} · {formatLeaveDate(request)}</small></span><em>{leaveStatusLabels[request.status]}</em></button>)}{filteredReplacementChanges.map((change) => <button key={`change-${change.id}`} className="registration-item" type="button" onClick={() => { setSelectedReplacementChange(change); setReviewNote(''); setError(''); }}><span><strong>{replacementWorkChangeLabels[change.change_type]}</strong><small>原补班：{change.original_makeup_date} · 员工：{change.employee?.full_name ?? '未关联员工'}{change.employee?.employee_code ? `（${change.employee.employee_code}）` : ''}</small></span><em>待审核</em></button>)}</div>}
      </div> : null}

      {view === 'history' ? <HistoryPanel
        isReplacement={initialSection === 'replacement'} year={historyYear} month={historyMonth} type={historyType} status={historyStatus} regionId={historyRegionId} search={historySearch}
        regions={regions} loading={historyLoading} error={historyError} leaveRows={leaveHistory} replacementRows={replacementHistory}
        onYear={(value) => { setHistoryYear(value); setHistoryPage(1); }} onMonth={(value) => { setHistoryMonth(value); setHistoryPage(1); }} onType={(value) => { setHistoryType(value); setHistoryPage(1); }} onStatus={(value) => { setHistoryStatus(value); setHistoryPage(1); }} onRegion={(value) => { setHistoryRegionId(value); setHistoryPage(1); }} onSearch={(value) => { setHistorySearch(value); setHistoryPage(1); }}
        page={historyPage} onPage={setHistoryPage} onDetail={setSelectedHistory}
      /> : null}

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
      {selectedReplacementChange ? <SystemModal title="审核调休补班变更" subtitle={replacementWorkChangeLabels[selectedReplacementChange.change_type]} ariaLabel="审核调休补班变更" onClose={() => setSelectedReplacementChange(null)} footer={<><button className="secondary-button compact-button" type="button" onClick={() => setSelectedReplacementChange(null)}>关闭</button><button className="primary-button compact-button" type="button" onClick={() => reviewReplacementChange('approved')} disabled={submitting}>审核通过</button><button className="secondary-button compact-button danger-text-button" type="submit" form="replacement-change-reject-form" disabled={submitting}>拒绝</button></>}><div className="detail-list"><div><span>原补班日期</span><strong>{selectedReplacementChange.original_makeup_date}</strong></div><div><span>新补班日期</span><strong>{selectedReplacementChange.requested_makeup_date || '-'}</strong></div><div><span>新开始时间</span><strong>{selectedReplacementChange.requested_start_time?.slice(0, 5) || '-'}</strong></div><div><span>原因</span><strong>{selectedReplacementChange.reason}</strong></div></div><form id="replacement-change-reject-form" className="reject-form" onSubmit={(event) => { event.preventDefault(); void reviewReplacementChange('rejected'); }}><label className="form-field"><span>审核备注 / 拒绝原因</span><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label></form>{error ? <p className="form-alert">{error}</p> : null}</SystemModal> : null}
      {selectedHistory ? <SystemModal title={selectedHistory.employee_name} subtitle="审批历史详情（只读）" ariaLabel="审批历史详情" onClose={() => setSelectedHistory(null)} footer={<button className="secondary-button compact-button" type="button" onClick={() => setSelectedHistory(null)}>关闭</button>}>
        {isReplacementHistoryItem(selectedHistory) ? (
          <div className="detail-list">
            <div><span>工号</span><strong>{selectedHistory.employee_code || '-'}</strong></div>
            <div><span>区域</span><strong>{selectedHistory.region_code || '-'}</strong></div>
            <div><span>记录类型</span><strong>{replacementReviewHistoryRecordTypeLabels[selectedHistory.record_type]}</strong></div>
            {selectedHistory.change_type ? <div><span>变更类型</span><strong>{replacementWorkChangeLabels[selectedHistory.change_type]}</strong></div> : null}
            <div><span>调休日期</span><strong>{selectedHistory.replacement_leave_date || '-'}</strong></div>
            <div><span>原补班日期</span><strong>{selectedHistory.original_makeup_date || '-'}</strong></div>
            {selectedHistory.record_type === 'makeup_change' && selectedHistory.requested_makeup_date ? <div><span>申请变更日期</span><strong>{selectedHistory.requested_makeup_date}{selectedHistory.status === 'rejected' ? '（未生效）' : ''}</strong></div> : null}
            <div><span>当前补班日期</span><strong>{formatReplacementMakeupDate(selectedHistory)}</strong></div>
            <div><span>申请原因</span><strong>{selectedHistory.reason || '-'}</strong></div>
            <div><span>申请提交日期</span><strong>{formatDate(selectedHistory.created_at)}</strong></div>
            <div><span>审批结果</span><strong>{selectedHistory.status === 'approved' ? '已通过' : '已拒绝'}</strong></div>
            <div><span>审批人</span><strong>{selectedHistory.reviewer_name || '-'}</strong></div>
            <div><span>审批日期</span><strong>{selectedHistory.reviewed_at ? formatDate(selectedHistory.reviewed_at) : '-'}</strong></div>
          </div>
        ) : (
          <div className="detail-list">
            <div><span>工号</span><strong>{selectedHistory.employee_code || '-'}</strong></div>
            <div><span>区域</span><strong>{selectedHistory.region_code || '-'}</strong></div>
            <div><span>请假类型</span><strong>{leaveTypeLabels[selectedHistory.leave_type]}</strong></div>
            <div><span>申请提交时间</span><strong>{formatDateTime(selectedHistory.created_at)}</strong></div>
            <div><span>请假开始日期</span><strong>{selectedHistory.start_date}</strong></div>
            <div><span>请假结束日期</span><strong>{selectedHistory.end_date}</strong></div>
            <div><span>申请原因</span><strong>{selectedHistory.reason || '-'}</strong></div>
            <div><span>审批状态</span><strong>{selectedHistory.status === 'approved' ? '已通过' : '已拒绝'}</strong></div>
            <div><span>审批人</span><strong>{selectedHistory.reviewer_name || '-'}</strong></div>
            <div><span>审批时间</span><strong>{selectedHistory.reviewed_at ? formatDateTime(selectedHistory.reviewed_at) : '-'}</strong></div>
            {selectedHistory.leave_type === 'medical' ? <div><span>病假证明</span><strong>{selectedHistory.has_medical_attachment ? '有证明' : '无证明'}</strong></div> : null}
          </div>
        )}
      </SystemModal> : null}
    </section>
  );
}

function HistoryPanel({
  isReplacement, year, month, type, status, regionId, search, regions, loading, error, leaveRows, replacementRows, onYear, onMonth, onType, onStatus, onRegion, onSearch, page, onPage, onDetail,
}: {
  isReplacement: boolean; year: number; month: number; type: string; status: string; regionId: string; search: string; regions: Region[]; loading: boolean; error: string;
  leaveRows: LeaveReviewHistoryItem[]; replacementRows: ReplacementWorkChangeReviewHistoryItem[]; onYear: (value: number) => void; onMonth: (value: number) => void; onType: (value: string) => void; onStatus: (value: string) => void; onRegion: (value: string) => void; onSearch: (value: string) => void; page: number; onPage: (value: number) => void; onDetail: (row: LeaveReviewHistoryItem | ReplacementWorkChangeReviewHistoryItem) => void;
}) {
  const rows = isReplacement ? replacementRows : leaveRows;
  const total = rows[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));
  const typeOptions = isReplacement ? Object.entries(replacementWorkChangeLabels) : Object.entries(leaveTypeLabels);
  return <div className="staff-list-panel holiday-history-panel">
    <div className="list-header"><div><span>审批历史</span><h3>{error ? '历史记录暂不可用' : isReplacement ? '调休审批历史' : '请假审批历史'}{error ? '' : ` · ${total} 条已处理记录`}</h3><p>{isReplacement ? '按调休日期（马来西亚时间）筛选；补班变更会作为独立审批事件显示。' : '按申请提交时间（马来西亚时间）筛选；附件不会在列表中公开。'}</p></div></div>
    <div className="holiday-history-filters">
      <input type="number" min="2000" max="2100" value={year} aria-label="年份" onChange={(event) => onYear(Number(event.target.value) || new Date().getFullYear())} />
      <select value={month} aria-label="月份" onChange={(event) => onMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 月</option>)}</select>
      <select value={type} aria-label="类型" onChange={(event) => onType(event.target.value)}><option value="">全部类型</option>{typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select value={status} aria-label="审批状态" onChange={(event) => onStatus(event.target.value)}><option value="">全部状态</option><option value="approved">已通过</option><option value="rejected">已拒绝</option></select>
      <select value={regionId} aria-label="区域" onChange={(event) => onRegion(event.target.value)}><option value="">全部可查看区域</option>{regions.map((region) => <option key={region.id} value={region.id}>{region.code}</option>)}</select>
      <input type="search" value={search} aria-label="员工搜索" onChange={(event) => onSearch(event.target.value)} placeholder="搜索员工姓名或工号" />
    </div>
    {!isReplacement ? <div className="holiday-history-type-quick-filters" role="group" aria-label="请假类型快捷筛选">
      <button className={type === '' ? 'active' : ''} type="button" onClick={() => onType('')}>全部类型</button>
      {(['annual', 'medical', 'unpaid'] as const).map((quickType) => <button key={quickType} className={type === quickType ? 'active' : ''} type="button" onClick={() => onType(quickType)}>{leaveTypeLabels[quickType]}</button>)}
    </div> : null}
    {error ? <div className="table-state compact">历史查询不可用：{error}</div> : loading ? <div className="table-state compact">正在读取审批历史...</div> : rows.length === 0 ? <div className="table-state compact">当前筛选条件下没有已处理记录。</div> : isReplacement ? <div className="staff-table-wrap"><table className="staff-table holiday-history-table"><thead><tr><th>申请提交日期</th><th>员工姓名</th><th>员工工号</th><th>所属区域</th><th>记录类型</th><th>调休日期</th><th>补班日期</th><th>申请原因</th><th>审批结果</th><th>审批人</th><th>审批日期</th><th>操作</th></tr></thead><tbody>{replacementRows.map((row) => <tr key={`${row.record_type}:${row.id}`}><td>{formatDate(row.created_at)}</td><td><strong>{row.employee_name}</strong></td><td>{row.employee_code || '-'}</td><td>{row.region_code || '-'}</td><td>{formatReplacementRecordType(row)}</td><td>{row.replacement_leave_date || '-'}</td><td>{formatReplacementMakeupDate(row)}</td><td>{row.reason}</td><td><span className={`status-pill history-${row.status}`}>{row.status === 'approved' ? '已通过' : '已拒绝'}</span></td><td>{row.reviewer_name || '-'}</td><td>{row.reviewed_at ? formatDate(row.reviewed_at) : '-'}</td><td className="holiday-history-action-cell"><button className="holiday-history-detail-button" type="button" onClick={() => onDetail(row)}>查看详情</button></td></tr>)}</tbody></table></div> : <div className="staff-table-wrap"><table className="staff-table holiday-history-table"><thead><tr><th>申请日期</th><th>员工</th><th>工号</th><th>区域</th><th>类型</th><th>申请日期范围</th><th>申请原因</th><th>审批结果</th><th>审批人</th><th>审批时间</th><th>操作</th></tr></thead><tbody>{leaveRows.map((row) => <tr key={row.id}><td>{formatDateTime(row.created_at)}</td><td><strong>{row.employee_name}</strong></td><td>{row.employee_code || '-'}</td><td>{row.region_code || '-'}</td><td>{leaveTypeLabels[row.leave_type]}</td><td>{row.start_date} 至 {row.end_date}</td><td>{row.reason}</td><td><span className={`status-pill history-${row.status}`}>{row.status === 'approved' ? '已通过' : '已拒绝'}</span></td><td>{row.reviewer_name || '-'}</td><td>{row.reviewed_at ? formatDateTime(row.reviewed_at) : '-'}</td><td className="holiday-history-action-cell"><button className="holiday-history-detail-button" type="button" onClick={() => onDetail(row)}>查看详情</button></td></tr>)}</tbody></table></div>}
    {!error && total > 0 ? <div className="holiday-history-pagination"><button className="secondary-button compact-button" type="button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>上一页</button><span>第 {page} / {totalPages} 页</span><button className="secondary-button compact-button" type="button" disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>下一页</button></div> : null}
  </div>;
}

function isReplacementHistoryItem(row: LeaveReviewHistoryItem | ReplacementWorkChangeReviewHistoryItem): row is ReplacementWorkChangeReviewHistoryItem {
  return 'change_type' in row;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function formatReplacementRecordType(row: ReplacementWorkChangeReviewHistoryItem) {
  const label = replacementReviewHistoryRecordTypeLabels[row.record_type];
  return row.change_type ? `${label} · ${replacementWorkChangeLabels[row.change_type]}` : label;
}

function formatReplacementMakeupDate(row: ReplacementWorkChangeReviewHistoryItem) {
  if (row.record_type === 'makeup_change' && row.status === 'approved' && row.requested_makeup_date) return row.requested_makeup_date;
  return row.original_makeup_date || '-';
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatLeaveDate(request: LeaveRequestItem) {
  if (request.leave_type === 'replacement') {
    return `补班日期 ${request.start_date}，调休日期 ${request.end_date}`;
  }

  return `${request.start_date} 至 ${request.end_date}`;
}
