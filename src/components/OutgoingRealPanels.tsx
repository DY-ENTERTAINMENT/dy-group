import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, FilePlus2, Image, MapPin, Play, RefreshCw, Timer, XCircle } from 'lucide-react';
import { SystemModal } from './SystemModal';
import {
  lifecycleStatus,
  outgoingRealAdapter,
  type OutgoingLifecycleStatus,
  type OutgoingRequestFormValues,
  type OutgoingRequestWithEvent,
} from '../services/outgoing-real-adapter.service';
import type { AttendanceEmployee } from '../services/attendanceManagement.service';
import type { OutgoingType, Region } from '../types/database';

type EmployeePanelProps = {
  regionId: string | null;
  onChanged: () => void;
};

type ManagementPanelProps = {
  regions: Region[];
  employees: AttendanceEmployee[];
  canApprove: boolean;
  canHandleExceptions: boolean;
};

type OutgoingCapture = (request: OutgoingRequestWithEvent, phase: 'start' | 'end') => Promise<void>;

const statusLabels: Record<OutgoingLifecycleStatus, string> = {
  pending: '待审批', approved: '已批准', rejected: '已拒绝', cancelled: '已取消',
  in_progress: '外出中', completed: '已完成', exception: '外出异常',
};

const summaryStatuses = ['pending', 'approved', 'in_progress', 'completed', 'exception'] as const;
type SummaryStatus = (typeof summaryStatuses)[number];

export function OutgoingRealEmployeePanel({ regionId, onChanged }: EmployeePanelProps) {
  const [requests, setRequests] = useState<OutgoingRequestWithEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [historyRequest, setHistoryRequest] = useState<OutgoingRequestWithEvent | null>(null);
  const [admissionsEnabled, setAdmissionsEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await outgoingRealAdapter.reconcileExceptions();
      const [state, enabled] = await Promise.all([outgoingRealAdapter.loadEmployeeState(), outgoingRealAdapter.getAdmissionsEnabled()]);
      setRequests(state.requests);
      setAdmissionsEnabled(enabled);
      setError('');
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const current = useMemo(() => selectCurrent(requests), [requests]);

  async function cancel(request: OutgoingRequestWithEvent) {
    try {
      await outgoingRealAdapter.cancelRequest(request.id);
      await load();
      onChanged();
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

  return <section className="outgoing-section employee-outgoing-preview" aria-label="外出办公">
    <div className="outgoing-preview-heading"><h3>外出办公</h3>{admissionsEnabled ? <button className="outgoing-apply-button" type="button" onClick={() => setFormOpen(true)}><FilePlus2 size={16} /><span>申请外出办公</span></button> : null}</div>
    {loading ? <p className="outgoing-management-empty">正在读取外出申请…</p> : current ? <OutgoingEmployeeRequestCard request={current} onCancel={(request) => void cancel(request)} onHistory={setHistoryRequest} /> : <div className="outgoing-preview-empty"><span>外出需先提交申请，经批准后方可开始外出。</span></div>}
    {!admissionsEnabled ? <p className="outgoing-management-empty">外出服务暂未启用；已有外出记录仍可查看和收尾。</p> : null}{error ? <p className="form-alert">{error}</p> : null}
    {formOpen ? <OutgoingRequestFormModal regionId={regionId} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); void load(); onChanged(); }} /> : null}
    {historyRequest ? <OutgoingHistoryModal request={historyRequest} onClose={() => setHistoryRequest(null)} /> : null}
  </section>;
}

export function OutgoingRealPunchActions({ request, canStart, onCapture, onChanged, onMessage, onError }: { request: OutgoingRequestWithEvent | null; canStart: boolean; onCapture: OutgoingCapture; onChanged: () => void; onMessage: (message: string) => void; onError: (message: string) => void }) {
  const [admissionsEnabled, setAdmissionsEnabled] = useState(false);
  useEffect(() => { void outgoingRealAdapter.getAdmissionsEnabled().then(setAdmissionsEnabled).catch(() => setAdmissionsEnabled(false)); }, [request?.id]);
  if (!request) return null;
  const activeRequest: OutgoingRequestWithEvent = request;
  const status = lifecycleStatus(activeRequest);
  async function capture(phase: 'start' | 'end') {
    try {
      await onCapture(activeRequest, phase);
      onError('');
      onMessage(phase === 'start' ? '开始外出成功。' : '结束外出成功。');
      onChanged();
    } catch (reason) {
      onError(messageOf(reason));
    }
  }
  return <div className="outgoing-punch-actions" aria-label="外出打卡">
    {status === 'approved' && admissionsEnabled ? <button className="outgoing-punch-start" type="button" disabled={!canStart || activeRequest.outgoing_date !== malaysiaDate()} onClick={() => void capture('start')}><Play size={19} /><span>开始外出</span></button> : null}
    {status === 'in_progress' ? <button className="outgoing-punch-finish" type="button" onClick={() => void capture('end')}><XCircle size={19} /><span>结束外出</span></button> : null}
  </div>;
}

export function OutgoingRealManagementPanel({ regions, employees, canApprove, canHandleExceptions }: ManagementPanelProps) {
  const [requests, setRequests] = useState<OutgoingRequestWithEvent[]>([]);
  const [status, setStatus] = useState<OutgoingLifecycleStatus | 'all'>('pending');
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [regionId, setRegionId] = useState('');
  const [type, setType] = useState<OutgoingType | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState<OutgoingRequestWithEvent | null>(null);
  const [reviewDecision, setReviewDecision] = useState<'approved' | 'rejected'>('approved');
  const [admissionsEnabled, setAdmissionsEnabled] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [detail, setDetail] = useState<OutgoingRequestWithEvent | null>(null);

  const employeeNames = useMemo(() => new Map(employees.map((employee) => [employee.id, employee.nickname || employee.full_name || employee.employee_code || employee.id])), [employees]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [state, enabled] = await Promise.all([outgoingRealAdapter.loadManagementState({ startDate: startDate || undefined, endDate: endDate || undefined, regionId: regionId || undefined, outgoingType: type || undefined }), outgoingRealAdapter.getAdmissionsEnabled()]);
      setRequests(state.requests);
      setAdmissionsEnabled(enabled);
      setError('');
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }, [endDate, regionId, startDate, type]);

  useEffect(() => { void load(); }, [load]);
  const counts = useMemo(() => summaryStatuses.reduce((result, item) => ({ ...result, [item]: requests.filter((request) => lifecycleStatus(request) === item).length }), {} as Record<SummaryStatus, number>), [requests]);
  const visible = useMemo(() => requests.filter((request) => {
    const name = employeeNames.get(request.employee_id) ?? request.employee_id;
    return (status === 'all' || lifecycleStatus(request) === status) && (!employeeQuery.trim() || name.toLowerCase().includes(employeeQuery.trim().toLowerCase()));
  }), [employeeNames, employeeQuery, requests, status]);

  async function submitReview() {
    if (!reviewing) return;
    try {
      await outgoingRealAdapter.reviewRequest(reviewing.id, reviewDecision, reviewNote);
      setReviewing(null);
      setReviewNote('');
      await load();
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

  async function handleException(request: OutgoingRequestWithEvent) {
    const event = request.outgoing_events[0];
    if (!event) return;
    try {
      await outgoingRealAdapter.handleException(event.id);
      await load();
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

  return <section className="outgoing-management-preview" aria-label="外出管理">
    <div className="outgoing-management-summary">{summaryStatuses.map((item) => <button key={item} className={`outgoing-summary-${item}${status === item ? ' active' : ''}`} type="button" onClick={() => setStatus(item)}><span>{statusLabels[item]}</span><strong>{counts[item]}</strong></button>)}</div>
    <div className="outgoing-management-filter-fields">
      <label>员工<input type="search" value={employeeQuery} placeholder="搜索姓名" onChange={(event) => setEmployeeQuery(event.target.value)} /></label>
      <label>开始日期<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label>结束日期<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      <label>区域<select value={regionId} onChange={(event) => setRegionId(event.target.value)}><option value="">全部授权区域</option>{regions.map((region) => <option key={region.id} value={region.id}>{region.code}</option>)}</select></label>
      <label>外出类型<select value={type} onChange={(event) => setType(event.target.value as OutgoingType | '')}><option value="">全部类型</option>{outgoingTypeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>状态<select value={status} onChange={(event) => setStatus(event.target.value as OutgoingLifecycleStatus | 'all')}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="secondary-button compact-button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /><span>刷新</span></button>
    </div>
    {error ? <p className="form-alert">{error}</p> : null}
    {!admissionsEnabled ? <p className="outgoing-management-empty">外出服务暂未启用；不接受新的批准，仍可拒绝或处理既有记录。</p> : null}{loading ? <p className="outgoing-management-empty">正在读取外出申请…</p> : visible.length ? visible.map((request) => <OutgoingManagementCard key={request.id} request={request} employeeName={employeeNames.get(request.employee_id) ?? request.employee_id} canApprove={canApprove && admissionsEnabled} canReject={canApprove} canHandleExceptions={canHandleExceptions} onReview={(decision) => { setReviewing(request); setReviewDecision(decision); setReviewNote(''); }} onDetail={() => setDetail(request)} onHandle={() => void handleException(request)} />) : <p className="outgoing-management-empty">当前筛选下暂无外出申请。</p>}
    {reviewing ? <OutgoingReviewModal decision={reviewDecision} note={reviewNote} onNoteChange={setReviewNote} onClose={() => setReviewing(null)} onSubmit={() => void submitReview()} /> : null}
    {detail ? <OutgoingDetailModal request={detail} employeeName={employeeNames.get(detail.employee_id) ?? detail.employee_id} onClose={() => setDetail(null)} /> : null}
  </section>;
}

function OutgoingEmployeeRequestCard({ request, onCancel, onHistory }: { request: OutgoingRequestWithEvent; onCancel: (request: OutgoingRequestWithEvent) => void; onHistory: (request: OutgoingRequestWithEvent) => void }) {
  const status = lifecycleStatus(request);
  const event = request.outgoing_events[0];
  return <article className={`outgoing-preview-card outgoing-preview-${status}`}><div className="outgoing-preview-card-head"><div className="outgoing-status-heading"><Timer size={20} /><div><span>外出申请</span><h4>{request.reason}</h4></div></div><OutgoingStatusBadge status={status} /></div><div className="outgoing-preview-meta"><span><MapPin size={15} />{request.location}</span><span><CalendarDays size={15} />{request.outgoing_date}</span><span><Clock3 size={15} />预计 {request.planned_start_time} – {request.planned_return_time}</span></div>{event?.status === 'in_progress' ? <p>实际开始：{formatDateTime(event.started_at)}</p> : null}{event?.status === 'completed' ? <p>实际开始：{formatDateTime(event.started_at)} · 实际结束：{formatDateTime(event.ended_at)}</p> : null}{event?.status === 'exception' ? <p>异常：{event.exception_reason} · {event.exception_handled_at ? '已处理' : '待处理'}</p> : null}{request.status === 'rejected' ? <p>拒绝原因：{request.review_note}</p> : null}<div className="outgoing-preview-actions">{(request.status === 'pending' || request.status === 'approved') && !event ? <button className="outgoing-cancel-button" type="button" onClick={() => onCancel(request)}><XCircle size={18} /><span>取消申请</span></button> : null}<button className="text-link-button" type="button" onClick={() => onHistory(request)}>查看我的外出申请记录</button></div></article>;
}

function OutgoingManagementCard({ request, employeeName, canApprove, canReject, canHandleExceptions, onReview, onDetail, onHandle }: { request: OutgoingRequestWithEvent; employeeName: string; canApprove: boolean; canReject: boolean; canHandleExceptions: boolean; onReview: (decision: 'approved' | 'rejected') => void; onDetail: () => void; onHandle: () => void }) {
  const status = lifecycleStatus(request);
  const event = request.outgoing_events[0];
  return <article className="outgoing-management-card"><button className="outgoing-management-card-main" type="button" onClick={onDetail}><span>{typeLabel(request.outgoing_type)}</span><h3>{employeeName}</h3><p>{request.reason}</p><p className="outgoing-management-location"><MapPin size={14} />{request.location}</p><p className="outgoing-management-time"><CalendarDays size={14} />{request.outgoing_date} · <Clock3 size={14} />预计 {request.planned_start_time} – {request.planned_return_time}</p>{request.review_note ? <p>拒绝原因：{request.review_note}</p> : null}{event?.status === 'in_progress' ? <p>实际开始：{formatDateTime(event.started_at)}</p> : null}</button><div className="outgoing-management-card-actions"><OutgoingStatusBadge status={status} />{request.status === 'pending' ? <div className="outgoing-approval-actions"><button className="outgoing-reject-button" type="button" disabled={!canReject} onClick={() => onReview('rejected')}><XCircle size={16} /><span>拒绝</span></button><button className="outgoing-approve-button" type="button" disabled={!canApprove} onClick={() => onReview('approved')}><CheckCircle2 size={16} /><span>批准</span></button></div> : null}{event?.status === 'exception' ? <button className="outgoing-handled-button" type="button" disabled={!canHandleExceptions || Boolean(event.exception_handled_at)} onClick={onHandle}><CheckCircle2 size={16} /><span>{event.exception_handled_at ? '已处理' : '标记已处理'}</span></button> : null}</div></article>;
}

function OutgoingRequestFormModal({ regionId, onClose, onSaved }: { regionId: string | null; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<OutgoingRequestFormValues>({ outgoingDate: malaysiaDate(), plannedStartTime: '14:00', plannedReturnTime: '16:30', outgoingType: 'client_visit', location: '', reason: '', relatedContact: '', remarks: '' });
  const [error, setError] = useState('');
  async function submit() {
    if (!regionId) { setError('当前员工未配置区域。'); return; }
    try { await outgoingRealAdapter.createRequest(values); onSaved(); } catch (reason) { setError(messageOf(reason)); }
  }
  return <SystemModal title="提交外出申请" subtitle="外出申请将由服务器验证并提交审批" ariaLabel="提交外出申请" onClose={onClose} footer={<><button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button><button className="primary-button compact-button" type="button" onClick={() => void submit()}><FilePlus2 size={16} /><span>提交申请</span></button></>}><div className="outgoing-preview-form"><label>外出日期<input type="date" min={malaysiaDate()} value={values.outgoingDate} onChange={(event) => setValues({ ...values, outgoingDate: event.target.value })} /></label><label>预计开始时间<input type="time" value={values.plannedStartTime} onChange={(event) => setValues({ ...values, plannedStartTime: event.target.value })} /></label><label>预计返回时间<input type="time" value={values.plannedReturnTime} onChange={(event) => setValues({ ...values, plannedReturnTime: event.target.value })} /></label><label>外出类型<select value={values.outgoingType} onChange={(event) => setValues({ ...values, outgoingType: event.target.value as OutgoingType })}>{outgoingTypeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="outgoing-form-wide">外出地点<input value={values.location} onChange={(event) => setValues({ ...values, location: event.target.value })} /></label><label className="outgoing-form-wide">外出事由<textarea value={values.reason} onChange={(event) => setValues({ ...values, reason: event.target.value })} rows={3} /></label><label>关联主播或客户<input value={values.relatedContact ?? ''} onChange={(event) => setValues({ ...values, relatedContact: event.target.value })} /></label><label>备注<input value={values.remarks ?? ''} onChange={(event) => setValues({ ...values, remarks: event.target.value })} /></label></div>{error ? <p className="form-alert">{error}</p> : null}</SystemModal>;
}

function OutgoingHistoryModal({ request, onClose }: { request: OutgoingRequestWithEvent; onClose: () => void }) {
  const [history, setHistory] = useState<Array<{ id: string; action: string; actor_name: string; note: string | null; created_at: string }>>([]);
  const [error, setError] = useState('');
  useEffect(() => { void outgoingRealAdapter.loadReviewHistory(request.id).then(setHistory).catch((reason) => setError(messageOf(reason))); }, [request.id]);
  return <SystemModal title="外出申请记录" subtitle={`${request.outgoing_date} · ${request.reason}`} ariaLabel="外出申请记录" onClose={onClose} footer={<button className="secondary-button compact-button" type="button" onClick={onClose}>关闭</button>}><div className="outgoing-preview-history">{history.map((item) => <div key={item.id}><strong>{item.action}</strong><span>{item.actor_name} · {formatDateTime(item.created_at)} {item.note ? `· ${item.note}` : ''}</span></div>)}{error ? <p className="form-alert">{error}</p> : null}</div></SystemModal>;
}

function OutgoingReviewModal({ decision, note, onNoteChange, onClose, onSubmit }: { decision: 'approved' | 'rejected'; note: string; onNoteChange: (value: string) => void; onClose: () => void; onSubmit: () => void }) {
  const rejected = decision === 'rejected';
  return <SystemModal title={rejected ? '拒绝外出申请' : '批准外出申请'} subtitle={rejected ? '必须填写拒绝原因' : '审批人及时间由服务器记录'} ariaLabel="审批外出申请" onClose={onClose} footer={<><button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button><button className={rejected ? 'outgoing-reject-button compact-button' : 'outgoing-approve-button compact-button'} type="button" onClick={onSubmit}>{rejected ? '确认拒绝' : '确认批准'}</button></>}><div className="outgoing-preview-form">{rejected ? <label className="outgoing-form-wide">拒绝原因<textarea value={note} onChange={(event) => onNoteChange(event.target.value)} rows={4} autoFocus /></label> : <p>确认后将由服务器验证权限、区域及申请当前状态。</p>}</div></SystemModal>;
}

function OutgoingDetailModal({ request, employeeName, onClose }: { request: OutgoingRequestWithEvent; employeeName: string; onClose: () => void }) {
  const event = request.outgoing_events[0];
  const [photoUrl, setPhotoUrl] = useState('');
  const [error, setError] = useState('');
  async function showPhoto(path: string | null) { if (!path) return; try { setPhotoUrl(await outgoingRealAdapter.getPhotoSignedUrl(path)); } catch (reason) { setError(messageOf(reason)); } }
  return <SystemModal title="外出申请详情" subtitle={employeeName} ariaLabel="外出申请详情" onClose={onClose} footer={<button className="secondary-button compact-button" type="button" onClick={onClose}>关闭</button>}><div className="outgoing-preview-history"><div><strong>{request.reason}</strong><span>{request.location} · {request.outgoing_date} · 预计 {request.planned_start_time} – {request.planned_return_time}</span></div><div><OutgoingStatusBadge status={lifecycleStatus(request)} /></div>{event ? <><div><span>开始：{formatDateTime(event.started_at)} · GPS {event.start_latitude}, {event.start_longitude}</span></div>{event.ended_at ? <div><span>结束：{formatDateTime(event.ended_at)} · GPS {event.end_latitude}, {event.end_longitude}</span></div> : null}<div><button className="text-link-button" type="button" onClick={() => void showPhoto(event.start_photo_path)}><Image size={16} />查看开始照片</button>{event.end_photo_path ? <button className="text-link-button" type="button" onClick={() => void showPhoto(event.end_photo_path)}>查看结束照片</button> : null}</div></> : null}{photoUrl ? <img className="today-photo-large" src={photoUrl} alt="外出打卡照片" /> : null}{error ? <p className="form-alert">{error}</p> : null}</div></SystemModal>;
}

function OutgoingStatusBadge({ status }: { status: OutgoingLifecycleStatus }) { return <span className={`outgoing-status outgoing-status-${status}`}>{statusLabels[status]}</span>; }
function selectCurrent(requests: OutgoingRequestWithEvent[]) { return [...requests].sort((left, right) => priority(right) - priority(left) || right.updated_at.localeCompare(left.updated_at))[0] ?? null; }
function priority(request: OutgoingRequestWithEvent) { const status = lifecycleStatus(request); return status === 'in_progress' ? 4 : status === 'approved' ? 3 : status === 'pending' ? 2 : 1; }
function formatDateTime(value: string | null) { return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—'; }
function malaysiaDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()); }
function messageOf(error: unknown) { return error instanceof Error ? error.message : '外出操作失败。'; }
const outgoingTypeOptions: Array<{ value: OutgoingType; label: string }> = [{ value: 'streamer_visit', label: '见主播' }, { value: 'client_visit', label: '拜访客户' }, { value: 'company_business', label: '公司事务' }, { value: 'procurement', label: '采购' }, { value: 'event', label: '活动' }, { value: 'other', label: '其他' }];
function typeLabel(type: OutgoingType) { return outgoingTypeOptions.find((item) => item.value === type)?.label ?? type; }
