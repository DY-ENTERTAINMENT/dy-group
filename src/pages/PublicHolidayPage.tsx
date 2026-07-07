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

  return (
    <section className="public-holiday-page">
      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <div className="staff-list-panel">
        <div className="list-header public-holiday-header">
          <div>
            <span>人事部</span>
            <h3>公共假期</h3>
          </div>
          {canUsePublicHolidays ? (
            <button className="primary-button compact-button" type="button" onClick={openCreateModal}>
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
