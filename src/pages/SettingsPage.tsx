import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Edit3, Plus, RefreshCw, Search, Settings2, ShieldCheck, ToggleLeft, ToggleRight } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { SystemModal } from '../components/SystemModal';
import { useAuth } from '../hooks/useAuth';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { type SettingsFormValues, type SettingsModuleKey, type SettingsRecord, settingsService } from '../services/settings.service';
import { type EmployeeListItem, type StaffOptions, staffService } from '../services/staff.service';
import { type SpecialPermissionTemplate, permissionManagementService } from '../services/permission-management.service';
import {
  type RegionPermissionMatrixRow,
  managedRegionFeaturePermissions,
  regionPermissionSettingsService,
} from '../services/region-permission-settings.service';
import type { RegionFeaturePermissionKey } from '../services/permission-runtime.service';
import { menuItems } from '../routes/menu';

type SettingsModule = {
  key: SettingsModuleKey | 'permissions' | 'region_permissions';
  title: string;
  description: string;
  nameLabel: string;
  hasCode?: boolean;
};

const modules: SettingsModule[] = [
  {
    key: 'regions',
    title: '区域管理',
    description: '管理古晋、吉隆坡等运营区域。',
    nameLabel: '区域名称',
    hasCode: true,
  },
  {
    key: 'job_titles',
    title: '职称管理',
    description: '维护员工职位与组织称谓。',
    nameLabel: '职称名称',
  },
  {
    key: 'employment_types',
    title: '雇佣类型管理',
    description: '维护全职、兼职、自由业者等雇佣类型。',
    nameLabel: '类型名称',
  },
  {
    key: 'permissions',
    title: '权限管理',
    description: '此模块将在员工资料与组织架构稳定后开放。',
    nameLabel: '权限名称',
  },
  {
    key: 'region_permissions',
    title: '地区功能权限',
    description: '管理不同地区是否开放指定功能。',
    nameLabel: '功能权限',
  },
];

const settingsTabAliases: Record<string, SettingsModule['key']> = {
  regions: 'regions',
  job_titles: 'job_titles',
  positions: 'job_titles',
  employment_types: 'employment_types',
  permissions: 'permissions',
  region_permissions: 'region_permissions',
};

const settingsTabParams: Record<SettingsModule['key'], string> = {
  regions: 'regions',
  job_titles: 'positions',
  employment_types: 'employment_types',
  permissions: 'permissions',
  region_permissions: 'region_permissions',
};

const emptyForm: SettingsFormValues = {
  code: '',
  name: '',
  company_english_name: '',
  company_registration_no: '',
  company_instagram: '',
  company_facebook: '',
  sort_order: 0,
  is_active: true,
};

type PermissionAccess = {
  view: boolean;
  use: boolean;
};

type PermissionState = Record<string, PermissionAccess>;

type PermissionItem = {
  key: string;
  name: string;
  parentKey: string | null;
  level: number;
  disabled?: boolean;
};

type PermissionModalTarget =
  | { type: 'jobTitle'; id: string; title: string; subtitle: string }
  | { type: 'special'; title: string; subtitle: string }
  | { type: 'employee'; employee: EmployeeListItem };

type PermissionTabKey = 'jobTitles' | 'special' | 'employees';

const permissionTabAliases: Record<string, PermissionTabKey> = {
  job_titles: 'jobTitles',
  positions: 'jobTitles',
  special: 'special',
  employees: 'employees',
};

const permissionTabParams: Record<PermissionTabKey, string> = {
  jobTitles: 'positions',
  special: 'special',
  employees: 'employees',
};

const employeeStatusLabels: Record<string, string> = {
  active: '在职',
  probation: '试用期',
  inactive: '停职',
  suspended: '停职',
  left: '离职',
};
const employeeStatusOrder: Record<string, number> = {
  active: 0,
  probation: 1,
  inactive: 2,
  suspended: 2,
  left: 3,
};
const reservedPermissionKeys = new Set(['settings']);
const permissionGroupKeys: Record<string, string> = {
  星探: 'scout',
  经纪人: 'agent',
  美工: 'designer',
  人事部: 'hr',
  管理: 'management',
};

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile } = useAuth();
  const [activeModuleKey, setActiveModuleKey] = useState<SettingsModule['key']>(() => getSettingsTabFromParams(searchParams));
  const [records, setRecords] = useState<SettingsRecord[]>([]);
  const [editingRecord, setEditingRecord] = useState<SettingsRecord | null>(null);
  const [formValues, setFormValues] = useState<SettingsFormValues>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const visibleModules = useMemo(
    () => (profile?.role === 'super_admin' ? modules : modules.filter((moduleItem) => moduleItem.key !== 'region_permissions')),
    [profile?.role],
  );
  const activeModule = useMemo(
    () => visibleModules.find((moduleItem) => moduleItem.key === activeModuleKey) ?? visibleModules[0] ?? modules[0],
    [activeModuleKey, visibleModules],
  );
  const isPermissionModule = activeModuleKey === 'permissions';
  const isRegionPermissionsModule = activeModuleKey === 'region_permissions' && profile?.role === 'super_admin';

  useEffect(() => {
    if (isSettingsDataModule(activeModuleKey)) {
      void loadSettings(activeModuleKey);
    } else {
      setRecords([]);
      setLoading(false);
      setError('');
    }
  }, [activeModuleKey]);

  useEffect(() => {
    const nextTab = getSettingsTabFromParams(searchParams);
    if (nextTab !== activeModuleKey) {
      setActiveModuleKey(nextTab);
      closeForm();
    }
  }, [searchParams]);

  usePullToRefresh(() => loadSettings(activeModuleKey), [activeModuleKey]);

  async function loadSettings(moduleKey = activeModuleKey) {
    if (!isSettingsDataModule(moduleKey)) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const settings = await settingsService.listSettings(moduleKey);
      setRecords(settings);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取系统设置失败。');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isSettingsDataModule(activeModuleKey)) {
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      if (editingRecord) {
        await settingsService.updateSetting(activeModuleKey, editingRecord.id, formValues);
        setMessage('设置已更新。');
      } else {
        await settingsService.createSetting(activeModuleKey, formValues);
        setMessage('设置已新增。');
      }

      closeForm();
      await loadSettings(activeModuleKey);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存系统设置失败。');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(record: SettingsRecord) {
    if (!isSettingsDataModule(activeModuleKey)) {
      return;
    }

    setError('');
    setMessage('');

    try {
      await settingsService.toggleSetting(activeModuleKey, record.id, !record.is_active);
      setMessage(record.is_active ? '已停用。' : '已启用。');
      await loadSettings(activeModuleKey);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : '更新启用状态失败。');
    }
  }

  function openCreate() {
    setEditingRecord(null);
    setFormValues(emptyForm);
    setFormOpen(true);
    setMessage('');
    setError('');
  }

  function handleEdit(record: SettingsRecord) {
    setEditingRecord(record);
    setMessage('');
    setError('');
    setFormValues({
      code: 'code' in record ? record.code : '',
      name: record.name,
      company_english_name: 'company_english_name' in record ? record.company_english_name ?? '' : '',
      company_registration_no: 'company_registration_no' in record ? record.company_registration_no ?? '' : '',
      company_instagram: 'company_instagram' in record ? record.company_instagram ?? '' : '',
      company_facebook: 'company_facebook' in record ? record.company_facebook ?? '' : '',
      sort_order: record.sort_order,
      is_active: record.is_active,
    });
    setFormOpen(true);
  }

  function handleModuleChange(moduleKey: SettingsModule['key']) {
    setActiveModuleKey(moduleKey);
    setSearchParams({ tab: settingsTabParams[moduleKey] });
    closeForm();
  }

  function closeForm() {
    setEditingRecord(null);
    setFormValues(emptyForm);
    setFormOpen(false);
  }

  return (
    <section className="settings-page">
      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <div className="settings-tabs" role="tablist" aria-label="系统设置模块">
        {visibleModules.map((moduleItem) => (
          <button
            key={moduleItem.key}
            className={activeModuleKey === moduleItem.key ? 'settings-tab active' : 'settings-tab'}
            type="button"
            onClick={() => handleModuleChange(moduleItem.key)}
          >
            <Settings2 size={17} />
            <span className="settings-tab-full">{moduleItem.title}</span>
            <span className="settings-tab-short">{getMobileSettingsTitle(moduleItem.key)}</span>
          </button>
        ))}
      </div>

      {isPermissionModule ? (
        <PermissionManagementPanel />
      ) : isRegionPermissionsModule ? (
        <RegionFeaturePermissionPanel />
      ) : (
        <div className="staff-list-panel">
          <div className="list-header">
            <div>
              <span>{activeModule.title}</span>
              <h3>{records.length} 条设置</h3>
            </div>
            <div className="toolbar-actions">
              <button className="secondary-action" type="button" onClick={openCreate}>
                <Plus size={17} />
                <span>{getCreateButtonText(activeModule.key)}</span>
              </button>
              <button className="secondary-action" type="button" onClick={() => loadSettings()} disabled={loading}>
                <RefreshCw size={17} />
                <span>刷新</span>
              </button>
            </div>
          </div>

          {loading ? (
            <div className="table-state">正在读取系统设置...</div>
          ) : records.length === 0 ? (
            <div className="table-state">暂无系统设置。</div>
          ) : (
            <div className="staff-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    {activeModule.hasCode ? <th>代码</th> : null}
                    <th>名称</th>
                    {activeModule.key === 'regions' ? <th>公司英文名称</th> : null}
                    {activeModule.key === 'regions' ? <th>公司注册号</th> : null}
                    {activeModule.key === 'regions' ? <th>公司 IG</th> : null}
                    {activeModule.key === 'regions' ? <th>公司 FB</th> : null}
                    <th>排序</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id}>
                      {activeModule.hasCode ? <td>{'code' in record ? record.code : '-'}</td> : null}
                      <td>
                        <strong>{record.name}</strong>
                      </td>
                      {activeModule.key === 'regions' ? <td>{'company_english_name' in record ? record.company_english_name || '-' : '-'}</td> : null}
                      {activeModule.key === 'regions' ? <td>{'company_registration_no' in record ? record.company_registration_no || '-' : '-'}</td> : null}
                      {activeModule.key === 'regions' ? <td>{'company_instagram' in record ? record.company_instagram || '-' : '-'}</td> : null}
                      {activeModule.key === 'regions' ? <td>{'company_facebook' in record ? record.company_facebook || '-' : '-'}</td> : null}
                      <td>{record.sort_order}</td>
                      <td>
                        <span className={record.is_active ? 'status-pill status-active' : 'status-pill status-inactive'}>
                          {record.is_active ? '启用' : '停用'}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="icon-button" type="button" onClick={() => handleEdit(record)} aria-label="编辑">
                            <Edit3 size={16} />
                          </button>
                          <button
                            className="icon-button"
                            type="button"
                            onClick={() => handleToggle(record)}
                            aria-label={record.is_active ? '停用' : '启用'}
                          >
                            {record.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {formOpen && isSettingsDataModule(activeModuleKey) ? (
        <SettingsFormModal
          activeModule={activeModule}
          editingRecord={editingRecord}
          formValues={formValues}
          saving={saving}
          onChange={setFormValues}
          onClose={closeForm}
          onSubmit={handleSubmit}
        />
      ) : null}
    </section>
  );
}

function SettingsFormModal({
  activeModule,
  editingRecord,
  formValues,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  activeModule: SettingsModule;
  editingRecord: SettingsRecord | null;
  formValues: SettingsFormValues;
  saving: boolean;
  onChange: (values: SettingsFormValues) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <SystemModal
      title={editingRecord ? `编辑${getSettingName(activeModule.key)}` : `新增${getSettingName(activeModule.key)}`}
      subtitle={activeModule.title}
      ariaLabel={editingRecord ? '编辑系统设置' : '新增系统设置'}
      wide={false}
      onClose={onClose}
      footer={
        <>
          <button className="secondary-button compact-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button compact-button" type="submit" form="settings-form" disabled={saving}>
            <Plus size={18} />
            <span>{saving ? '保存中...' : '保存'}</span>
          </button>
        </>
      }
    >
      <form id="settings-form" onSubmit={onSubmit}>
        <div className="form-grid single">
          {activeModule.hasCode ? (
            <label className="form-field">
              <span>区域代码</span>
              <input
                value={formValues.code}
                onChange={(event) => onChange({ ...formValues, code: event.target.value })}
                placeholder="例如 KCH"
                required
              />
            </label>
          ) : null}

          <label className="form-field">
            <span>{activeModule.nameLabel}</span>
            <input value={formValues.name} onChange={(event) => onChange({ ...formValues, name: event.target.value })} required />
          </label>

          {activeModule.key === 'regions' ? (
            <>
              <label className="form-field">
                <span>公司英文名称</span>
                <input
                  value={formValues.company_english_name ?? ''}
                  onChange={(event) => onChange({ ...formValues, company_english_name: event.target.value })}
                  placeholder="例如 DY ENTERTAINMENT SDN BHD"
                />
              </label>

              <label className="form-field">
                <span>公司注册号</span>
                <input
                  value={formValues.company_registration_no ?? ''}
                  onChange={(event) => onChange({ ...formValues, company_registration_no: event.target.value })}
                  placeholder="例如 202401047280 (1593126-M)"
                />
              </label>

              <label className="form-field">
                <span>公司 IG</span>
                <input
                  value={formValues.company_instagram ?? ''}
                  onChange={(event) => onChange({ ...formValues, company_instagram: event.target.value })}
                  placeholder="例如 @dygroup"
                />
              </label>

              <label className="form-field">
                <span>公司 FB</span>
                <input
                  value={formValues.company_facebook ?? ''}
                  onChange={(event) => onChange({ ...formValues, company_facebook: event.target.value })}
                  placeholder="例如 DY Group"
                />
              </label>
            </>
          ) : null}

          <label className="form-field">
            <span>排序</span>
            <input
              type="number"
              value={formValues.sort_order}
              onChange={(event) => onChange({ ...formValues, sort_order: Number(event.target.value) })}
            />
          </label>

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={formValues.is_active}
              onChange={(event) => onChange({ ...formValues, is_active: event.target.checked })}
            />
            <span>启用</span>
          </label>
        </div>
      </form>
    </SystemModal>
  );
}

function RegionFeaturePermissionPanel() {
  const [rows, setRows] = useState<RegionPermissionMatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void loadRegionPermissions();
  }, []);

  usePullToRefresh(() => loadRegionPermissions(), []);

  async function loadRegionPermissions() {
    setLoading(true);
    setError('');

    try {
      const matrix = await regionPermissionSettingsService.listMatrix();
      setRows(matrix);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取地区功能权限失败。');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(row: RegionPermissionMatrixRow, permissionKey: RegionFeaturePermissionKey, enabled: boolean) {
    const setting = row.settings[permissionKey];
    if (!setting || isRegionFeatureToggleDisabled(row, permissionKey)) {
      return;
    }

    setSavingKey(setting.id);
    setError('');
    setMessage('');

    try {
      const updatedSetting = await regionPermissionSettingsService.updateSetting({
        settingId: setting.id,
        regionId: row.region.id,
        permissionKey,
        enabled,
      });
      setRows((currentRows) =>
        currentRows.map((currentRow) => {
          if (currentRow.region.id !== row.region.id) return currentRow;

          return {
            ...currentRow,
            settings: {
              ...currentRow.settings,
              [permissionKey]: updatedSetting,
            },
          };
        }),
      );
      setMessage(`${row.region.code} ${getRegionFeatureLabel(permissionKey)}已${enabled ? '开启' : '关闭'}。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '更新地区功能权限失败。');
    } finally {
      setSavingKey('');
    }
  }

  return (
    <div className="staff-list-panel">
      <div className="list-header">
        <div>
          <span>地区功能权限</span>
          <h3>{rows.length} 个地区</h3>
        </div>
        <div className="toolbar-actions">
          <button className="secondary-action" type="button" onClick={() => void loadRegionPermissions()} disabled={loading}>
            <RefreshCw size={17} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      {loading ? (
        <div className="table-state">正在读取地区功能权限...</div>
      ) : rows.length === 0 ? (
        <div className="table-state">暂无地区资料。</div>
      ) : (
        <div className="staff-table-wrap">
          <table className="staff-table staff-simple-table">
            <thead>
              <tr>
                <th>地区</th>
                {managedRegionFeaturePermissions.map((feature) => (
                  <th key={feature.key}>{feature.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.region.id}>
                  <td>
                    <strong>{row.region.code}</strong>
                    <span className="muted-inline"> {row.region.name}</span>
                  </td>
                  {managedRegionFeaturePermissions.map((feature) => {
                    const setting = row.settings[feature.key];
                    const checked = Boolean(setting?.can_view && setting.can_use);
                    const disabled = !setting || isRegionFeatureToggleDisabled(row, feature.key);
                    const saving = savingKey === setting?.id;
                    const title = getRegionFeatureToggleTitle(row, feature.key, Boolean(setting));

                    return (
                      <td key={feature.key}>
                        <label className="toggle-field inline-toggle" title={title}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled || saving}
                            onChange={(event) => void handleToggle(row, feature.key, event.target.checked)}
                          />
                          <span>{checked ? '开启' : '关闭'}</span>
                        </label>
                        {title ? <small className="field-hint">{title}</small> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PermissionManagementPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<PermissionTabKey>(() => getPermissionTabFromParams(searchParams));
  const [jobTitles, setJobTitles] = useState<SettingsRecord[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOptions>({ regions: [], employmentTypes: [], jobTitles: [] });
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [specialPermissionTemplates, setSpecialPermissionTemplates] = useState<SpecialPermissionTemplate[]>([]);
  const [modalTarget, setModalTarget] = useState<PermissionModalTarget | null>(null);
  const [modalPermissions, setModalPermissions] = useState<PermissionState>({});
  const [attendanceRequired, setAttendanceRequired] = useState(true);
  const [managedRegionIds, setManagedRegionIds] = useState<string[]>([]);
  const [ownedSpecialPermissionAccess, setOwnedSpecialPermissionAccess] = useState<PermissionState>({});
  const [specialTemplatePermissionMap, setSpecialTemplatePermissionMap] = useState<Record<string, PermissionState>>({});
  const [newSpecialName, setNewSpecialName] = useState('');
  const [employeePermissionSearch, setEmployeePermissionSearch] = useState('');
  const [employeePermissionRegionId, setEmployeePermissionRegionId] = useState('');
  const [initialPermissionSnapshot, setInitialPermissionSnapshot] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const permissionItems = useMemo(() => buildPermissionItems(), []);
  const filteredPermissionEmployees = useMemo(
    () => {
      const keyword = employeePermissionSearch.trim().toLowerCase();
      const filteredEmployees = employees.filter((employee) => {
        const matchesKeyword =
          !keyword ||
          [employee.full_name, employee.nickname]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(keyword));
        const matchesRegion = !employeePermissionRegionId || employee.region_id === employeePermissionRegionId;

        return matchesKeyword && matchesRegion;
      });

      return [...filteredEmployees].sort((first, second) => {
        const firstStatus = employeeStatusOrder[getStaffStatus(first.status)] ?? employeeStatusOrder.active;
        const secondStatus = employeeStatusOrder[getStaffStatus(second.status)] ?? employeeStatusOrder.active;
        if (firstStatus !== secondStatus) return firstStatus - secondStatus;
        return first.full_name.localeCompare(second.full_name, 'zh-Hans');
      });
    },
    [employeePermissionRegionId, employeePermissionSearch, employees],
  );
  const currentPermissionSnapshot = useMemo(
    () =>
      createPermissionSnapshot({
        permissions: modalPermissions,
        attendanceRequired,
        managedRegionIds,
        ownedSpecialPermissionAccess,
        specialName: getCurrentSpecialPermissionName(modalTarget, newSpecialName),
      }),
    [attendanceRequired, managedRegionIds, modalPermissions, modalTarget, newSpecialName, ownedSpecialPermissionAccess],
  );
  const isDirty = Boolean(modalTarget) && currentPermissionSnapshot !== initialPermissionSnapshot;

  useEffect(() => {
    void loadPermissionContext();
  }, []);

  useEffect(() => {
    const nextTab = getPermissionTabFromParams(searchParams);
    if (nextTab !== activeTab) {
      setActiveTab(nextTab);
      closePermissionModal();
    }
  }, [searchParams]);

  usePullToRefresh(() => loadPermissionContext(), [activeTab]);

  async function loadPermissionContext(keepMessage = false) {
    setLoading(true);
    setError('');
    if (!keepMessage) setMessage('');

    try {
      const [jobTitleRecords, staffList, options, specialTemplates] = await Promise.all([
        settingsService.listSettings('job_titles'),
        staffService.listEmployees(),
        staffService.getOptions(),
        permissionManagementService.listSpecialPermissionTemplates(),
      ]);
      setJobTitles(jobTitleRecords);
      setEmployees(staffList);
      setStaffOptions(options);
      setSpecialPermissionTemplates(specialTemplates);
      const templateEntries = await Promise.all(
        specialTemplates.map(async (template) => [
          template.name,
          await permissionManagementService.getSpecialPermissionTemplatePermissions(template.name),
        ] as const),
      );
      setSpecialTemplatePermissionMap(Object.fromEntries(templateEntries));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取权限管理资料失败。');
    } finally {
      setLoading(false);
    }
  }

  function applyPermissionDraft(input: {
    permissions: PermissionState;
    attendanceRequired: boolean;
    managedRegionIds: string[];
    ownedSpecialPermissionAccess: PermissionState;
    specialName: string;
  }) {
    setModalPermissions(input.permissions);
    setAttendanceRequired(input.attendanceRequired);
    setManagedRegionIds(input.managedRegionIds);
    setOwnedSpecialPermissionAccess(input.ownedSpecialPermissionAccess);
    setInitialPermissionSnapshot(createPermissionSnapshot(input));
  }

  async function openPermissionModal(target: PermissionModalTarget) {
    setError('');
    setMessage('');
    setNewSpecialName('');

    try {
      setModalTarget(target);
      const defaultPermissions = createDefaultPermissionState(permissionItems, target);

      if (target.type === 'jobTitle') {
        const savedPermissions = await permissionManagementService.getJobTitlePermissions(target.id);
        applyPermissionDraft({
          permissions: mergePermissionState(defaultPermissions, savedPermissions),
          attendanceRequired: true,
          managedRegionIds: [],
          ownedSpecialPermissionAccess: {},
          specialName: '',
        });
        return;
      }

      if (target.type === 'special' && target.title !== '新增特殊权限') {
        const savedPermissions = await permissionManagementService.getSpecialPermissionTemplatePermissions(target.title);
        applyPermissionDraft({
          permissions: mergePermissionState(defaultPermissions, savedPermissions),
          attendanceRequired: true,
          managedRegionIds: [],
          ownedSpecialPermissionAccess: {},
          specialName: target.title,
        });
        return;
      }

      if (target.type === 'employee') {
        const savedProfile = await permissionManagementService.getEmployeePermissions(target.employee.id);
        applyPermissionDraft({
          permissions: mergePermissionState(defaultPermissions, savedProfile.permissions),
          attendanceRequired: savedProfile.requireAttendance,
          managedRegionIds: savedProfile.regionIds,
          ownedSpecialPermissionAccess: savedProfile.specialPermissionAccess,
          specialName: '',
        });
        return;
      }

      applyPermissionDraft({
        permissions: defaultPermissions,
        attendanceRequired: true,
        managedRegionIds: [],
        ownedSpecialPermissionAccess: {},
        specialName: '',
      });
    } catch (loadError) {
      setModalTarget(null);
      setError(loadError instanceof Error ? loadError.message : '读取权限模板失败。');
    }
  }

  function closePermissionModal() {
    setModalTarget(null);
    setModalPermissions({});
    setNewSpecialName('');
    setInitialPermissionSnapshot('');
  }

  async function handleSavePermissions() {
    if (!modalTarget || savingPermissions) return;

    setSavingPermissions(true);
    setError('');
    setMessage('');

    try {
      if (modalTarget.type === 'jobTitle') {
        await permissionManagementService.saveJobTitlePermissions(modalTarget.id, modalPermissions);
      }

      if (modalTarget.type === 'special') {
        const templateName = modalTarget.title === '新增特殊权限' ? newSpecialName.trim() : modalTarget.title;
        const savedTemplate = await permissionManagementService.saveSpecialPermissionTemplate(templateName, modalPermissions);
        setSpecialPermissionTemplates((current) => {
          const existingIndex = current.findIndex((template) => template.id === savedTemplate.id || template.name === savedTemplate.name);
          if (existingIndex === -1) return [...current, savedTemplate];

          return current.map((template, index) => (index === existingIndex ? savedTemplate : template));
        });
        setSpecialTemplatePermissionMap((current) => ({ ...current, [savedTemplate.name]: modalPermissions }));
        setModalTarget({ type: 'special', title: savedTemplate.name, subtitle: '特殊权限模板' });
        setNewSpecialName('');
      }

      if (modalTarget.type === 'employee') {
        await permissionManagementService.saveEmployeePermissions({
          employeeId: modalTarget.employee.id,
          requireAttendance: attendanceRequired,
          regionIds: managedRegionIds,
          specialPermissionAccess: ownedSpecialPermissionAccess,
          specialPermissionTemplates,
          permissions: modalPermissions,
        });
        setEmployees((current) =>
          current.map((employee) =>
            employee.id === modalTarget.employee.id ? { ...employee, require_attendance: attendanceRequired } : employee,
          ),
        );
      }

      setMessage('权限设置已保存。');
      setInitialPermissionSnapshot(
        createPermissionSnapshot({
          permissions: modalPermissions,
          attendanceRequired,
          managedRegionIds,
          ownedSpecialPermissionAccess,
          specialName: modalTarget.type === 'special' ? getCurrentSpecialPermissionName(modalTarget, newSpecialName) : '',
        }),
      );
    } catch (saveError) {
      console.error('保存权限设置失败', saveError);
      setError(saveError instanceof Error ? saveError.message : '保存权限设置失败。');
    } finally {
      setSavingPermissions(false);
    }
  }

  function handlePermissionChange(permissionKey: string, field: keyof PermissionAccess, checked: boolean) {
    setModalPermissions((current) => updatePermissionTree(current, permissionItems, permissionKey, field, checked));
  }

  function handleSpecialBatchChange(permissionKey: string, checked: boolean) {
    setModalPermissions((current) => updateSpecialBatchTree(current, permissionItems, permissionKey, checked));
  }

  function toggleManagedRegion(regionId: string, checked: boolean) {
    setManagedRegionIds((current) => (checked ? [...new Set([...current, regionId])] : current.filter((id) => id !== regionId)));
  }

  function toggleSpecialPermission(name: string, field: keyof PermissionAccess, checked: boolean) {
    setOwnedSpecialPermissionAccess((current) => {
      const currentAccess = current[name] ?? { view: false, use: false };
      const nextAccess = { ...currentAccess, [field]: checked };
      if (field === 'view' && !checked) nextAccess.use = false;
      if (field === 'use' && checked) nextAccess.view = true;

      const next = { ...current };
      if (nextAccess.view || nextAccess.use) {
        next[name] = nextAccess;
      } else {
        delete next[name];
      }
      return next;
    });

    const templatePermissions = specialTemplatePermissionMap[name] ?? {};
    const titlePermissions =
      modalTarget?.type === 'employee' ? createDefaultPermissionState(permissionItems, { type: 'employee', employee: modalTarget.employee }) : {};

    setModalPermissions((current) => applySpecialPermissionSync(current, templatePermissions, titlePermissions, field, checked));
  }

  function handlePermissionTabChange(tabKey: PermissionTabKey) {
    setActiveTab(tabKey);
    setSearchParams({ tab: 'permissions', permission_tab: permissionTabParams[tabKey] });
    closePermissionModal();
  }

  return (
    <div className="permission-management-panel">
      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <div className="permission-subtabs" role="tablist" aria-label="权限管理分类">
        <button className={activeTab === 'jobTitles' ? 'permission-subtab active' : 'permission-subtab'} type="button" onClick={() => handlePermissionTabChange('jobTitles')}>
          职称权限
        </button>
        <button className={activeTab === 'special' ? 'permission-subtab active' : 'permission-subtab'} type="button" onClick={() => handlePermissionTabChange('special')}>
          特殊权限
        </button>
        <button className={activeTab === 'employees' ? 'permission-subtab active' : 'permission-subtab'} type="button" onClick={() => handlePermissionTabChange('employees')}>
          工作人员权限
        </button>
      </div>

      {activeTab === 'jobTitles' ? (
        <section className="permission-section-panel">
          {loading ? (
            <div className="table-state">正在读取职称权限...</div>
          ) : (
            <div className="permission-card-grid compact">
              {jobTitles.map((jobTitle) => (
                <button
                  className="permission-template-card"
                  type="button"
                  key={jobTitle.id}
                  onClick={() => void openPermissionModal({ type: 'jobTitle', id: jobTitle.id, title: jobTitle.name, subtitle: '职称基础权限' })}
                >
                  <strong>{jobTitle.name}</strong>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'special' ? (
        <section className="permission-section-panel">
          <div className="list-header">
            <div />
            <button
              className="secondary-action"
              type="button"
              onClick={() => void openPermissionModal({ type: 'special', title: '新增特殊权限', subtitle: '特殊权限模板' })}
            >
              <Plus size={17} />
              <span>新增特殊权限</span>
            </button>
          </div>
          <div className="permission-card-grid compact">
            {specialPermissionTemplates.map((permissionTemplate) => (
              <button
                className="permission-template-card"
                type="button"
                key={permissionTemplate.id}
                onClick={() => void openPermissionModal({ type: 'special', title: permissionTemplate.name, subtitle: '特殊权限模板' })}
              >
                <strong>{permissionTemplate.name}</strong>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === 'employees' ? (
        <section className="permission-section-panel">
          <div className="list-header employee-permission-filter-header">
            <label className="table-search employee-permission-search">
              <Search size={16} />
              <input
                placeholder="搜索姓名 / 昵称"
                value={employeePermissionSearch}
                onChange={(event) => setEmployeePermissionSearch(event.target.value)}
              />
            </label>
            <select
              className="employee-permission-region-filter"
              value={employeePermissionRegionId}
              onChange={(event) => setEmployeePermissionRegionId(event.target.value)}
            >
              <option value="">全部区域</option>
              {staffOptions.regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.code}
                </option>
              ))}
            </select>
            <button className="secondary-action" type="button" onClick={() => void loadPermissionContext()} disabled={loading}>
              <RefreshCw size={17} />
              <span>刷新</span>
            </button>
          </div>
          {loading ? (
            <div className="table-state">正在读取工作人员...</div>
          ) : filteredPermissionEmployees.length === 0 ? (
            <div className="table-state">暂无工作人员资料。</div>
          ) : (
            <div className="staff-table-wrap">
              <table className="staff-table staff-simple-table">
                <thead>
                  <tr>
                    <th>头像</th>
                    <th>姓名</th>
                    <th>昵称</th>
                    <th>区域</th>
                    <th>职称</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPermissionEmployees.map((employee) => {
                    const status = getStaffStatus(employee.status);
                    return (
                      <tr key={employee.id}>
                        <td>
                          <PermissionEmployeeAvatar employee={employee} />
                        </td>
                        <td>
                          <button className="text-link-button" type="button" onClick={() => void openPermissionModal({ type: 'employee', employee })}>
                            {employee.full_name}
                          </button>
                        </td>
                        <td>{employee.nickname || '-'}</td>
                        <td>{employee.region?.code ?? employee.region?.name ?? '-'}</td>
                        <td>{employee.job_title?.name || '-'}</td>
                        <td>
                          <span className={'status-pill status-' + status}>{employeeStatusLabels[status] ?? employeeStatusLabels.active}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {modalTarget ? (
        <SystemModal
          title={modalTarget.type === 'employee' ? modalTarget.employee.full_name : modalTarget.title}
          subtitle={modalTarget.type === 'employee' ? '权限详情' : modalTarget.subtitle}
          ariaLabel="权限设置"
          wide
          onClose={closePermissionModal}
          footer={
            <>
              <button className="secondary-button compact-button" type="button" onClick={closePermissionModal}>
                关闭
              </button>
              <button
                className="primary-button compact-button"
                type="button"
                onClick={() => void handleSavePermissions()}
                disabled={savingPermissions}
                title={isDirty ? '保存权限模板' : '重新保存权限模板'}
              >
                {savingPermissions ? '保存中...' : '保存模板'}
              </button>
            </>
          }
        >
          {modalTarget.type === 'special' && modalTarget.title === '新增特殊权限' ? (
            <label className="form-field permission-name-field">
              <span>特殊权限名称</span>
              <input value={newSpecialName} onChange={(event) => setNewSpecialName(event.target.value)} placeholder="例如：区域主管" />
            </label>
          ) : null}

          {modalTarget.type === 'employee' ? (
            <div className="employee-permission-sections">
              <PermissionBlock title="考勤设置">
                <div className="segmented-choice">
                  <button className={attendanceRequired ? 'active' : ''} type="button" onClick={() => setAttendanceRequired(true)}>
                    需要
                  </button>
                  <button className={!attendanceRequired ? 'active' : ''} type="button" onClick={() => setAttendanceRequired(false)}>
                    不需要
                  </button>
                </div>
              </PermissionBlock>

              <PermissionBlock title="管理区域">
                <div className="permission-check-grid">
                  {staffOptions.regions.map((region) => (
                    <label className="permission-check" key={region.id}>
                      <input checked={managedRegionIds.includes(region.id)} type="checkbox" onChange={(event) => toggleManagedRegion(region.id, event.target.checked)} />
                      <span>{region.code}</span>
                    </label>
                  ))}
                </div>
              </PermissionBlock>

              <PermissionBlock title="拥有特殊权限">
                <div className="special-permission-access-list">
                  <div className="special-permission-access-head">
                    <span>特殊权限名称</span>
                    <span>查阅</span>
                    <span>使用</span>
                  </div>
                  {specialPermissionTemplates.map((permissionTemplate) => (
                    <div className="special-permission-access-row" key={permissionTemplate.id}>
                      <span>{permissionTemplate.name}</span>
                      <input
                        checked={Boolean(ownedSpecialPermissionAccess[permissionTemplate.name]?.view)}
                        type="checkbox"
                        onChange={(event) => toggleSpecialPermission(permissionTemplate.name, 'view', event.target.checked)}
                      />
                      <input
                        checked={Boolean(ownedSpecialPermissionAccess[permissionTemplate.name]?.use)}
                        disabled={!ownedSpecialPermissionAccess[permissionTemplate.name]?.view}
                        type="checkbox"
                        onChange={(event) => toggleSpecialPermission(permissionTemplate.name, 'use', event.target.checked)}
                      />
                    </div>
                  ))}
                </div>
              </PermissionBlock>
            </div>
          ) : null}

          <PermissionBlock title={modalTarget.type === 'employee' ? '个人权限调整' : '权限项目'}>
            {modalTarget.type === 'special' ? (
              <PermissionBatchMatrix items={permissionItems} permissions={modalPermissions} onChange={handleSpecialBatchChange} />
            ) : (
              <PermissionMatrix items={permissionItems} permissions={modalPermissions} onChange={handlePermissionChange} />
            )}
          </PermissionBlock>
        </SystemModal>
      ) : null}
    </div>
  );
}

function PermissionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="permission-block">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function PermissionMatrix({
  items,
  permissions,
  onChange,
}: {
  items: PermissionItem[];
  permissions: PermissionState;
  onChange: (permissionKey: string, field: keyof PermissionAccess, checked: boolean) => void;
}) {
  return (
    <div className="permission-matrix">
      <div className="permission-matrix-head">
        <span>项目名称</span>
        <span>查阅</span>
        <span>使用</span>
      </div>
      {items.map((item) => {
        const access = permissions[item.key] ?? { view: false, use: false };
        const viewState = getPermissionCheckState(item, items, permissions, 'view');
        const useStateValue = getPermissionCheckState(item, items, permissions, 'use');

        return (
          <div className={'permission-matrix-row level-' + item.level} key={item.key}>
            <span>{item.name}</span>
            <IndeterminateCheckbox
              checked={access.view}
              indeterminate={viewState === 'mixed'}
              disabled={item.disabled}
              onChange={(checked) => onChange(item.key, 'view', checked)}
            />
            <IndeterminateCheckbox
              checked={access.use}
              indeterminate={useStateValue === 'mixed'}
              disabled={item.disabled || !access.view}
              onChange={(checked) => onChange(item.key, 'use', checked)}
            />
          </div>
        );
      })}
    </div>
  );
}

function PermissionBatchMatrix({
  items,
  permissions,
  onChange,
}: {
  items: PermissionItem[];
  permissions: PermissionState;
  onChange: (permissionKey: string, checked: boolean) => void;
}) {
  return (
    <div className="permission-matrix batch">
      <div className="permission-matrix-head">
        <span>权限项目</span>
        <span>批量</span>
      </div>
      {items.map((item) => {
        const checked = Boolean(permissions[item.key]?.view || permissions[item.key]?.use);
        const batchState = getPermissionCheckState(item, items, permissions, 'view');

        return (
          <div className={'permission-matrix-row level-' + item.level} key={item.key}>
            <span>{item.name}</span>
            <IndeterminateCheckbox
              checked={checked}
              indeterminate={batchState === 'mixed'}
              disabled={item.disabled}
              onChange={(nextChecked) => onChange(item.key, nextChecked)}
            />
          </div>
        );
      })}
    </div>
  );
}

function IndeterminateCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const checkboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return <input ref={checkboxRef} checked={checked} disabled={disabled} type="checkbox" onChange={(event) => onChange(event.target.checked)} />;
}

function PermissionEmployeeAvatar({ employee }: { employee: EmployeeListItem }) {
  const initial = employee.full_name.slice(0, 1).toUpperCase();
  return (
    <span className="employee-avatar">
      {employee.avatar_url ? <img src={employee.avatar_url} alt={employee.full_name} /> : initial}
    </span>
  );
}

function buildPermissionItems(): PermissionItem[] {
  const groups = new Map<string, PermissionItem[]>();

  menuItems.forEach((item) => {
    if (reservedPermissionKeys.has(item.key) || !item.section || !item.group) return;
    const groupKey = getPermissionGroupKey(item);
    const currentItems = groups.get(groupKey) ?? [];
    currentItems.push({ key: item.key, name: item.label, parentKey: groupKey, level: 1, disabled: item.disabled });
    groups.set(groupKey, currentItems);
  });

  return Array.from(groups.entries()).flatMap(([groupKey, children]) => {
    if (children.length === 1 && children[0].key === groupKey) {
      return [{ ...children[0], parentKey: null, level: 0 }];
    }

    return [{ key: groupKey, name: getPermissionGroupName(groupKey), parentKey: null, level: 0 }, ...children];
  });
}

function getPermissionGroupKey(item: (typeof menuItems)[number]) {
  if (item.group && permissionGroupKeys[item.group]) return permissionGroupKeys[item.group];
  return item.key;
}

function getPermissionGroupName(groupKey: string) {
  if (groupKey === 'hr') return '人事部';
  if (groupKey === 'scout') return '星探';
  if (groupKey === 'agent') return '经纪人';
  if (groupKey === 'designer') return '美工';
  if (groupKey === 'management') return '管理';
  return groupKey;
}

function createDefaultPermissionState(items: PermissionItem[], target: PermissionModalTarget): PermissionState {
  const permissions = items.reduce<PermissionState>((state, item) => {
    state[item.key] = { view: false, use: false };
    return state;
  }, {});
  const targetName = target.type === 'employee' ? target.employee.job_title?.name ?? '' : target.title;
  const defaultKeys = getDefaultPermissionKeys(targetName);

  defaultKeys.forEach((key) => {
    if (permissions[key]) {
      permissions[key] = { view: true, use: true };
    }
  });

  items
    .filter((item) => item.parentKey && defaultKeys.includes(item.parentKey))
    .forEach((item) => {
      permissions[item.key] = { view: true, use: true };
    });

  return permissions;
}

function mergePermissionState(defaultState: PermissionState, savedState: PermissionState): PermissionState {
  if (Object.keys(savedState).length === 0) return defaultState;

  return Object.keys(defaultState).reduce<PermissionState>((state, key) => {
    state[key] = savedState[key] ?? defaultState[key];
    return state;
  }, {});
}

function createPermissionSnapshot(input: {
  permissions: PermissionState;
  attendanceRequired: boolean;
  managedRegionIds: string[];
  ownedSpecialPermissionAccess: PermissionState;
  specialName: string;
}) {
  const permissions = Object.keys(input.permissions)
    .sort()
    .reduce<PermissionState>((state, key) => {
      const access = input.permissions[key] ?? { view: false, use: false };
      state[key] = {
        view: access.view,
        use: access.view && access.use,
      };
      return state;
    }, {});

  return JSON.stringify({
    permissions,
    attendanceRequired: input.attendanceRequired,
    managedRegionIds: [...input.managedRegionIds].sort(),
    ownedSpecialPermissionAccess: Object.keys(input.ownedSpecialPermissionAccess)
      .sort()
      .reduce<PermissionState>((state, key) => {
        const access = input.ownedSpecialPermissionAccess[key] ?? { view: false, use: false };
        state[key] = {
          view: access.view,
          use: access.view && access.use,
        };
        return state;
      }, {}),
    specialName: input.specialName.trim(),
  });
}

function getCurrentSpecialPermissionName(target: PermissionModalTarget | null, newSpecialName: string) {
  if (target?.type !== 'special') return '';
  return target.title === '新增特殊权限' ? newSpecialName : target.title;
}

function getDefaultPermissionKeys(name: string) {
  if (name.includes('HR')) return ['hr', 'staff', 'registration-review', 'leave-review', 'attendance-management', 'attendance-locations'];
  if (name.includes('高级管理员')) return ['scout', 'agent', 'designer', 'hr'];
  if (name.includes('管理员')) return ['scout', 'agent', 'designer', 'hr'];
  if (name.includes('经纪')) return ['agent'];
  if (name.includes('美工')) return ['designer'];
  if (name.includes('星探')) return ['scout'];
  return [];
}

function updatePermissionTree(state: PermissionState, items: PermissionItem[], key: string, field: keyof PermissionAccess, checked: boolean): PermissionState {
  const next = { ...state };
  const targetItem = items.find((item) => item.key === key);
  const childItems = items.filter((item) => item.parentKey === key);
  const affectedItems = targetItem?.parentKey ? [targetItem] : [targetItem, ...childItems].filter(Boolean);

  affectedItems.forEach((item) => {
    if (!item) return;
    const current = next[item.key] ?? { view: false, use: false };
    const updated = { ...current, [field]: checked };
    if (field === 'view' && !checked) updated.use = false;
    if (field === 'use' && checked) updated.view = true;
    next[item.key] = updated;
  });

  if (targetItem?.parentKey) {
    syncParentPermission(next, items, targetItem.parentKey, field);
  }

  return next;
}

function updateSpecialBatchTree(state: PermissionState, items: PermissionItem[], key: string, checked: boolean): PermissionState {
  const next = { ...state };
  const targetItem = items.find((item) => item.key === key);
  const childItems = items.filter((item) => item.parentKey === key);
  const affectedItems = targetItem?.parentKey ? [targetItem] : [targetItem, ...childItems].filter(Boolean);

  affectedItems.forEach((item) => {
    if (!item) return;
    next[item.key] = {
      view: checked,
      use: checked,
    };
  });

  if (targetItem?.parentKey) {
    syncParentPermission(next, items, targetItem.parentKey, 'view');
    syncParentPermission(next, items, targetItem.parentKey, 'use');
  }

  return next;
}

function applySpecialPermissionSync(
  state: PermissionState,
  templatePermissions: PermissionState,
  titlePermissions: PermissionState,
  field: keyof PermissionAccess,
  checked: boolean,
) {
  const next = { ...state };

  Object.entries(templatePermissions).forEach(([permissionKey, access]) => {
    if (!access.view && !access.use) return;

    const current = next[permissionKey] ?? { view: false, use: false };
    const titleAccess = titlePermissions[permissionKey] ?? { view: false, use: false };

    if (checked) {
      next[permissionKey] = {
        view: true,
        use: field === 'use' ? true : current.use,
      };
      return;
    }

    if (field === 'view') {
      next[permissionKey] = {
        view: titleAccess.view,
        use: titleAccess.use,
      };
      return;
    }

    next[permissionKey] = {
      view: current.view || titleAccess.view,
      use: titleAccess.use,
    };
  });

  return next;
}

function syncParentPermission(state: PermissionState, items: PermissionItem[], parentKey: string, field: keyof PermissionAccess) {
  const childItems = items.filter((item) => item.parentKey === parentKey);
  const hasAnyChecked = childItems.some((item) => state[item.key]?.[field]);
  const hasAllChecked = childItems.length > 0 && childItems.every((item) => state[item.key]?.[field]);
  const parent = state[parentKey] ?? { view: false, use: false };

  state[parentKey] = { ...parent, [field]: hasAllChecked };
  if (!hasAnyChecked && field === 'view') {
    state[parentKey].use = false;
  }
}

function getPermissionCheckState(item: PermissionItem, items: PermissionItem[], permissions: PermissionState, field: keyof PermissionAccess) {
  const children = items.filter((child) => child.parentKey === item.key);
  if (children.length === 0) return permissions[item.key]?.[field] ? 'checked' : 'unchecked';

  const checkedCount = children.filter((child) => permissions[child.key]?.[field]).length;
  if (checkedCount === 0) return permissions[item.key]?.[field] ? 'checked' : 'unchecked';
  if (checkedCount === children.length) return 'checked';
  return 'mixed';
}

function getStaffStatus(status: string | null | undefined) {
  return status || 'active';
}

function isSettingsDataModule(moduleKey: SettingsModule['key']): moduleKey is SettingsModuleKey {
  return moduleKey === 'regions' || moduleKey === 'job_titles' || moduleKey === 'employment_types';
}

function getRegionFeatureLabel(permissionKey: RegionFeaturePermissionKey) {
  return managedRegionFeaturePermissions.find((feature) => feature.key === permissionKey)?.label ?? permissionKey;
}

function isRegionFeatureToggleDisabled(row: RegionPermissionMatrixRow, permissionKey: RegionFeaturePermissionKey) {
  return row.region.code === 'KL' && permissionKey === 'work-time-adjustment-employee';
}

function getRegionFeatureToggleTitle(
  row: RegionPermissionMatrixRow,
  permissionKey: RegionFeaturePermissionKey,
  hasExistingSetting: boolean,
) {
  if (isRegionFeatureToggleDisabled(row, permissionKey)) {
    return '后台尚未支持 KL 工时调整';
  }

  if (!hasExistingSetting) {
    return '尚未有现有设置记录';
  }

  return '';
}

function getSettingsTabFromParams(searchParams: URLSearchParams): SettingsModule['key'] {
  return settingsTabAliases[searchParams.get('tab') ?? ''] ?? 'regions';
}

function getPermissionTabFromParams(searchParams: URLSearchParams): PermissionTabKey {
  return permissionTabAliases[searchParams.get('permission_tab') ?? ''] ?? 'jobTitles';
}

function getSettingName(moduleKey: SettingsModule['key']) {
  if (moduleKey === 'regions') return '区域';
  if (moduleKey === 'job_titles') return '职称';
  if (moduleKey === 'employment_types') return '雇佣类型';
  if (moduleKey === 'region_permissions') return '地区功能权限';
  return '权限';
}

function getCreateButtonText(moduleKey: SettingsModule['key']) {
  return `新增${getSettingName(moduleKey)}`;
}

function getMobileSettingsTitle(moduleKey: SettingsModule['key']) {
  if (moduleKey === 'regions') return '区域';
  if (moduleKey === 'job_titles') return '职称';
  if (moduleKey === 'employment_types') return '雇佣';
  if (moduleKey === 'region_permissions') return '地区权限';
  return '权限';
}

