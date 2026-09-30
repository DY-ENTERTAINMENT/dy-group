import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ClipboardCheck, Copy, History, RefreshCw, Search, Settings2 } from 'lucide-react';
import { MonthSelect } from '../components/MonthSelect';
import { SystemModal } from '../components/SystemModal';
import { usePermissions } from '../hooks/usePermissions';
import { creatorMonthlyKpiService, type CreatorMonthlyKpiCard, type CreatorMonthlyKpiEnrollmentStatus, type CreatorMonthlyKpiHistory, type CreatorMonthlyKpiStatus } from '../services/creator-monthly-kpi.service';
import type { CreatorPlatform } from '../services/scout.service';
import { createUuidV4 } from '../utils/uuid';

const currentMonth = malaysiaDate().slice(0, 7);
const platformLabel: Record<CreatorPlatform, string> = { tiktok: 'TikTok 流水', douyin: '抖音流水' };
const platformUnit: Record<CreatorPlatform, string> = { tiktok: '钻石', douyin: '音浪' };

export function CreatorMonthlyKpiPage() {
  const permissions = usePermissions();
  const [month, setMonth] = useState(currentMonth);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CreatorMonthlyKpiStatus>('all');
  const [managerId, setManagerId] = useState('');
  const [cards, setCards] = useState<CreatorMonthlyKpiCard[]>([]);
  const [managers, setManagers] = useState<Array<{ id: string; display_name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [updateCard, setUpdateCard] = useState<CreatorMonthlyKpiCard | null>(null);
  const [historyCard, setHistoryCard] = useState<CreatorMonthlyKpiCard | null>(null);

  const stats = useMemo(() => ({ all: cards.length, pending: cards.filter((card) => card.kpi_enrollment_status === 'required' && !card.week_updated).length, updated: cards.filter((card) => card.kpi_enrollment_status === 'required' && card.week_updated).length, achieved: cards.filter((card) => card.kpi_enrollment_status === 'required' && isAchieved(card)).length }), [cards]);
  const canUse = permissions.canUse('agent-monthly-kpi');

  async function load() {
    setLoading(true); setError('');
    try {
      const [nextCards, nextManagers] = await Promise.all([
        creatorMonthlyKpiService.listCards({ month, search, status, managerEmployeeId: permissions.isSuperAdmin ? managerId : undefined }),
        permissions.isSuperAdmin ? creatorMonthlyKpiService.listManagerOptions() : Promise.resolve([]),
      ]);
      setCards(nextCards); setManagers(nextManagers);
    } catch (loadError) { setError(messageOf(loadError)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [month, status, managerId, permissions.isSuperAdmin]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 250); return () => window.clearTimeout(timer); }, [search]);

  return <div className="creator-monthly-kpi-page page-content">
    <p className="creator-monthly-kpi-intro">时长与天数由经纪人每周累计更新；流水仅自动读取现有记录。</p>
    <section className="creator-monthly-kpi-toolbar"><MonthSelect value={month} onChange={setMonth} formatOption={formatChineseMonth} /><div className="creator-monthly-kpi-search"><Search size={16} /><input aria-label="搜索主播" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索主播 / TikTok / 抖音" /></div><select aria-label="状态" value={status} onChange={(event) => setStatus(event.target.value as CreatorMonthlyKpiStatus)}><option value="all">全部状态</option><option value="pending">待更新</option><option value="updated">本周已更新</option><option value="achieved">已达标</option></select>{permissions.isSuperAdmin ? <select aria-label="经纪人" value={managerId} onChange={(event) => setManagerId(event.target.value)}><option value="">全部经纪人</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.display_name}</option>)}</select> : null}<button type="button" className="icon-button" aria-label="刷新" onClick={() => void load()}><RefreshCw size={18} /></button>{canUse ? <button className="primary-button creator-monthly-kpi-target-button" type="button" onClick={() => setTargetsOpen(true)}><Settings2 size={16} />设置本月 KPI</button> : null}</section>
    <section className="creator-monthly-kpi-summary">{[['全部主播', stats.all], ['待更新', stats.pending], ['本周已更新', stats.updated], ['已达标', stats.achieved]].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{value}</strong></article>)}</section>
    {message ? <div className="form-success">{message}</div> : null}{error ? <div className="form-error">{error}</div> : null}
    {loading ? <div className="table-state">正在读取主播 KPI...</div> : cards.length === 0 ? <div className="table-state">暂无符合条件的主播。</div> : <section className="creator-monthly-kpi-grid">{cards.map((card) => <KpiCard key={card.creator_entity_id} card={card} onUpdate={() => setUpdateCard(card)} onHistory={() => setHistoryCard(card)} canUse={canUse} />)}</section>}
    {targetsOpen ? <TargetsModal month={month} cards={cards} managers={managers} isSuperAdmin={permissions.isSuperAdmin} onClose={() => setTargetsOpen(false)} onPartialFailure={async () => { setTargetsOpen(false); await load(); setError('KPI 状态已保存，但目标保存失败。页面已重新读取最新数据，请重新打开设置后检查并补充目标。'); }} onSaved={(text) => { setTargetsOpen(false); setMessage(text); void load(); }} /> : null}
    {updateCard ? <UpdateModal card={updateCard} month={month} onClose={() => setUpdateCard(null)} onSaved={() => { setUpdateCard(null); setMessage('本周累计已保存。'); void load(); }} /> : null}
    {historyCard ? <HistoryModal card={historyCard} month={month} onClose={() => setHistoryCard(null)} /> : null}
  </div>;
}

function KpiCard({ card, canUse, onUpdate, onHistory }: { card: CreatorMonthlyKpiCard; canUse: boolean; onUpdate: () => void; onHistory: () => void }) {
  const required = card.kpi_enrollment_status === 'required'; const achieved = required && isAchieved(card); const status = !required ? (card.kpi_enrollment_status === 'not_required' ? '本月无需 KPI' : '尚未设置 KPI') : achieved ? '已达标' : card.week_updated ? '本周已更新' : '待更新';
  return <article className="creator-monthly-kpi-card"><header><div><h2>{displayCreatorName(card)}</h2><p>{card.platforms.map((platform) => `${platform.platform === 'tiktok' ? 'TikTok' : '抖音'}：${platform.platform_account || platform.platform_user_id || '—'}`).join(' · ')}</p></div><span className={`creator-monthly-kpi-status ${required && card.week_updated ? 'is-updated' : 'is-pending'}${!required && card.kpi_enrollment_status !== 'not_required' ? ' is-unconfigured' : ''}`}>{status}</span></header><p className="creator-monthly-kpi-updated">最后更新：{card.last_updated_at ? formatDateTime(card.last_updated_at) : '—'}</p><div className="creator-monthly-kpi-table"><div className="creator-monthly-kpi-row creator-monthly-kpi-head"><span>项目</span><span>本月目标</span><span>当前完成</span><span>还差</span></div><Metric label="直播时长" target={card.live_hours_target} current={card.live_hours_current} unit="h" /><Metric label="直播天数" target={card.live_days_target} current={card.live_days_current} unit="天" />{card.platforms.map((platform) => <Metric key={platform.platform} label={platformLabel[platform.platform]} target={platform.revenue_target} current={platform.revenue_current} unit={platformUnit[platform.platform]} revenue />)}</div><small className="creator-monthly-kpi-source">流水来自主播流水记录 / 自动读取</small><footer>{canUse && required ? <button className="primary-button compact-button" type="button" onClick={onUpdate}><ClipboardCheck size={15} />更新时长/天数</button> : null}<button className="secondary-button compact-button" type="button" onClick={onHistory}><History size={15} />历史记录</button></footer></article>;
}

function Metric({ label, target, current, unit, revenue = false }: { label: string; target: number | null; current: number; unit: string; revenue?: boolean }) { const difference = target === null ? '—' : current >= target ? (current === target ? '已达标' : `超出 ${formatNumber(current - target)}${unit}`) : `${formatNumber(target - current)}${unit}`; return <div className="creator-monthly-kpi-row"><span>{label}</span><span>{target === null ? '未设置' : `${formatNumber(target)}${unit}`}</span><span>{formatNumber(current)}{unit}</span><strong className={target !== null && current >= target ? 'is-achieved' : ''}>{difference}</strong>{revenue ? null : null}</div>; }

type TargetDraft = { hours: string; days: string; platforms: Partial<Record<CreatorPlatform, string>> };
type EnrollmentDraft = { originalEnrollmentStatus: CreatorMonthlyKpiEnrollmentStatus; draftEnrollmentStatus: CreatorMonthlyKpiEnrollmentStatus; enrollmentDirty: boolean };

function TargetsModal({ month, cards, managers, isSuperAdmin, onClose, onPartialFailure, onSaved }: { month: string; cards: CreatorMonthlyKpiCard[]; managers: Array<{ id: string; display_name: string }>; isSuperAdmin: boolean; onClose: () => void; onPartialFailure: () => Promise<void>; onSaved: (text: string) => void }) {
  const [query, setQuery] = useState(''); const [modalManagerId, setModalManagerId] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [originalValues] = useState<Record<string, TargetDraft>>(() => targetDrafts(cards));
  const [values, setValues] = useState<Record<string, TargetDraft>>(() => targetDrafts(cards));
  const [enrollments, setEnrollments] = useState<Record<string, EnrollmentDraft>>(() => Object.fromEntries(cards.map((card) => [card.creator_entity_id, { originalEnrollmentStatus: card.kpi_enrollment_status, draftEnrollmentStatus: card.kpi_enrollment_status, enrollmentDirty: false }])));
  const visible = cards.filter((card) => (!modalManagerId || card.manager_employee_id === modalManagerId) && `${card.creator_name} ${card.platforms.map((platform) => `${platform.platform_account ?? ''} ${platform.platform_user_id ?? ''}`).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const targetChanged = (card: CreatorMonthlyKpiCard) => JSON.stringify(values[card.creator_entity_id]) !== JSON.stringify(originalValues[card.creator_entity_id]);
  const targetSaveCards = cards.filter((card) => {
    const enrollment = enrollments[card.creator_entity_id];
    return enrollment.draftEnrollmentStatus === 'required' && (enrollment.originalEnrollmentStatus !== 'required' || targetChanged(card));
  });
  const enrollmentChanges = cards.flatMap((card) => {
    const enrollment = enrollments[card.creator_entity_id];
    return enrollment.enrollmentDirty && enrollment.draftEnrollmentStatus ? [{ creatorEntityId: card.creator_entity_id, status: enrollment.draftEnrollmentStatus }] : [];
  });
  const hasChanges = enrollmentChanges.length > 0 || targetSaveCards.length > 0;
  const modalStats = useMemo(() => ({
    all: visible.length,
    required: visible.filter((card) => enrollments[card.creator_entity_id].draftEnrollmentStatus === 'required').length,
    unconfigured: visible.filter((card) => enrollments[card.creator_entity_id].draftEnrollmentStatus === null).length,
    notRequired: visible.filter((card) => enrollments[card.creator_entity_id].draftEnrollmentStatus === 'not_required').length,
  }), [visible, enrollments]);
  function setEnrollment(card: CreatorMonthlyKpiCard, status: CreatorMonthlyKpiEnrollmentStatus) {
    setEnrollments((current) => {
      const original = current[card.creator_entity_id].originalEnrollmentStatus;
      return { ...current, [card.creator_entity_id]: { originalEnrollmentStatus: original, draftEnrollmentStatus: status, enrollmentDirty: status !== original } };
    });
  }
  function toggleRequired(card: CreatorMonthlyKpiCard, checked: boolean) {
    const enrollment = enrollments[card.creator_entity_id];
    if (checked) setEnrollment(card, 'required');
    else setEnrollment(card, enrollment.originalEnrollmentStatus === 'required' ? 'not_required' : enrollment.originalEnrollmentStatus);
  }
  function updateValue(card: CreatorMonthlyKpiCard, update: (current: TargetDraft) => TargetDraft) { setValues((current) => ({ ...current, [card.creator_entity_id]: update(current[card.creator_entity_id]) })); }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!hasChanges) { onClose(); return; }
    setSaving(true); setError('');
    let enrollmentSaved = false;
    try {
      // The backend only accepts target saves for required enrollments, so enrollment always commits first.
      if (enrollmentChanges.length) { await creatorMonthlyKpiService.saveEnrollments(month, enrollmentChanges); enrollmentSaved = true; }
      if (targetSaveCards.length) await creatorMonthlyKpiService.saveTargets(month, targetSaveCards.map((card) => ({ creatorEntityId: card.creator_entity_id, liveHoursTarget: Number(values[card.creator_entity_id].hours), liveDaysTarget: Number(values[card.creator_entity_id].days), platformTargets: card.platforms.map((platform) => ({ platform: platform.platform, revenueTarget: Number(values[card.creator_entity_id].platforms[platform.platform]) })) })));
      onSaved('本月 KPI 已保存。');
    } catch (saveError) {
      if (enrollmentSaved && targetSaveCards.length) { await onPartialFailure(); return; }
      setError(messageOf(saveError));
    } finally { setSaving(false); }
  }
  async function copy() { setSaving(true); setError(''); try { const source = shiftMonth(month, -1); const result = await creatorMonthlyKpiService.copyPreviousMonth(source, month); onSaved(`已复制 ${result.copied} 位主播；已跳过 ${result.skipped_existing} 位已有 KPI。`); } catch (copyError) { setError(messageOf(copyError)); } finally { setSaving(false); } }
  return <SystemModal title="设置本月 KPI" subtitle={month} className="creator-monthly-kpi-modal" onClose={onClose} footer={<><div className="creator-monthly-kpi-modal-summary">共 {modalStats.all} 位主播 · 已设置 {modalStats.required} · 未设置 {modalStats.unconfigured}</div><button className="secondary-button compact-button" type="button" onClick={copy} disabled={saving}><Copy size={15} />复制上月 KPI</button><button className="primary-button compact-button" type="submit" form="creator-monthly-kpi-targets" disabled={saving || !hasChanges}>{saving ? '保存中...' : '保存 KPI'}</button></>}><form id="creator-monthly-kpi-targets" onSubmit={save}><div className={`creator-monthly-kpi-modal-filters${isSuperAdmin ? '' : ' is-agent'}`}>{isSuperAdmin ? <label className="form-field"><span>经纪人</span><select value={modalManagerId} onChange={(event) => setModalManagerId(event.target.value)}><option value="">全部经纪人</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.display_name}</option>)}</select></label> : null}<label className="form-field"><span>搜索主播</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名字 / 平台 ID / 账号" /></label></div><div className="creator-monthly-kpi-modal-stats"><span>全部主播 <strong>{modalStats.all}</strong></span><span>已设置 <strong>{modalStats.required}</strong></span><span>未设置 <strong>{modalStats.unconfigured}</strong></span><span>无需 KPI <strong>{modalStats.notRequired}</strong></span></div>{error ? <div className="form-error">{error}</div> : null}<div className="creator-monthly-kpi-target-list">{visible.map((card) => {
    const enrollment = enrollments[card.creator_entity_id]; const required = enrollment.draftEnrollmentStatus === 'required'; const notRequired = enrollment.draftEnrollmentStatus === 'not_required'; const status = required ? '已设置 KPI' : notRequired ? '无需 KPI' : '未设置 KPI'; const statusClass = required ? 'is-required' : notRequired ? 'is-not-required' : 'is-unconfigured';
    return <article key={card.creator_entity_id} className="creator-monthly-kpi-target-item"><div className="creator-monthly-kpi-target-identity"><strong>{displayCreatorName(card)}</strong><p>{card.platforms.map((platform) => `${platform.platform === 'tiktok' ? 'TikTok' : '抖音'}：${platform.platform_account || platform.platform_user_id || '—'}`).join(' · ')}</p>{isSuperAdmin && !modalManagerId && card.manager_name ? <small>经纪人：{card.manager_name}</small> : null}</div><div className="creator-monthly-kpi-target-setup"><div className="creator-monthly-kpi-target-status"><label><input type="checkbox" checked={required} onChange={(event) => toggleRequired(card, event.target.checked)} /> 本月需要 KPI</label></div>{required ? <div className="creator-monthly-kpi-target-fields"><label>时长 KPI<input required min="0" step="0.01" type="number" value={values[card.creator_entity_id].hours} onChange={(event) => updateValue(card, (current) => ({ ...current, hours: event.target.value }))} /></label><label>天数 KPI<input required min="0" step="1" type="number" value={values[card.creator_entity_id].days} onChange={(event) => updateValue(card, (current) => ({ ...current, days: event.target.value }))} /></label>{card.platforms.map((platform) => <label key={platform.platform}>{platformLabel[platform.platform]} KPI<input required min="0" step="0.01" type="number" value={values[card.creator_entity_id].platforms[platform.platform] ?? ''} onChange={(event) => updateValue(card, (current) => ({ ...current, platforms: { ...current.platforms, [platform.platform]: event.target.value } }))} /></label>)}</div> : null}</div><div className="creator-monthly-kpi-target-actions"><span className={`creator-monthly-kpi-enrollment-badge ${statusClass}`}>{status}</span><div>{enrollment.enrollmentDirty ? <button className="secondary-button compact-button" type="button" onClick={() => setEnrollment(card, enrollment.originalEnrollmentStatus)}>撤销更改</button> : null}{!required && !notRequired ? <button className="secondary-button compact-button" type="button" onClick={() => setEnrollment(card, 'not_required')}>设为本月无需 KPI</button> : null}</div></div></article>;
  })}</div></form></SystemModal>;
}

function targetDrafts(cards: CreatorMonthlyKpiCard[]): Record<string, TargetDraft> { return Object.fromEntries(cards.map((card) => [card.creator_entity_id, { hours: String(card.live_hours_target ?? ''), days: String(card.live_days_target ?? ''), platforms: Object.fromEntries(card.platforms.map((platform) => [platform.platform, String(platform.revenue_target ?? '')])) }])); }

function UpdateModal({ card, month, onClose, onSaved }: { card: CreatorMonthlyKpiCard; month: string; onClose: () => void; onSaved: () => void }) { const [hours, setHours] = useState(String(card.live_hours_current)); const [days, setDays] = useState(String(card.live_days_current)); const [noChange, setNoChange] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); async function save(event: FormEvent) { event.preventDefault(); setSaving(true); setError(''); try { await creatorMonthlyKpiService.saveWeeklyUpdate({ creatorEntityId: card.creator_entity_id, month, hours: Number(hours), days: Number(days), noChange, idempotencyKey: createUuidV4() }); onSaved(); } catch (saveError) { setError(messageOf(saveError)); } finally { setSaving(false); } } return <SystemModal title="更新时长 / 天数" subtitle={displayCreatorName(card)} onClose={onClose} footer={<button className="primary-button compact-button" type="submit" form="creator-monthly-kpi-update" disabled={saving}>{saving ? '保存中...' : '保存本周更新'}</button>}><form id="creator-monthly-kpi-update" className="form-grid" onSubmit={save}><p className="form-field-wide">本月 KPI：{card.live_hours_target ?? '—'}h / {card.live_days_target ?? '—'}天；流水会自动读取，不可在此填写。</p><label className="form-field"><span>当前累计直播时长</span><input required min="0" step="0.01" type="number" disabled={noChange} value={hours} onChange={(event) => setHours(event.target.value)} /></label><label className="form-field"><span>当前累计直播天数</span><input required min="0" step="1" type="number" disabled={noChange} value={days} onChange={(event) => setDays(event.target.value)} /></label><label className="form-field-wide"><input type="checkbox" checked={noChange} onChange={(event) => setNoChange(event.target.checked)} /> 确认本周数据无变化</label>{error ? <div className="form-error form-field-wide">{error}</div> : null}</form></SystemModal>; }

function HistoryModal({ card, month, onClose }: { card: CreatorMonthlyKpiCard; month: string; onClose: () => void }) { const [history, setHistory] = useState<CreatorMonthlyKpiHistory[]>([]); const [error, setError] = useState(''); useEffect(() => { void creatorMonthlyKpiService.getHistory(card.creator_entity_id, month).then(setHistory).catch((historyError) => setError(messageOf(historyError))); }, [card.creator_entity_id, month]); return <SystemModal title="KPI 历史记录" subtitle={`${displayCreatorName(card)} · ${month}`} onClose={onClose} footer={<button className="secondary-button compact-button" type="button" onClick={onClose}>关闭</button>}>{error ? <div className="form-error">{error}</div> : history.length === 0 ? <div className="table-state">暂无周更新记录。</div> : <div className="creator-monthly-kpi-history">{history.map((item) => <article key={item.id}><strong>{item.week_start_date}</strong><span>{item.live_hours_cumulative}h / {item.live_days_cumulative}天</span><span>{item.update_kind === 'confirmed_no_change' ? '确认本周无变化' : '已提交'} · {item.updated_by_name || '—'}</span><small>{formatDateTime(item.created_at)}</small></article>)}</div>}</SystemModal>; }

function isAchieved(card: CreatorMonthlyKpiCard) { return card.live_hours_target !== null && card.live_days_target !== null && card.live_hours_current >= card.live_hours_target && card.live_days_current >= card.live_days_target && card.platforms.every((platform) => platform.revenue_target !== null && platform.revenue_current >= platform.revenue_target); }
function displayCreatorName(card: CreatorMonthlyKpiCard) { return validDisplayValue(card.creator_name) ?? card.platforms.map((platform) => validDisplayValue(platform.platform_account)).find(Boolean) ?? card.platforms.map((platform) => validDisplayValue(platform.platform_user_id)).find(Boolean) ?? '未命名主播'; }
function validDisplayValue(value: string | null | undefined) { const normalized = value?.trim(); return normalized && normalized !== '-' ? normalized : null; }
function formatNumber(value: number) { return Number(value || 0).toLocaleString('en-MY', { maximumFractionDigits: 2 }); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(value)); }
function malaysiaDate() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])); return `${map.year}-${map.month}-${map.day}`; }
function shiftMonth(month: string, offset: number) { const [year, number] = month.split('-').map(Number); const date = new Date(year, number - 1 + offset, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function formatChineseMonth(month: string) { const [year, number] = month.split('-').map(Number); return Number.isFinite(year) && Number.isFinite(number) ? `${year}年${number}月` : month; }
function messageOf(error: unknown) { return error instanceof Error ? error.message : '操作失败，请稍后重试。'; }
