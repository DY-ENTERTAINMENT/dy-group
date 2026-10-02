import { useEffect, useMemo, useRef, useState } from 'react';
import { BriefcaseBusiness, Camera, Coffee, Clock, LogOut, MapPin, Play, RefreshCw } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import { useAuth } from '../hooks/useAuth';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { getBrowserGeoPosition } from '../services/attendance-location.service';
import { groupAttendanceRecordsByMytDate, mytMonthRange, sortAttendanceRecords, summarizeAttendanceDay, todayMytDateKey } from '../services/attendance-day';
import { type AttendanceRecordItem, attendanceService, getPublicIpAddress } from '../services/attendance.service';
import { attendanceManagementService } from '../services/attendanceManagement.service';
import type { AttendancePunchType } from '../types/database';

const labels: Record<AttendancePunchType, string> = { clock_in: '上班打卡', break_start: '开始休息', break_end: '结束休息', clock_out: '下班打卡' };
const statusLabels = { not_started: '未上班', working: '工作中', on_break: '休息中', clocked_out: '已下班' } as const;
type GeoState = { latitude: number; longitude: number; accuracy: number | null };
type PendingPunch = { type: AttendancePunchType; warning: string } | null;

export function AttendancePage() {
  const { profile } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const punchInFlightRef = useRef(false);
  const [tab, setTab] = useState<'today' | 'history'>('today');
  const [todayRecords, setTodayRecords] = useState<AttendanceRecordItem[]>([]);
  const [monthRecords, setMonthRecords] = useState<AttendanceRecordItem[]>([]);
  const [month, setMonth] = useState(todayMytDateKey().slice(0, 7));
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeoState | null>(null);
  const [ipAddress, setIpAddress] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [loadingToday, setLoadingToday] = useState(true);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [submitting, setSubmitting] = useState<AttendancePunchType | null>(null);
  const [pending, setPending] = useState<PendingPunch>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(new Date());
  const deviceInfo = useMemo(() => navigator.userAgent, []);
  const today = useMemo(() => sortAttendanceRecords(todayRecords), [todayRecords]);
  const summary = useMemo(() => summarizeAttendanceDay(today), [today]);
  const days = useMemo(() => [...groupAttendanceRecordsByMytDate(monthRecords).entries()].sort(([a], [b]) => b.localeCompare(a)), [monthRecords]);

  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(id); }, []);
  useEffect(() => { void startCamera(); locate(); void getPublicIpAddress().then(setIpAddress); return () => stopCamera(); }, []);
  useEffect(() => { if (profile?.id) void loadToday(profile.id); }, [profile?.id]);
  useEffect(() => { if (tab === 'history' && profile?.id) void loadMonth(profile.id); }, [tab, month, profile?.id]);
  usePullToRefresh(() => loadToday(), [profile?.id]);

  async function startCamera() {
    try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }); streamRef.current = stream; if (videoRef.current) videoRef.current.srcObject = stream; setCameraReady(true); }
    catch { setCameraReady(false); setError('无法启动摄像头。请允许浏览器使用摄像头后再试。'); }
  }
  function stopCamera() { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; }
  function locate() { setLocating(true); void getBrowserGeoPosition().then(setGeo).catch((reason) => setError(reason instanceof Error ? reason.message : '无法取得当前位置，请检查浏览器定位权限或网络后重试。')).finally(() => setLocating(false)); }
  async function loadToday(profileId = profile?.id) {
    if (!profileId) return; setLoadingToday(true); setError(''); const date = todayMytDateKey();
    try { setTodayRecords(await attendanceService.listMyAttendanceRecords(profileId, { start: `${date}T00:00:00+08:00`, end: nextMytDay(date) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '读取今日打卡记录失败。'); } finally { setLoadingToday(false); }
  }
  async function loadMonth(profileId = profile?.id) {
    if (!profileId) return; setLoadingMonth(true); setError('');
    try { setMonthRecords(await attendanceService.listMyAttendanceRecords(profileId, mytMonthRange(month))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '读取考勤记录失败。'); } finally { setLoadingMonth(false); }
  }
  function requestPunch(type: AttendancePunchType) { const warning = punchWarning(type, summary, today); if (warning === 'blocked') return; if (warning) { setPending({ type, warning }); return; } void submitPunch(type); }
  async function submitPunch(type: AttendancePunchType) {
    if (punchInFlightRef.current || !profile?.id) return;
    if (!cameraReady) { setError('请先开启摄像头。'); return; }
    punchInFlightRef.current = true; setSubmitting(type); setLocating(true); setError(''); setMessage(''); setPending(null);
    try { const position = await getBrowserGeoPosition(); setGeo(position); setLocating(false); await attendanceService.createAttendanceRecord({ profileId: profile.id, punchType: type, photoBlob: await capturePhoto(), latitude: position.latitude, longitude: position.longitude, accuracy: position.accuracy, ipAddress, deviceInfo }); setMessage(`${labels[type]}成功。`); await loadToday(profile.id); }
    catch (reason) { await loadToday(profile.id); setError(reason instanceof Error ? reason.message : '打卡结果未明确。已重新查询今日记录，请确认时间线后再操作。'); }
    finally { setLocating(false); setSubmitting(null); punchInFlightRef.current = false; }
  }
  async function capturePhoto() {
    const video = videoRef.current; const canvas = canvasRef.current; if (!video || !canvas) throw new Error('无法读取摄像头画面。');
    canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480; const context = canvas.getContext('2d'); if (!context) throw new Error('无法生成打卡照片。'); context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法保存打卡照片。')), 'image/jpeg', 0.88));
  }
  const busy = Boolean(submitting) || locating;
  return <section className="attendance-page employee-attendance-page">
    <div className="attendance-page-tabs" role="tablist"><button className={tab === 'today' ? 'active' : ''} type="button" onClick={() => setTab('today')}>今日打卡</button><button className={tab === 'history' ? 'active' : ''} type="button" onClick={() => setTab('history')}>我的考勤记录</button></div>
    {tab === 'today' ? <div className="attendance-grid"><div className="camera-panel"><div className="panel-title-row"><div><span>实时拍照</span><h3>浏览器摄像头</h3></div><Camera size={22} /></div><div className="camera-frame"><video ref={videoRef} autoPlay playsInline muted />{!cameraReady ? <div className="camera-placeholder">等待摄像头授权</div> : null}</div><canvas ref={canvasRef} className="hidden-canvas" />
      <p className="employee-location"><MapPin size={16} />{locating ? '正在获取当前位置…' : geo ? `定位成功 · 精度 ±${Math.round(geo.accuracy ?? 0)} 米` : '尚未取得定位'}</p><button className="secondary-button compact-button" type="button" onClick={locate} disabled={busy}>{locating && !submitting ? '定位中...' : '重新定位'}</button><PunchActions records={today} summary={summary} busy={busy} submitting={submitting} onPunch={requestPunch} /></div>
      <div className="employee-today-details"><div className={`employee-status-card employee-status-${summary.status}`}><span>当前状态</span><div className="employee-status-main"><StatusIcon status={summary.status} size={30} /><strong>{statusLabels[summary.status]}</strong></div><p><Clock size={16} />{formatMytDateTime(now)}</p></div>{summary.anomalies.length ? <div className="employee-anomalies"><strong>记录提示</strong>{summary.anomalies.map((item) => <span key={item}>{item}</span>)}</div> : null}{error ? <p className="form-alert">{error}</p> : null}{message ? <p className="form-success">{message}</p> : null}<Timeline title="今日完整打卡时间线" records={today} loading={loadingToday} /></div></div>
      : <div className="employee-history"><div className="employee-history-controls"><label>月份<input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setExpandedDate(null); }} /></label><button className="secondary-button compact-button employee-history-refresh" type="button" onClick={() => loadMonth()} disabled={loadingMonth}><RefreshCw size={16} /><span>刷新</span></button></div>{error ? <p className="form-alert">{error}</p> : null}{loadingMonth ? <div className="employee-empty-state">正在读取考勤记录...</div> : days.length === 0 ? <div className="employee-empty-state">该月份暂无打卡记录。</div> : <div className="employee-day-cards">{days.map(([date, rows]) => { const daySummary = summarizeAttendanceDay(rows); const expanded = expandedDate === date; return <article className="employee-day-card" key={date}><button className="employee-day-card-head" type="button" onClick={() => setExpandedDate(expanded ? null : date)}><div><strong>{formatMytDate(date)}</strong><span className={`today-status today-status-${daySummary.status}`}>{statusLabels[daySummary.status]}</span></div><span>{expanded ? '收起' : '查看详情'}</span></button><DayOverview records={rows} />{expanded ? <Timeline title="当天完整原始记录" records={rows} /> : null}</article>; })}</div>}</div>}
    {pending ? <SystemModal title="确认打卡" subtitle={labels[pending.type]} ariaLabel="确认打卡" onClose={() => setPending(null)} footer={<><button className="secondary-button compact-button" type="button" onClick={() => setPending(null)}>取消</button><button className="primary-button compact-button" type="button" onClick={() => void submitPunch(pending.type)}>确认继续</button></>}><p className="form-helper">{pending.warning}</p><p className="form-helper">这会新增一条真实打卡记录，不会自动补齐或修正任何缺失记录。</p></SystemModal> : null}
  </section>;
}

function PunchActions({ records, summary, busy, submitting, onPunch }: { records: AttendanceRecordItem[]; summary: ReturnType<typeof summarizeAttendanceDay>; busy: boolean; submitting: AttendancePunchType | null; onPunch: (type: AttendancePunchType) => void }) { return <div className="punch-actions employee-punch-actions">{(['clock_in', 'break_start', 'break_end', 'clock_out'] as AttendancePunchType[]).map((type) => { const warning = punchWarning(type, summary, records); const blocked = warning === 'blocked'; const ready = !busy && !warning; const Icon = type === 'clock_in' ? BriefcaseBusiness : type === 'break_start' ? Coffee : type === 'break_end' ? Play : LogOut; return <button key={type} className={`${ready ? 'punch-action-ready' : 'punch-action-muted'} punch-${type}`} type="button" onClick={() => onPunch(type)} disabled={busy || blocked}><Icon size={20} /><span>{submitting === type ? '正在提交...' : labels[type]}</span></button>; })}</div>; }
function punchWarning(type: AttendancePunchType, summary: ReturnType<typeof summarizeAttendanceDay>, records: AttendanceRecordItem[]): string | null { if (summary.hasClockOut) return 'blocked'; const previousCount = records.filter((record) => record.punch_type === type).length; if (type === 'clock_in') return summary.hasClockIn ? '今天已有上班打卡。重复记录会保留在时间线内，是否仍要记录？' : summary.anomalies.length ? '今天已有异常记录但缺少上班打卡。继续会记录真实上班事件，不会修正现有记录。' : null; if (type === 'break_start') { if (!summary.hasClockIn) return previousCount ? `今天已经${labels[type]} ${previousCount} 次。本次将是第 ${previousCount + 1} 次，且尚未上班；继续只会记录真实事件。` : '尚未上班。此为异常操作；继续只会记录真实的开始休息事件。'; if (previousCount) return summary.breakOpen ? `今天已经${labels[type]} ${previousCount} 次。本次将是第 ${previousCount + 1} 次，且当前休息尚未结束；是否继续记录？` : `今天已经${labels[type]} ${previousCount} 次。本次将是第 ${previousCount + 1} 次；是否继续记录？`; return null; } if (type === 'break_end') { if (!summary.breakOpen) return 'blocked'; return previousCount ? `今天已经${labels[type]} ${previousCount} 次。本次将是第 ${previousCount + 1} 次；是否继续记录？` : null; } return !summary.hasClockIn ? '尚未上班。此为异常操作；继续只会记录真实下班事件，不会自动补上班记录。' : summary.breakOpen ? '目前仍在休息中。继续会记录真实下班事件，未结束的休息记录将保留。' : null; }
function Timeline({ title, records, loading = false }: { title: string; records: AttendanceRecordItem[]; loading?: boolean }) { return <div className="employee-timeline"><h3>{title}</h3>{loading ? <div className="table-state compact">正在读取记录...</div> : records.length === 0 ? <div className="table-state compact">暂无打卡记录。</div> : <ol className="today-timeline employee-punch-timeline">{records.map((record) => <li key={record.id} className={`timeline-${record.punch_type}`}><PunchIcon type={record.punch_type} size={20} /><div><strong>{labels[record.punch_type]}</strong><span>{formatMytDateTime(record.punched_at)}</span></div><AttendancePhoto record={record} /></li>)}</ol>}</div>; }
function PunchIcon({ type, size = 18 }: { type: AttendancePunchType; size?: number }) { const Icon = type === 'clock_in' ? BriefcaseBusiness : type === 'break_start' ? Coffee : type === 'break_end' ? Play : LogOut; return <Icon className={`punch-icon punch-icon-${type}`} size={size} aria-hidden="true" />; }
function StatusIcon({ status, size }: { status: ReturnType<typeof summarizeAttendanceDay>['status']; size: number }) { if (status === 'working') return <BriefcaseBusiness size={size} aria-hidden="true" />; if (status === 'on_break') return <Coffee size={size} aria-hidden="true" />; if (status === 'clocked_out') return <LogOut size={size} aria-hidden="true" />; return <Clock size={size} aria-hidden="true" />; }
function DayOverview({ records }: { records: AttendanceRecordItem[] }) { return <div className="employee-day-overview">{(['clock_in', 'break_start', 'break_end', 'clock_out'] as AttendancePunchType[]).map((type) => <div className={`employee-time-block employee-time-${type}`} key={type}><span>{labels[type]}</span><strong>{records.filter((record) => record.punch_type === type).map((record) => formatMytTime(record.punched_at)).join(' · ') || '—'}</strong></div>)}</div>; }
function AttendancePhoto({ record }: { record: AttendanceRecordItem }) { const [url, setUrl] = useState(''); const [open, setOpen] = useState(false); const [failed, setFailed] = useState(false); useEffect(() => { let active = true; attendanceManagementService.getAttendancePhotoSignedUrl(record.photo_path).then((value) => { if (active) setUrl(value); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, [record.photo_path]); if (failed) return <span className="today-photo-denied">照片不可用</span>; if (!url) return <span className="today-photo-loading">加载照片...</span>; return <><button className="today-photo-thumbnail" type="button" onClick={() => setOpen(true)} aria-label="查看自己的打卡照片"><img src={url} alt={`${labels[record.punch_type]}照片`} loading="lazy" /></button>{open ? <SystemModal title="打卡照片" subtitle={`${labels[record.punch_type]} · ${formatMytDateTime(record.punched_at)}`} ariaLabel="打卡照片" onClose={() => setOpen(false)} footer={<button className="secondary-button compact-button" type="button" onClick={() => setOpen(false)}>关闭</button>}><img className="today-photo-large" src={url} alt="自己的打卡照片" /></SystemModal> : null}</>; }
function nextMytDay(date: string) { const [year, month, day] = date.split('-').map(Number); const next = new Date(Date.UTC(year, month - 1, day + 1)); return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}T00:00:00+08:00`; }
function formatMytDateTime(value: Date | string) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)); }
function formatMytTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); }
function formatMytDate(date: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T00:00:00+08:00`)); }
