import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Edit3, Plus, RefreshCw, Search } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import { useAuth } from '../hooks/useAuth';
import { usePermissions } from '../hooks/usePermissions';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { type EmployeeFormValues, type EmployeeListItem, type StaffOptions, staffService } from '../services/staff.service';
import type { EmployeeStatus } from '../types/database';

const emptyForm: EmployeeFormValues = {
  full_name: '',
  nickname: '',
  avatar_url: '',
  phone: '',
  email: '',
  employee_code: '',
  gender: '',
  birthday: '',
  identity_number: '',
  address: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  emergency_contact_relationship: '',
  bank_name: '',
  bank_account: '',
  bank_account_name: '',
  base_salary: '',
  region_id: '',
  employment_type_id: '',
  job_title_id: '',
  status: 'active',
  hire_date: '',
  employment_end_date: '',
  start_work_time: '09:00',
  end_work_time: '18:00',
  require_attendance: true,
};

const statusLabels: Record<string, string> = {
  active: '在职',
  probation: '试用期',
  inactive: '停职',
  suspended: '停职',
  left: '离职',
};

const statusSortOrder: Record<string, number> = {
  active: 0,
  probation: 1,
  inactive: 2,
  suspended: 2,
  left: 3,
};

function getEmployeeStatus(status: EmployeeStatus | string | null | undefined) {
  return status || 'active';
}

export function StaffPage() {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const canManageStaff = permissions.canUse('staff');
  const canEditEmployeeCode = profile?.role === 'super_admin';
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [options, setOptions] = useState<StaffOptions>({ regions: [], employmentTypes: [], jobTitles: [] });
  const [formValues, setFormValues] = useState<EmployeeFormValues>(emptyForm);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeListItem | null>(null);
  const [avatarPreviewEmployee, setAvatarPreviewEmployee] = useState<EmployeeListItem | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeListItem | null>(null);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<EmployeeStatus | 'all'>('active');
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const filteredEmployees = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    const visibleEmployees = employees.filter((employee) => {
      const matchesKeyword =
        !keyword ||
        [employee.full_name, employee.nickname, employee.employee_code, employee.job_title?.name]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(keyword));
      const matchesRegion = !regionFilter || employee.region_id === regionFilter;
      const matchesStatus = statusFilter === 'all' || getEmployeeStatus(employee.status) === statusFilter;
      const matchesEmploymentType = !employmentTypeFilter || employee.employment_type_id === employmentTypeFilter;

      return matchesKeyword && matchesRegion && matchesStatus && matchesEmploymentType;
    });

    return [...visibleEmployees].sort((first, second) => {
      const firstStatus = statusSortOrder[getEmployeeStatus(first.status)] ?? statusSortOrder.active;
      const secondStatus = statusSortOrder[getEmployeeStatus(second.status)] ?? statusSortOrder.active;
      if (firstStatus !== secondStatus) return firstStatus - secondStatus;
      return first.full_name.localeCompare(second.full_name, 'zh-Hans');
    });
  }, [employees, employmentTypeFilter, regionFilter, searchTerm, statusFilter]);

  useEffect(() => {
    void loadStaffData();
  }, []);

  usePullToRefresh(loadStaffData);

  async function loadStaffData() {
    setLoading(true);
    setError('');

    try {
      const [employeeList, optionList] = await Promise.all([staffService.listEmployees(), staffService.getOptions()]);
      setEmployees(employeeList);
      setOptions(optionList);
    } catch (loadError) {
      setError(`读取工作人员资料失败：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const nextValues = {
        ...formValues,
        employee_code: formValues.employee_code.trim().toUpperCase(),
      };

      if (nextValues.status === 'left' && !nextValues.employment_end_date) {
        throw new Error('离职日期为必填');
      }

      if (nextValues.status !== 'left') {
        nextValues.employment_end_date = '';
      }

      if (editingEmployee && canEditEmployeeCode && !nextValues.employee_code) {
        throw new Error('员工编号不可为空');
      }

      if (editingEmployee) {
        validateWorkTimes(nextValues.start_work_time, nextValues.end_work_time);
        const workTimeChanged =
          normalizeTime(nextValues.start_work_time) !== normalizeTime(editingEmployee.start_work_time) ||
          normalizeTime(nextValues.end_work_time) !== normalizeTime(editingEmployee.end_work_time);
        const updatedEmployee = await staffService.updateEmployee(editingEmployee.id, nextValues);

        if (
          normalizeTime(updatedEmployee.start_work_time) !== normalizeTime(nextValues.start_work_time) ||
          normalizeTime(updatedEmployee.end_work_time) !== normalizeTime(nextValues.end_work_time)
        ) {
          throw new Error('数据库重新读取到的工作时间与本次修改不一致。');
        }

        setEmployees((current) => current.map((employee) => (employee.id === updatedEmployee.id ? updatedEmployee : employee)));
        setEditingEmployee(updatedEmployee);
        setFormValues(toFormValues(updatedEmployee));
        setMessage(workTimeChanged ? '工作时间已成功更新' : '工作人员资料已成功更新');
      } else {
        validateWorkTimes(nextValues.start_work_time, nextValues.end_work_time);
        await staffService.createEmployee(nextValues);
        setMessage('工作人员已新增。');
        resetForm();
        await loadStaffData();
      }
    } catch (saveError) {
      console.error('Failed to save staff work time', saveError);
      const actionLabel = editingEmployee ? '工作时间更新失败' : '新增工作人员失败';
      setError(`${actionLabel}：${getStaffSaveErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  function openCreate() {
    setEditingEmployee(null);
    setFormValues(emptyForm);
    setShowStaffModal(true);
    setMessage('');
    setError('');
  }

  function handleEdit(employee: EmployeeListItem) {
    setEditingEmployee(employee);
    setShowStaffModal(true);
    setMessage('');
    setError('');
    setFormValues(toFormValues(employee));
  }

  function resetForm() {
    setEditingEmployee(null);
    setFormValues(emptyForm);
    setShowStaffModal(false);
  }

  return (
    <section className="staff-page">
      <div className="toolbar-actions staff-actions-row">
        {canManageStaff ? (
          <button className="secondary-action" type="button" onClick={openCreate}>
            <Plus size={17} />
            <span>新增员工</span>
          </button>
        ) : null}
        <button className="secondary-action" type="button" onClick={loadStaffData} disabled={loading}>
          <RefreshCw size={17} />
          <span>刷新</span>
        </button>
      </div>

      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      <div className="staff-list-panel">
        <div className="list-header staff-filter-header">
          <label className="table-search staff-filter-search">
            <Search size={16} />
            <input
              placeholder="搜索姓名 / 昵称 / 员工编号"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>
          <select className="staff-region-filter" value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
            <option value="">全部区域</option>
            {options.regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.code}
              </option>
            ))}
          </select>
          <select
            className="staff-region-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as EmployeeStatus | 'all')}
          >
            <option value="all">全部</option>
            <option value="active">在职</option>
            <option value="probation">试用期</option>
            <option value="inactive">停职</option>
            <option value="left">离职</option>
          </select>
          <select
            className="staff-region-filter"
            value={employmentTypeFilter}
            onChange={(event) => setEmploymentTypeFilter(event.target.value)}
          >
            <option value="">全部类型</option>
            {options.employmentTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="table-state">正在读取工作人员...</div>
        ) : filteredEmployees.length === 0 ? (
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
                {filteredEmployees.map((employee) => (
                  <StaffListRow
                    key={employee.id}
                    employee={employee}
                    onOpenAvatar={() => setAvatarPreviewEmployee(employee)}
                    onOpenDetail={() => setSelectedEmployee(employee)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedEmployee ? (
        <EmployeeDetailModal
          employee={selectedEmployee}
          canManageStaff={canManageStaff}
          onClose={() => setSelectedEmployee(null)}
          onEdit={() => {
            setSelectedEmployee(null);
            handleEdit(selectedEmployee);
          }}
        />
      ) : null}

      {avatarPreviewEmployee ? (
        <AvatarPreviewModal employee={avatarPreviewEmployee} onClose={() => setAvatarPreviewEmployee(null)} />
      ) : null}

      {showStaffModal && canManageStaff ? (
        <StaffFormModal
          values={formValues}
          options={options}
          editingEmployee={editingEmployee}
          saving={saving}
          error={error}
          message={message}
          canEditEmployeeCode={canEditEmployeeCode}
          onChange={setFormValues}
          onClose={resetForm}
          onSubmit={handleSubmit}
        />
      ) : null}
    </section>
  );
}

function StaffListRow({
  employee,
  onOpenAvatar,
  onOpenDetail,
}: {
  employee: EmployeeListItem;
  onOpenAvatar: () => void;
  onOpenDetail: () => void;
}) {
  const status = getEmployeeStatus(employee.status);

  return (
    <tr>
      <td>
        <button className="employee-avatar-list-button" type="button" onClick={onOpenAvatar} aria-label={`查看 ${employee.full_name} 头像`}>
          <EmployeeAvatar employee={employee} />
        </button>
      </td>
      <td>
        <button className="text-link-button" type="button" onClick={onOpenDetail}>
          {employee.full_name}
        </button>
      </td>
      <td>{employee.nickname || '-'}</td>
      <td>{employee.region?.code ?? employee.region?.name ?? '-'}</td>
      <td>{employee.job_title?.name || '-'}</td>
      <td>
        <span className={`status-pill status-${status}`}>{statusLabels[status] ?? statusLabels.active}</span>
        {status === 'left' ? (
          <>
            {' '}
            <span className={`status-pill ${employee.employment_end_date ? 'status-left' : 'status-inactive'}`}>
              {employee.employment_end_date ? `离职：${employee.employment_end_date}` : '缺少离职日期'}
            </span>
          </>
        ) : null}
      </td>
    </tr>
  );
}

function AvatarPreviewModal({ employee, onClose }: { employee: EmployeeListItem; onClose: () => void }) {
  return (
    <SystemModal title="查看头像" ariaLabel="查看头像" className="avatar-preview-modal" onClose={onClose}>
      <div className="avatar-preview-content">
        {employee.avatar_url ? (
          <img src={employee.avatar_url} alt={employee.full_name + ' 头像'} />
        ) : (
          <EmployeeAvatar employee={employee} large />
        )}
      </div>
    </SystemModal>
  );
}

function EmployeeDetailModal({
  employee,
  canManageStaff,
  onClose,
  onEdit,
}: {
  employee: EmployeeListItem;
  canManageStaff: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <>
      <SystemModal
        title={employee.full_name}
        subtitle="员工详情"
        ariaLabel="员工详情"
        onClose={onClose}
        footer={
          canManageStaff ? (
            <>
              <button className="secondary-button compact-button" type="button" onClick={onClose}>
                关闭
              </button>
              <button className="primary-button compact-button" type="button" onClick={onEdit}>
                <Edit3 size={16} />
                <span>编辑资料</span>
              </button>
            </>
          ) : (
            <button className="secondary-button compact-button" type="button" onClick={onClose}>
              关闭
            </button>
          )
        }
      >
        <div className="employee-detail-sections">
          <section className="employee-identity-card">
            <div className="detail-avatar-row">
              <button className="employee-avatar-preview-button" type="button" onClick={() => setPreviewOpen(true)}>
                <EmployeeAvatar employee={employee} large />
              </button>
              <div>
                <h3>{employee.full_name}</h3>
                <strong>{employee.employee_code || '未填写'}</strong>
                <div className="employee-identity-meta">
                  <span>{employee.job_title?.name || '未填写'}</span>
                  <span>{employee.region?.name ?? employee.region?.code ?? '未填写'}</span>
                  <span>{statusLabels[getEmployeeStatus(employee.status)] ?? statusLabels.active}</span>
                </div>
              </div>
            </div>
          </section>

          <DetailSection title="基本资料">
            <Info label="姓名" value={employee.full_name} />
            <Info label="昵称" value={employee.nickname} />
            <Info label="性别" value={formatGender(employee.gender)} />
            <Info label="电话" value={employee.phone} />
            <Info label="邮箱" value={employee.email} />
            <Info label="生日" value={employee.birthday} />
            <Info label="地址" value={employee.address} />
          </DetailSection>

          <DetailSection title="工作资料">
            <Info label="职称" value={employee.job_title?.name} />
            <Info label="区域" value={employee.region?.name ?? employee.region?.code} />
            <Info label="雇佣类型" value={employee.employment_type?.name} />
            <Info label="状态" value={statusLabels[getEmployeeStatus(employee.status)] ?? statusLabels.active} />
            <Info label="入职日期" value={employee.hire_date} />
            {employee.status === 'left' ? <Info label="离职日期" value={employee.employment_end_date} /> : null}
            <Info label="正式日期" value={employee.hire_date ? calculateConfirmDate(employee.hire_date) : employee.probation_confirm_date} />
            <Info label="上班时间" value={formatTime(employee.start_work_time)} />
            <Info label="下班时间" value={formatTime(employee.end_work_time)} />
          </DetailSection>

          <DetailSection title="银行资料">
            <Info label="银行" value={employee.bank_name} />
            <Info label="户口号码" value={employee.bank_account} />
            <Info label="户口姓名" value={employee.bank_account_name} />
          </DetailSection>

          <DetailSection title="紧急联络资料">
            <Info label="联络人姓名" value={employee.emergency_contact_name} />
            <Info label="联络电话" value={employee.emergency_contact_phone} />
            <Info label="关系" value={employee.emergency_contact_relationship} />
          </DetailSection>

          <DetailSection title="敏感资料">
            <Info label="身份证号码" value={employee.identity_number} />
            <Info label="基本薪资" value={formatMoney(employee.base_salary)} />
          </DetailSection>

          <DetailSection title="系统资料">
            <Info label="注册时间" value={formatDateTime(employee.created_at)} />
            <Info label="审核时间" value={formatDateTime(employee.reviewed_at)} />
            <Info label="审核人" value={employee.reviewer?.full_name ?? employee.reviewer?.email} />
            <Info label="最后更新时间" value={formatDateTime(employee.updated_at)} />
          </DetailSection>
        </div>
      </SystemModal>

      {previewOpen ? (
        <SystemModal title={employee.full_name} subtitle="头像预览" ariaLabel="头像预览" className="profile-preview-modal" onClose={() => setPreviewOpen(false)}>
          {employee.avatar_url ? <img src={employee.avatar_url} alt={employee.full_name + ' 头像'} /> : <EmployeeAvatar employee={employee} large />}
        </SystemModal>
      ) : null}
    </>
  );
}

type StaffFormModalProps = {
  values: EmployeeFormValues;
  options: StaffOptions;
  editingEmployee: EmployeeListItem | null;
  saving: boolean;
  error: string;
  message: string;
  canEditEmployeeCode: boolean;
  onChange: (values: EmployeeFormValues) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function StaffFormModal({
  values,
  options,
  editingEmployee,
  saving,
  error,
  message,
  canEditEmployeeCode,
  onChange,
  onClose,
  onSubmit,
}: StaffFormModalProps) {
  return (
    <SystemModal
      title={editingEmployee ? editingEmployee.full_name : '员工资料'}
      subtitle={editingEmployee ? '编辑资料' : '新增员工'}
      ariaLabel="工作人员资料"
      onClose={onClose}
      footer={
        <>
          <button className="secondary-button compact-button" type="button" onClick={onClose}>
            关闭
          </button>
          <button className="primary-button compact-button" type="submit" form="staff-form" disabled={saving}>
            <Plus size={18} />
            <span>{saving ? '保存中...' : editingEmployee ? '保存修改' : '新增员工'}</span>
          </button>
        </>
      }
    >
        <form id="staff-form" onSubmit={onSubmit}>
          <div className="form-grid">
            <FormSectionTitle title="基本资料" />
            <TextField label="姓名" value={values.full_name} onChange={(value) => onChange({ ...values, full_name: value })} required />
            <TextField label="昵称" value={values.nickname} onChange={(value) => onChange({ ...values, nickname: value })} />
            <label className="form-field">
              <span>性别</span>
              <select value={values.gender} onChange={(event) => onChange({ ...values, gender: event.target.value })}>
                <option value="">未选择</option>
                <option value="male">男</option>
                <option value="female">女</option>
              </select>
            </label>
            <TextField label="电话" value={values.phone} onChange={(value) => onChange({ ...values, phone: value })} />
            <TextField label="邮箱" type="email" value={values.email} onChange={(value) => onChange({ ...values, email: value })} />
            <TextField label="生日" type="date" value={values.birthday} onChange={(value) => onChange({ ...values, birthday: value })} />
            <TextField label="地址" value={values.address} onChange={(value) => onChange({ ...values, address: value })} />

            <FormSectionTitle title="工作资料" />
            {canEditEmployeeCode ? (
              <TextField
                label="员工编号"
                value={values.employee_code}
                onChange={(value) => onChange({ ...values, employee_code: value.toUpperCase() })}
                required={Boolean(editingEmployee)}
              />
            ) : (
              <ReadOnlyField label="员工编号" value={values.employee_code || '系统自动生成'} />
            )}

            <label className="form-field">
              <span>职称</span>
              <select value={values.job_title_id} onChange={(event) => onChange({ ...values, job_title_id: event.target.value })}>
                <option value="">未选择</option>
                {options.jobTitles.map((title) => (
                  <option key={title.id} value={title.id}>
                    {title.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              <span>区域</span>
              <select value={values.region_id} onChange={(event) => onChange({ ...values, region_id: event.target.value })}>
                <option value="">未选择</option>
                {options.regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.code}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              <span>雇佣类型</span>
              <select value={values.employment_type_id} onChange={(event) => onChange({ ...values, employment_type_id: event.target.value })}>
                <option value="">未选择</option>
                {options.employmentTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </label>

            <TextField label="入职日期" type="date" value={values.hire_date} onChange={(value) => onChange({ ...values, hire_date: value })} />
            <ReadOnlyField label="正式日期" value={calculateConfirmDate(values.hire_date)} />
            <TextField label="上班时间" type="time" value={values.start_work_time} onChange={(value) => onChange({ ...values, start_work_time: value })} />
            <TextField label="下班时间" type="time" value={values.end_work_time} onChange={(value) => onChange({ ...values, end_work_time: value })} />

            <label className="form-field">
              <span>状态</span>
              <select
                value={values.status}
                onChange={(event) => {
                  const status = event.target.value as EmployeeStatus;
                  onChange({
                    ...values,
                    status,
                    employment_end_date: status === 'left' ? values.employment_end_date || getCurrentDateInputValue() : '',
                  });
                }}
              >
                <option value="probation">试用期</option>
                <option value="active">在职</option>
                <option value="inactive">停职</option>
                <option value="left">离职</option>
              </select>
            </label>

            {values.status === 'left' ? (
              <TextField
                label="离职日期"
                type="date"
                value={values.employment_end_date}
                onChange={(value) => onChange({ ...values, employment_end_date: value })}
              />
            ) : null}

            <FormSectionTitle title="银行资料" />
            <TextField label="银行" value={values.bank_name} onChange={(value) => onChange({ ...values, bank_name: value })} />
            <TextField label="户口号码" value={values.bank_account} onChange={(value) => onChange({ ...values, bank_account: value })} />
            <TextField label="户口姓名" value={values.bank_account_name} onChange={(value) => onChange({ ...values, bank_account_name: value })} />

            <FormSectionTitle title="紧急联络资料" />
            <TextField label="联络人姓名" value={values.emergency_contact_name} onChange={(value) => onChange({ ...values, emergency_contact_name: value })} />
            <TextField label="联络电话" value={values.emergency_contact_phone} onChange={(value) => onChange({ ...values, emergency_contact_phone: value })} />
            <TextField label="关系" value={values.emergency_contact_relationship} onChange={(value) => onChange({ ...values, emergency_contact_relationship: value })} />

            <FormSectionTitle title="敏感资料" />
            <TextField label="身份证号码" value={values.identity_number} onChange={(value) => onChange({ ...values, identity_number: value })} />
            <TextField label="基本薪资" type="number" value={values.base_salary} onChange={(value) => onChange({ ...values, base_salary: value })} />
          </div>

          {error ? <p className="form-alert">{error}</p> : null}
          {message ? <p className="form-success">{message}</p> : null}
        </form>
    </SystemModal>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="employee-detail-section">
      <h4>{title}</h4>
      <div className="detail-list">{children}</div>
    </section>
  );
}

function FormSectionTitle({ title }: { title: string }) {
  return <h4 className="form-section-title">{title}</h4>;
}

function EmployeeAvatar({ employee, large = false }: { employee: EmployeeListItem; large?: boolean }) {
  const initial = employee.full_name.slice(0, 1).toUpperCase();
  return (
    <span className={large ? 'employee-avatar large' : 'employee-avatar'}>
      {employee.avatar_url ? <img src={employee.avatar_url} alt={employee.full_name} /> : initial}
    </span>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || '未填写'}</strong>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input value={value || '自动计算'} disabled />
    </label>
  );
}

function toFormValues(employee: EmployeeListItem): EmployeeFormValues {
  return {
    full_name: employee.full_name,
    nickname: employee.nickname ?? '',
    avatar_url: employee.avatar_url ?? '',
    phone: employee.phone ?? '',
    email: employee.email ?? '',
    employee_code: employee.employee_code ?? '',
    gender: employee.gender ?? '',
    birthday: employee.birthday ?? '',
    identity_number: employee.identity_number ?? '',
    address: employee.address ?? '',
    emergency_contact_name: employee.emergency_contact_name ?? '',
    emergency_contact_phone: employee.emergency_contact_phone ?? '',
    emergency_contact_relationship: employee.emergency_contact_relationship ?? '',
    bank_name: employee.bank_name ?? '',
    bank_account: employee.bank_account ?? '',
    bank_account_name: employee.bank_account_name ?? '',
    base_salary: employee.base_salary === null ? '' : String(employee.base_salary),
    region_id: employee.region_id ?? '',
    employment_type_id: employee.employment_type_id ?? '',
    job_title_id: employee.job_title_id ?? '',
    status: employee.status,
    hire_date: employee.hire_date ?? '',
    employment_end_date: employee.employment_end_date ?? '',
    start_work_time: normalizeTime(employee.start_work_time),
    end_work_time: normalizeTime(employee.end_work_time),
    require_attendance: employee.require_attendance,
  };
}

function calculateConfirmDate(hireDate: string) {
  if (!hireDate) return '';
  const date = new Date(`${hireDate}T00:00:00`);
  date.setMonth(date.getMonth() + 3);
  return toDateKey(date);
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentDateInputValue() {
  return toDateKey(new Date());
}

function formatTime(value: string | null | undefined) {
  return value ? value.slice(0, 5) : '';
}

function formatMoney(value: number | null) {
  return value === null ? '' : `RM ${value.toFixed(2)}`;
}

function formatGender(value: string | null | undefined) {
  if (value === 'male') return '男';
  if (value === 'female') return '女';
  return value || '';
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-MY', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return '未知错误';
}

function normalizeTime(value: string | null | undefined) {
  return value ? value.slice(0, 5) : '';
}

function validateWorkTimes(startTime: string, endTime: string) {
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (!timePattern.test(startTime) || !timePattern.test(endTime)) {
    throw new Error('开始时间和结束时间格式不正确。');
  }

  if (endTime <= startTime) {
    throw new Error('下班时间必须晚于上班时间。');
  }
}

function getStaffSaveErrorMessage(error: unknown) {
  const rawMessage = getErrorMessage(error);
  const normalizedMessage = rawMessage.toLowerCase();
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : '';

  if (rawMessage.includes('开始时间和结束时间格式不正确') || rawMessage.includes('下班时间必须晚于上班时间')) {
    return rawMessage;
  }

  if (rawMessage.includes('数据库没有更新任何资料')) {
    return rawMessage;
  }

  if (rawMessage.includes('找不到对应的工作人员记录')) {
    return rawMessage;
  }

  if (rawMessage.includes('员工编号已存在') || rawMessage.includes('员工编号不可为空')) {
    return rawMessage;
  }

  if (rawMessage.includes('请求超时')) {
    return '请求超时，请检查网络后重试';
  }

  if (code === '42501' || normalizedMessage.includes('permission') || normalizedMessage.includes('row-level security') || rawMessage.includes('无权')) {
    return '没有权限修改该工作人员，请确认区域和工作人员权限。';
  }

  if (
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('network') ||
    normalizedMessage.includes('load failed')
  ) {
    return '网络连接失败，请稍后再试。';
  }

  if (code === '23514' || normalizedMessage.includes('check constraint')) {
    return '数据库拒绝了此次操作，请检查工作时间是否符合规定。';
  }

  return '数据库拒绝了此次操作，请稍后再试或联系系统管理员。';
}
