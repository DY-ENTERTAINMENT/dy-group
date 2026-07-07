import { useEffect, useMemo, useState } from 'react';
import { Edit3, LocateFixed, MapPin, Plus, Search, Trash2 } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import { usePermissions } from '../hooks/usePermissions';
import {
  ATTENDANCE_RADIUS_OPTIONS,
  calculateDistanceMeters,
  emptyAttendanceLocationForm,
  type AttendanceLocationFormValues,
  type AttendanceLocationListItem,
  attendanceLocationService,
  getBrowserGeoPosition,
} from '../services/attendance-location.service';
import type { Region } from '../types/database';

export function AttendanceLocationPage() {
  const permissions = usePermissions();
  const canUseAttendanceLocations = permissions.canUse('attendance-locations');
  const [regions, setRegions] = useState<Region[]>([]);
  const [locations, setLocations] = useState<AttendanceLocationListItem[]>([]);
  const [regionFilter, setRegionFilter] = useState('');
  const [search, setSearch] = useState('');
  const [formValues, setFormValues] = useState<AttendanceLocationFormValues>(emptyAttendanceLocationForm);
  const [editingLocation, setEditingLocation] = useState<AttendanceLocationListItem | null>(null);
  const [deletingLocation, setDeletingLocation] = useState<AttendanceLocationListItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [testingLocationId, setTestingLocationId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const filteredLocations = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return locations;

    return locations.filter((location) =>
      [location.name, location.region?.code, location.region?.name, location.is_active ? 'active' : 'inactive']
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  }, [locations, search]);

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    void loadLocations();
  }, [regionFilter]);

  async function loadInitialData() {
    try {
      const regionOptions = await attendanceLocationService.getRegions();
      setRegions(regionOptions);
    } catch (loadError) {
      setError(`读取区域失败：${getErrorMessage(loadError)}`);
    }
  }

  async function loadLocations() {
    setLoading(true);
    setError('');

    try {
      const locationList = await attendanceLocationService.listAttendanceLocations(regionFilter);
      setLocations(locationList);
    } catch (loadError) {
      setError(`读取打卡地点失败：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setEditingLocation(null);
    setFormValues(emptyAttendanceLocationForm);
    setFormOpen(true);
    setError('');
    setMessage('');
  }

  function openEditModal(location: AttendanceLocationListItem) {
    setEditingLocation(location);
    setFormValues({
      name: location.name,
      region_id: location.region_id,
      latitude: location.latitude,
      longitude: location.longitude,
      radius_meters: location.radius_meters,
      is_active: location.is_active,
    });
    setFormOpen(true);
    setError('');
    setMessage('');
  }

  async function handleUseCurrentLocation() {
    setLocating(true);
    setError('');
    setMessage('');

    try {
      const position = await getBrowserGeoPosition();
      setFormValues((current) => ({
        ...current,
        latitude: position.latitude,
        longitude: position.longitude,
      }));
      setMessage(`已取得当前位置，GPS 精度约 ${Math.round(position.accuracy ?? 0)} 米。`);
    } catch (locationError) {
      setError(getErrorMessage(locationError));
    } finally {
      setLocating(false);
    }
  }

  async function handleTestLocation(location: AttendanceLocationListItem) {
    setTestingLocationId(location.id);
    setError('');
    setMessage('');

    try {
      const position = await getBrowserGeoPosition();
      const distance = calculateDistanceMeters(position.latitude, position.longitude, location.latitude, location.longitude);
      const roundedDistance = Math.round(distance);
      const result = distance <= location.radius_meters ? '可以打卡' : '超出允许打卡范围';
      setMessage(
        `当前位置距离 ${location.name}：${roundedDistance} 米。允许范围：${location.radius_meters} 米。结果：${result}。`,
      );
    } catch (locationError) {
      setError(getErrorMessage(locationError));
    } finally {
      setTestingLocationId(null);
    }
  }

  async function handleSubmit() {
    if (!formValues.name.trim()) {
      setError('请填写地点名称。');
      return;
    }

    if (!formValues.region_id) {
      setError('请选择所属区域。');
      return;
    }

    if (formValues.latitude === null || formValues.longitude === null) {
      setError('请先点击使用当前位置或重新定位。');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      if (editingLocation) {
        await attendanceLocationService.updateAttendanceLocation(editingLocation.id, formValues);
        setMessage('打卡地点已更新。');
      } else {
        await attendanceLocationService.createAttendanceLocation(formValues);
        setMessage('打卡地点已新增。');
      }

      setFormOpen(false);
      setEditingLocation(null);
      await loadLocations();
    } catch (saveError) {
      console.error('Failed to save attendance location', saveError);
      setError(`保存打卡地点失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingLocation) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await attendanceLocationService.deleteAttendanceLocation(deletingLocation.id);
      setMessage('打卡地点已删除。');
      setDeletingLocation(null);
      await loadLocations();
    } catch (deleteError) {
      console.error('Failed to delete attendance location', deleteError);
      setError(`删除打卡地点失败：${getErrorMessage(deleteError)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="attendance-location-page">
      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <div className="staff-list-panel">
        <div className="list-header public-holiday-header">
          <div>
            <span>人事部</span>
            <h3>打卡地点</h3>
          </div>
          {canUseAttendanceLocations ? (
            <button className="primary-button compact-button" type="button" onClick={openCreateModal}>
              <Plus size={16} />
              新增打卡地点
            </button>
          ) : null}
        </div>

        <div className="attendance-filters public-holiday-filters">
          <label className="form-field">
            <span>区域</span>
            <select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
              <option value="">全部区域</option>
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
              placeholder="搜索地点名称、区域"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        {loading ? (
          <div className="table-state">正在读取打卡地点...</div>
        ) : filteredLocations.length === 0 ? (
          <div className="table-state">暂无打卡地点。</div>
        ) : (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>地点名称</th>
                  <th>区域</th>
                  <th>定位</th>
                  <th>允许范围</th>
                  <th>状态</th>
                  {canUseAttendanceLocations ? <th>操作</th> : null}
                </tr>
              </thead>
              <tbody>
                {filteredLocations.map((location) => (
                  <tr key={location.id}>
                    <td>
                      <strong>{location.name}</strong>
                    </td>
                    <td>{location.region?.code ?? '-'}</td>
                    <td>
                      {formatCoordinate(location.latitude)}, {formatCoordinate(location.longitude)}
                    </td>
                    <td>{location.radius_meters} 米</td>
                    <td>{location.is_active ? '启用' : '停用'}</td>
                    {canUseAttendanceLocations ? (
                      <td>
                        <div className="row-actions">
                          <button
                            className="secondary-button compact-button"
                            type="button"
                            onClick={() => handleTestLocation(location)}
                            disabled={testingLocationId === location.id}
                          >
                            <LocateFixed size={15} />
                            {testingLocationId === location.id ? '测试中...' : '测试当前位置'}
                          </button>
                          <button className="secondary-button compact-button" type="button" onClick={() => openEditModal(location)}>
                            <Edit3 size={15} />
                            编辑
                          </button>
                          <button
                            className="secondary-button compact-button danger-text-button"
                            type="button"
                            onClick={() => setDeletingLocation(location)}
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
          title={editingLocation ? '编辑打卡地点' : '新增打卡地点'}
          ariaLabel={editingLocation ? '编辑打卡地点' : '新增打卡地点'}
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <button className="secondary-button compact-button" type="button" onClick={() => setFormOpen(false)} disabled={saving}>
                关闭
              </button>
              <button className="secondary-button compact-button" type="button" onClick={handleUseCurrentLocation} disabled={saving || locating}>
                <MapPin size={15} />
                {editingLocation ? '重新定位' : '使用当前位置'}
              </button>
              <button className="primary-button compact-button" type="button" onClick={handleSubmit} disabled={saving || locating}>
                保存
              </button>
            </>
          }
        >
          <div className="form-grid single">
            <label className="form-field">
              <span>地点名称</span>
              <input
                value={formValues.name}
                onChange={(event) => setFormValues((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如 DY Group Kuching Office"
              />
            </label>

            <label className="form-field">
              <span>所属区域</span>
              <select
                value={formValues.region_id}
                onChange={(event) => setFormValues((current) => ({ ...current, region_id: event.target.value }))}
              >
                <option value="">请选择区域</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.code}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-field">
              <span>当前定位</span>
              <div className="location-preview">
                {formValues.latitude === null || formValues.longitude === null ? (
                  <span className="muted-text">尚未取得定位，请点击使用当前位置。</span>
                ) : (
                  <>
                    <strong>Latitude：{formatCoordinate(formValues.latitude)}</strong>
                    <strong>Longitude：{formatCoordinate(formValues.longitude)}</strong>
                  </>
                )}
              </div>
            </div>

            <label className="form-field">
              <span>允许范围</span>
              <select
                value={formValues.radius_meters}
                onChange={(event) =>
                  setFormValues((current) => ({ ...current, radius_meters: Number(event.target.value) || 200 }))
                }
              >
                {ATTENDANCE_RADIUS_OPTIONS.map((radius) => (
                  <option key={radius} value={radius}>
                    {radius} 米
                  </option>
                ))}
              </select>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={formValues.is_active}
                onChange={(event) => setFormValues((current) => ({ ...current, is_active: event.target.checked }))}
              />
              <span>启用</span>
            </label>
          </div>
        </SystemModal>
      ) : null}

      {deletingLocation ? (
        <SystemModal
          title="删除打卡地点"
          ariaLabel="删除打卡地点"
          onClose={() => setDeletingLocation(null)}
          footer={
            <>
              <button className="secondary-button compact-button" type="button" onClick={() => setDeletingLocation(null)} disabled={saving}>
                关闭
              </button>
              <button className="primary-button compact-button danger-action-button" type="button" onClick={handleDelete} disabled={saving}>
                确认删除
              </button>
            </>
          }
        >
          <div className="cancel-leave-confirm">
            <p>确定要删除这个打卡地点吗？</p>
            <span className="muted-text">删除后，该区域员工将无法使用这个地点通过打卡定位校验。</span>
          </div>
        </SystemModal>
      ) : null}
    </section>
  );
}

function formatCoordinate(value: number) {
  return Number(value).toFixed(7);
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
