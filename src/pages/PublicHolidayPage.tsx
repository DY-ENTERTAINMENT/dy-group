import { useEffect, useMemo, useState } from 'react';
import { Edit3, Plus, Search, Trash2 } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import {
  GLOBAL_REGION_VALUE,
  type PublicHolidayFormValues,
  type PublicHolidayListItem,
  publicHolidayService,
} from '../services/public-holiday.service';
import type { Region } from '../types/database';
import { usePermissions } from '../hooks/usePermissions';
import {
  companyActivityService,
  GLOBAL_REGION_VALUE as ACTIVITY_GLOBAL_REGION_VALUE,
  type CompanyActivityFormValues,
  type CompanyActivityListItem,
} from '../services/company-activity.service';

const emptyForm: PublicHolidayFormValues = {
  holiday_name: '',
  holiday_date: '',
  region_id: '',
  note: '',
};

export function PublicHolidayPage() {
  const permissions = usePermissions();
  const canUsePublicHolidays = permissions.canUse('public-holidays');
  const [year, setYear] = useState(new Date().getFullYear());
  const [regionFilter, setRegionFilter] = useState('');
  const [search, setSearch] = useState('');
  const [regions, setRegions] = useState<Region[]>([]);
  const [holidays, setHolidays] = useState<PublicHolidayListItem[]>([]);
  const [formValues, setFormValues] = useState<PublicHolidayFormValues>(emptyForm);
  const [editingHoliday, setEditingHoliday] = useState<PublicHolidayListItem | null>(null);
  const [deletingHoliday, setDeletingHoliday] = useState<PublicHolidayListItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'holidays' | 'activities'>('holidays');

  const filteredHolidays = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return holidays;

    return holidays.filter((holiday) =>
      [holiday.holiday_name, holiday.note, holiday.region?.code, holiday.region?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  }, [holidays, search]);

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    void loadHolidays();
  }, [year, regionFilter]);

  async function loadInitialData() {
    try {
      const regionOptions = await publicHolidayService.getRegions();
      setRegions(regionOptions);
    } catch (loadError) {
      setError(`读取区域失败：${getErrorMessage(loadError)}`);
    }
  }

  async function loadHolidays() {
    setLoading(true);
    setError('');

    try {
      const holidayList = await publicHolidayService.listPublicHolidays(year, regionFilter);
      setHolidays(holidayList);
    } catch (loadError) {
      setError(`读取公共假期失败：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setEditingHoliday(null);
    setFormValues({
      ...emptyForm,
      holiday_date: `${year}-01-01`,
    });
    setFormOpen(true);
    setError('');
    setMessage('');
  }

  function openEditModal(holiday: PublicHolidayListItem) {
    setEditingHoliday(holiday);
    setFormValues({
      holiday_name: holiday.holiday_name,
      holiday_date: holiday.holiday_date,
      region_id: holiday.region_id ?? '',
      note: holiday.note ?? '',
    });
    setFormOpen(true);
    setError('');
    setMessage('');
  }

  async function handleSubmit() {
    const holidayName = formValues.holiday_name.trim();
    if (!holidayName) {
      setError('请填写假期名称。');
      return;
    }

    if (!formValues.holiday_date) {
      setError('请选择日期。');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      if (editingHoliday) {
        await publicHolidayService.updatePublicHoliday(editingHoliday.id, formValues);
        setMessage('公共假期已更新。');
      } else {
        await publicHolidayService.createPublicHoliday(formValues);
        setMessage('公共假期已新增。');
      }

      setFormOpen(false);
      setEditingHoliday(null);
      await loadHolidays();
    } catch (saveError) {
      setError(`保存公共假期失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingHoliday) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await publicHolidayService.deletePublicHoliday(deletingHoliday.id);
      setMessage('公共假期已删除。');
      setDeletingHoliday(null);
      await loadHolidays();
    } catch (deleteError) {
      setError(`删除公共假期失败：${getErrorMessage(deleteError)}`);
    } finally {
      setSaving(false);
    }
  }

  if (activeTab === 'activities') {
    return <CompanyActivityPanel canManage={canUsePublicHolidays} regions={regions} onBack={() => setActiveTab('holidays')} />;
  }

  return (
    <section className="public-holiday-page">
      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <div className="staff-list-panel">
        <div className="list-header public-holiday-header holiday-management-header">
          <div className="holiday-management-title">
            <span>人事部</span>
            <h3>公共假期</h3>
            <div className="row-actions holiday-management-tabs">
              <button className="secondary-button compact-button" type="button">公共假期</button>
              <button className="secondary-button compact-button" type="button" onClick={() => setActiveTab('activities')}>公司活动</button>
            </div>
          </div>
          {canUsePublicHolidays ? (
            <button className="primary-button compact-button holiday-management-create-button" type="button" onClick={openCreateModal}>
              <Plus size={16} />
              新增公共假期
            </button>
          ) : null}
        </div>

        <div className="attendance-filters public-holiday-filters">
          <label className="form-field">
            <span>年份</span>
            <input
              type="number"
              min="2020"
              max="2100"
              value={year}
              onChange={(event) => setYear(Number(event.target.value) || new Date().getFullYear())}
            />
          </label>

          <label className="form-field">
            <span>区域</span>
            <select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
              <option value="">全部记录</option>
              <option value={GLOBAL_REGION_VALUE}>全部区域</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.code}
                </option>
              ))}
            </select>
          </label>

          <label className="table-search public-holiday-search">
            <Search size={16} />
            <input
              type="search"
              placeholder="搜索假期名称、备注、区域"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        {loading ? (
          <div className="table-state">正在读取公共假期...</div>
        ) : filteredHolidays.length === 0 ? (
          <div className="table-state">暂无公共假期。</div>
        ) : (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>假期名称</th>
                  <th>日期</th>
                  <th>区域</th>
                  <th>备注</th>
                  {canUsePublicHolidays ? <th>操作</th> : null}
                </tr>
              </thead>
              <tbody>
                {filteredHolidays.map((holiday) => (
                  <tr key={holiday.id}>
                    <td>
                      <strong>{holiday.holiday_name}</strong>
                    </td>
                    <td>{formatDate(holiday.holiday_date)}</td>
                    <td>{formatRegion(holiday)}</td>
                    <td>{holiday.note || '-'}</td>
                    {canUsePublicHolidays ? (
                      <td>
                        <div className="row-actions">
                          <button className="secondary-button compact-button" type="button" onClick={() => openEditModal(holiday)}>
                            <Edit3 size={15} />
                            编辑
                          </button>
                          <button
                            className="secondary-button compact-button danger-text-button"
                            type="button"
                            onClick={() => setDeletingHoliday(holiday)}
                          >
                            <Trash2 size={15} />
                            删除
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formOpen ? (
        <SystemModal
          title={editingHoliday ? '编辑公共假期' : '新增公共假期'}
          ariaLabel={editingHoliday ? '编辑公共假期' : '新增公共假期'}
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <button className="secondary-button compact-button" type="button" onClick={() => setFormOpen(false)} disabled={saving}>
                关闭
              </button>
              <button className="primary-button compact-button" type="button" onClick={handleSubmit} disabled={saving}>
                保存
              </button>
            </>
          }
        >
          <div className="form-grid single">
            <label className="form-field">
              <span>假期名称</span>
              <input
                value={formValues.holiday_name}
                onChange={(event) => setFormValues((current) => ({ ...current, holiday_name: event.target.value }))}
                placeholder="例如 Christmas"
              />
            </label>

            <label className="form-field">
              <span>日期</span>
              <input
                type="date"
                value={formValues.holiday_date}
                onChange={(event) => setFormValues((current) => ({ ...current, holiday_date: event.target.value }))}
              />
            </label>

            <label className="form-field">
              <span>适用区域</span>
              <select
                value={formValues.region_id}
                onChange={(event) => setFormValues((current) => ({ ...current, region_id: event.target.value }))}
              >
                <option value="">全部区域</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.code}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              <span>备注（可选）</span>
              <textarea
                value={formValues.note}
                onChange={(event) => setFormValues((current) => ({ ...current, note: event.target.value }))}
                rows={3}
                placeholder="例如 Gawai Day 1"
              />
            </label>
          </div>
        </SystemModal>
      ) : null}

      {deletingHoliday ? (
        <SystemModal
          title="删除公共假期"
          ariaLabel="删除公共假期"
          onClose={() => setDeletingHoliday(null)}
          footer={
            <>
              <button className="secondary-button compact-button" type="button" onClick={() => setDeletingHoliday(null)} disabled={saving}>
                关闭
              </button>
              <button className="primary-button compact-button danger-action-button" type="button" onClick={handleDelete} disabled={saving}>
                确认删除
              </button>
            </>
          }
        >
          <div className="cancel-leave-confirm">
            <p>确定要删除这个公共假期吗？</p>
            <span className="muted-text">删除后休假日历将不再显示该假期。</span>
          </div>
        </SystemModal>
      ) : null}
    </section>
  );
}

function CompanyActivityPanel({ canManage, regions, onBack }: { canManage: boolean; regions: Region[]; onBack: () => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [regionFilter, setRegionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'active' | 'voided'>('all');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<CompanyActivityListItem[]>([]);
  const [editing, setEditing] = useState<CompanyActivityListItem | null>(null);
  const [form, setForm] = useState<CompanyActivityFormValues>({ activity_name: '', activity_date: '', region_id: '', notes: '' });
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const today = getTodayDateKey();
    return items.filter((item) => (statusFilter === 'all' || getCompanyActivityDisplayStatus(item, today).key === statusFilter) && (!keyword || [item.activity_name, item.notes, item.region?.code, item.region?.name].filter(Boolean).join(' ').toLowerCase().includes(keyword)));
  }, [items, search, statusFilter]);

  async function load() {
    setLoading(true); setError('');
    try { setItems(await companyActivityService.list(year, regionFilter)); }
    catch (loadError) { setError(`读取公司活动失败：${getErrorMessage(loadError)}`); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [year, regionFilter]);

  function openCreate() {
    setEditing(null); setForm({ activity_name: '', activity_date: `${year}-01-01`, region_id: '', notes: '' }); setFormOpen(true); setError(''); setMessage('');
  }
  function openEdit(item: CompanyActivityListItem) {
    setEditing(item); setForm({ activity_name: item.activity_name, activity_date: item.activity_date, region_id: item.region_id ?? '', notes: item.notes ?? '' }); setFormOpen(true); setError(''); setMessage('');
  }
  async function save() {
    if (!form.activity_name.trim() || !form.activity_date) { setError('请填写活动名称和日期。'); return; }
    setSaving(true); setError('');
    try { if (editing) await companyActivityService.update(editing.id, form); else await companyActivityService.create(form); setFormOpen(false); setMessage('公司活动已保存。'); await load(); }
    catch (saveError) { setError(`保存公司活动失败：${getErrorMessage(saveError)}`); }
    finally { setSaving(false); }
  }
  async function voidItem(item: CompanyActivityListItem) {
    if (!window.confirm(`确定作废「${item.activity_name}」吗？`)) return;
    setSaving(true); setError('');
    try { await companyActivityService.void(item.id); setMessage('公司活动已取消。'); await load(); }
    catch (voidError) { setError(`取消公司活动失败：${getErrorMessage(voidError)}`); }
    finally { setSaving(false); }
  }

  return <section className="public-holiday-page company-activity-page">
    {error ? <p className="form-alert">{error}</p> : null}
    {message ? <p className="form-success">{message}</p> : null}
    <div className="staff-list-panel company-activity-panel">
      <div className="company-activity-tabs" role="tablist" aria-label="假期与公司活动">
        <button className="company-activity-tab" type="button" role="tab" aria-selected="false" onClick={onBack}>公共假期</button>
        <button className="company-activity-tab is-active" type="button" role="tab" aria-selected="true">公司活动</button>
      </div>
      <div className="company-activity-heading">
        <div><span>人事部</span><h3>公司活动</h3></div>
      </div>
      <div className="company-activity-notice">公司活动日当天，员工无需打卡，系统将自动记为正常出勤，不会产生缺卡或旷工。</div>
      <div className="company-activity-toolbar">
        <div className="company-activity-filters">
          <label className="form-field"><span>年份</span><input type="number" min="2020" max="2100" value={year} onChange={(event) => setYear(Number(event.target.value) || new Date().getFullYear())} /></label>
          <label className="form-field"><span>区域</span><select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}><option value="">全部区域</option><option value={ACTIVITY_GLOBAL_REGION_VALUE}>全部区域（全局）</option>{regions.map((region) => <option key={region.id} value={region.id}>{region.code}</option>)}</select></label>
          <label className="form-field"><span>状态</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | 'pending' | 'active' | 'voided')}><option value="all">全部状态</option><option value="pending">待生效</option><option value="active">已生效</option><option value="voided">已取消</option></select></label>
          <label className="table-search company-activity-search"><Search size={16} /><input type="search" placeholder="搜索活动名称/备注" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>
        {canManage ? <button className="primary-button compact-button company-activity-create-button" type="button" onClick={openCreate}><Plus size={16} />新增公司活动</button> : null}
      </div>
      <div className="staff-table-wrap company-activity-table-wrap">
        <table className="staff-table company-activity-table">
          <thead><tr><th>活动名称</th><th>日期</th><th>区域</th><th>适用范围</th><th>考勤规则</th><th>出勤计算</th><th>备注</th><th>状态</th>{canManage ? <th>操作</th> : null}</tr></thead>
          <tbody>{loading ? <tr><td className="company-activity-empty" colSpan={canManage ? 9 : 8}>正在读取公司活动...</td></tr> : filtered.length === 0 ? <tr><td className="company-activity-empty" colSpan={canManage ? 9 : 8}>暂无公司活动</td></tr> : filtered.map((item) => { const status = getCompanyActivityDisplayStatus(item, getTodayDateKey()); return <tr key={item.id}><td><strong>{item.activity_name}</strong></td><td>{formatDate(item.activity_date)}</td><td>{item.region?.code ?? '全部区域'}</td><td>全员</td><td>免打卡</td><td>正常出勤</td><td>{item.notes || '-'}</td><td><span className={`status-pill company-activity-status is-${status.key}`}>{status.label}</span></td>{canManage ? <td>{item.status === 'voided' ? <span className="muted-text">已取消</span> : <div className="row-actions"><button className="secondary-button compact-button" type="button" onClick={() => openEdit(item)} disabled={saving}><Edit3 size={15} />编辑</button><button className="secondary-button compact-button danger-text-button" type="button" onClick={() => voidItem(item)} disabled={saving}>取消活动</button></div>}</td> : null}</tr>; })}</tbody>
        </table>
      </div>
      <div className="company-activity-record-count">共 {filtered.length} 条公司活动记录</div>
    </div>
    <aside className="company-activity-guide"><h4>说明</h4><ul><li>公司活动日适用于公司安排的集体活动、培训、外勤等情况。</li><li>活动日内，符合区域范围的员工无需打卡，系统按正常出勤处理。</li><li>如需取消尚未/已经创建的活动，使用现有作废机制，不物理删除历史记录。</li></ul></aside>
    {formOpen ? <SystemModal title={editing ? '编辑公司活动' : '新增公司活动'} ariaLabel="公司活动" onClose={() => setFormOpen(false)} footer={<><button className="secondary-button compact-button" type="button" onClick={() => setFormOpen(false)} disabled={saving}>关闭</button><button className="primary-button compact-button" type="button" onClick={save} disabled={saving}>保存</button></>}><div className="form-grid single"><label className="form-field"><span>活动名称</span><input value={form.activity_name} onChange={(event) => setForm((current) => ({ ...current, activity_name: event.target.value }))} /></label><label className="form-field"><span>日期</span><input type="date" value={form.activity_date} onChange={(event) => setForm((current) => ({ ...current, activity_date: event.target.value }))} /></label><label className="form-field"><span>适用区域</span><select value={form.region_id} onChange={(event) => setForm((current) => ({ ...current, region_id: event.target.value }))}><option value="">全部区域</option>{regions.map((region) => <option key={region.id} value={region.id}>{region.code}</option>)}</select></label><label className="form-field"><span>备注（可选）</span><textarea rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label></div></SystemModal> : null}
  </section>;
}

function getCompanyActivityDisplayStatus(item: CompanyActivityListItem, today: string) {
  if (item.status === 'voided') return { key: 'voided' as const, label: '已取消' };
  return item.activity_date > today
    ? { key: 'pending' as const, label: '待生效' }
    : { key: 'active' as const, label: '已生效' };
}

function getTodayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatRegion(holiday: PublicHolidayListItem) {
  return holiday.region?.code ?? '全部区域';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(`${value}T00:00:00`));
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
