import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Eye, RefreshCw } from 'lucide-react';
import { MonthSelect } from '../components/MonthSelect';
import { SystemModal } from '../components/SystemModal';
import { useAuth } from '../hooks/useAuth';
import { usePermissions } from '../hooks/usePermissions';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import {
  AttendanceEmployee,
  AttendanceRestDay,
  attendanceManagementService,
  getAttendancePeriodRange,
} from '../services/attendanceManagement.service';
import type {
  AttendanceAbnormalReviewHistory,
  AttendanceAbnormalReviewStatus,
  AttendanceRecord,
  LeaveRequest,
  LeaveType,
  PublicHoliday,
  Region,
} from '../types/database';

type DailyRecord = {
  date: string;
  clockIn: AttendanceRecord | null;
  breakStart: AttendanceRecord | null;
  breakEnd: AttendanceRecord | null;
  clockOut: AttendanceRecord | null;
  workHours: number | null;
  breakMinutes: number;
  status: string;
};

type EmployeeAttendanceSummary = {
  employee: AttendanceEmployee;
  lateCount: number;
  earlyLeaveCount: number;
  absentCount: number;
  overtimeBreakCount: number;
  abnormalPunchCount: number;
  leaveCounts: Record<LeaveType, number>;
  dailyRecords: DailyRecord[];
  abnormalRecords: AbnormalRecord[];
};

type AbnormalRecord = {
  id: string;
  attendanceRecordId: string;
  employee: AttendanceEmployee;
  type: string;
  punchType: AttendanceRecord['punch_type'];
  sourceAbnormalTypes: string[];
  reviewStatus: AttendanceAbnormalReviewStatus;
  reviewReason: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  punchedAt: string;
  gps: string;
  ip: string;
  deviceInfo: string;
  photoPath: string;
};

type AbnormalReviewSnapshot = {
  reviewStatus: AttendanceAbnormalReviewStatus;
  reason: string | null;
  reviewedByName: string;
  reviewedAt: string;
};

type AbnormalCenterTab = 'pending' | 'abnormal';

const leaveTypeLabels: Record<LeaveType, string> = {
  annual: '年假',
  medical: '病假',
  unpaid: '无薪假',
  replacement: '调休',
};

export function AttendanceManagementPage() {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const canUseAttendance = permissions.canUse('attendance-management');
  const [month, setMonth] = useState(getCurrentMonth());
  const [regionId, setRegionId] = useState('');
  const [regions, setRegions] = useState<Region[]>([]);
  const [summaries, setSummaries] = useState<EmployeeAttendanceSummary[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [showAbnormalCenter, setShowAbnormalCenter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canViewAllRegions = profile?.role === 'super_admin' || Boolean(profile?.can_view_all_regions);
  const range = useMemo(() => getAttendancePeriodRange(month), [month]);
  const selectedSummary = summaries.find((summary) => summary.employee.id === selectedEmployeeId) ?? null;
  const abnormalRecords = summaries.flatMap((summary) => summary.abnormalRecords);
  const pendingAbnormalRecords = abnormalRecords.filter((record) => record.reviewStatus === 'pending');
  const abnormalEmployeeCount = new Set(pendingAbnormalRecords.map((record) => record.employee.id)).size;

  useEffect(() => {
    loadAttendanceData();
  }, [month, regionId]);

  usePullToRefresh(loadAttendanceData, [month, regionId]);

  async function loadAttendanceData(options: { resetView?: boolean } = {}) {
    const { resetView = true } = options;
    setLoading(true);
    setError('');

    try {
      const data = await attendanceManagementService.getPeriodData(month, regionId);
      setRegions(data.regions);
      setSummaries(
        buildSummaries(
          data.employees,
          data.attendanceRecords,
          data.abnormalReviewHistory,
          data.leaveRequests,
          data.restDays,
          data.publicHolidays,
          data.range.startDate,
          data.range.endDate,
        ),
      );
      if (resetView) {
        setSelectedEmployeeId('');
        setShowAbnormalCenter(false);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取考勤数据失败。');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="attendance-management-page">
      <div className="staff-toolbar">
        <div className="page-heading">
          <span>工作工具 / 人事部</span>
          <h2>考勤</h2>
          <p>{range.startDate} 至 {range.endDate}，按公司考勤周期统计迟到、早退、旷工与异常打卡。</p>
        </div>

        <button className="secondary-action" type="button" onClick={() => loadAttendanceData()} disabled={loading}>
          <RefreshCw size={17} />
          <span>刷新</span>
        </button>
      </div>

      {canUseAttendance ? (
        <button className="abnormal-banner" type="button" onClick={() => setShowAbnormalCenter(true)}>
          <AlertTriangle size={20} />
          <span>异常打卡提醒</span>
          <strong>{abnormalEmployeeCount} 位员工</strong>
        </button>
      ) : null}

      <p className="abnormal-cycle-count">本周期异常次数：{pendingAbnormalRecords.length}</p>

      <div className="attendance-filters">
        <label className="form-field">
          <span>考勤月份</span>
          <MonthSelect value={month} onChange={setMonth} />
        </label>

        <label className="form-field">
          <span>区域</span>
          <select
            value={regionId}
            disabled={!canViewAllRegions}
            onChange={(event) => setRegionId(event.target.value)}
          >
            <option value="">全部可查看区域</option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.code}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="staff-list-panel">
        <div className="list-header">
          <div>
            <span>考勤主表</span>
            <h3>{summaries.length} 位员工</h3>
          </div>
        </div>

        {error ? <p className="form-alert table-alert">{error}</p> : null}

        {loading ? (
          <div className="table-state">正在读取考勤数据...</div>
        ) : summaries.length === 0 ? (
          <div className="table-state">暂无考勤数据。</div>
        ) : (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>昵称</th>
                  <th>迟到</th>
                  <th>早退</th>
                  <th>旷工</th>
                  <th>超时</th>
                  <th>异常</th>
                  {canUseAttendance ? <th className="attendance-detail-col">查看详情</th> : null}
                </tr>
              </thead>
              <tbody>
                {summaries.map((summary) => (
                  <tr key={summary.employee.id}>
                    <td>
                      {canUseAttendance ? (
                        <button
                          className="text-link-button"
                          type="button"
                          onClick={() => {
                            setSelectedEmployeeId(summary.employee.id);
                            setShowAbnormalCenter(false);
                          }}
                        >
                          {getEmployeeDisplayName(summary.employee)}
                        </button>
                      ) : (
                        getEmployeeDisplayName(summary.employee)
                      )}
                    </td>
                    <td>{summary.lateCount}</td>
                    <td>{summary.earlyLeaveCount}</td>
                    <td>{summary.absentCount}</td>
                    <td>{summary.overtimeBreakCount}</td>
                    <td>{summary.abnormalPunchCount}</td>
                    {canUseAttendance ? (
                      <td className="attendance-detail-col">
                        <button
                          className="secondary-button compact-button"
                          type="button"
                          onClick={() => {
                            setSelectedEmployeeId(summary.employee.id);
                            setShowAbnormalCenter(false);
                          }}
                        >
                          <Eye size={16} />
                          <span>查看详情</span>
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAbnormalCenter && canUseAttendance ? (
        <AbnormalEmployeeCenterV2
          records={abnormalRecords}
          onClose={() => setShowAbnormalCenter(false)}
          onReviewed={() => loadAttendanceData({ resetView: false })}
        />
      ) : null}
      {selectedSummary && canUseAttendance ? <EmployeeDetail summary={selectedSummary} onClose={() => setSelectedEmployeeId('')} /> : null}
    </section>
  );
}

function EmployeeDetail({ summary, onClose }: { summary: EmployeeAttendanceSummary; onClose: () => void }) {
  return (
    <SystemModal
      title={getEmployeeDisplayName(summary.employee)}
      subtitle="员工考勤详情"
      ariaLabel="员工考勤详情"
      onClose={onClose}
      footer={
        <button className="secondary-button compact-button" type="button" onClick={onClose}>
          关闭
        </button>
      }
    >
      <div className="employee-detail-sections">
        <section className="employee-detail-section">
          <h4>基础资料</h4>
          <div className="detail-list">
            <div><span>昵称</span><strong>{getEmployeeDisplayName(summary.employee)}</strong></div>
            <div><span>员工编号</span><strong>{summary.employee.employee_code ?? '-'}</strong></div>
            <div><span>区域</span><strong>{summary.employee.region?.code ?? '-'}</strong></div>
          </div>
        </section>

        <section className="employee-detail-section">
          <h4>工作资料</h4>
          <div className="leave-stats-grid">
            <StatCard label="迟到次数" value={summary.lateCount} />
            <StatCard label="早退次数" value={summary.earlyLeaveCount} />
            <StatCard label="旷工次数" value={summary.absentCount} />
            <StatCard label="超时休息次数" value={summary.overtimeBreakCount} />
          </div>
        </section>

        <section className="employee-detail-section">
          <h4>薪资资料</h4>
          <div className="leave-stats-grid">
            <StatCard label="年假次数" value={summary.leaveCounts.annual} />
            <StatCard label="病假次数" value={summary.leaveCounts.medical} />
            <StatCard label="无薪假次数" value={summary.leaveCounts.unpaid} />
            <StatCard label="调休次数" value={summary.leaveCounts.replacement} />
          </div>
        </section>

        <section className="employee-detail-section">
          <h4>班次资料</h4>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>上班时间</th>
                  <th>开始休息</th>
                  <th>结束休息</th>
                  <th>下班时间</th>
                  <th>工作时长</th>
                  <th>休息时长</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {summary.dailyRecords.map((record) => (
                  <tr key={record.date}>
                    <td>{record.date}</td>
                    <td>{formatRecordTime(record.clockIn)}</td>
                    <td>{formatRecordTime(record.breakStart)}</td>
                    <td>{formatRecordTime(record.breakEnd)}</td>
                    <td>{formatRecordTime(record.clockOut)}</td>
                    <td>{record.workHours === null ? '-' : `${record.workHours.toFixed(1)} 小时`}</td>
                    <td>{record.breakMinutes ? `${record.breakMinutes} 分钟` : '-'}</td>
                    <td>{record.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </SystemModal>
  );
}

function AbnormalEmployeeCenterV2({
  records,
  onClose,
  onReviewed,
}: {
  records: AbnormalRecord[];
  onClose: () => void;
  onReviewed: () => Promise<void>;
}) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [activeTab, setActiveTab] = useState<AbnormalCenterTab>('pending');
  const [openingPhotoId, setOpeningPhotoId] = useState('');
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoError, setPhotoError] = useState('');
  const [reviewingId, setReviewingId] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [abnormalReasonRecordId, setAbnormalReasonRecordId] = useState('');
  const [abnormalReason, setAbnormalReason] = useState('');
  const pendingCount = records.filter((record) => record.reviewStatus === 'pending').length;
  const abnormalCount = records.filter((record) => record.reviewStatus === 'abnormal').length;
  const tabRecords = useMemo(
    () => records.filter((record) => record.reviewStatus === activeTab),
    [activeTab, records],
  );
  const groupedEmployees = useMemo(() => {
    const map = new Map<string, { employee: AttendanceEmployee; records: AbnormalRecord[] }>();

    tabRecords.forEach((record) => {
      const current = map.get(record.employee.id) ?? { employee: record.employee, records: [] };
      current.records.push(record);
      map.set(record.employee.id, current);
    });

    return [...map.values()].sort((a, b) => b.records.length - a.records.length);
  }, [tabRecords]);
  const selected = groupedEmployees.find((item) => item.employee.id === selectedEmployeeId) ?? null;

  useEffect(() => {
    setSelectedEmployeeId('');
    setReviewError('');
    setPhotoError('');
    setAbnormalReasonRecordId('');
    setAbnormalReason('');
  }, [activeTab]);

  useEffect(() => {
    if (!selected) {
      return;
    }

    selected.records.forEach((record) => {
      if (!record.photoPath || photoUrls[record.photoPath]) {
        return;
      }

      attendanceManagementService
        .getAttendancePhotoSignedUrl(record.photoPath)
        .then((signedUrl) => {
          setPhotoUrls((current) => ({ ...current, [record.photoPath]: signedUrl }));
        })
        .catch(() => {
          setPhotoError('读取打卡照片失败，请稍后重试或联系管理员。');
        });
    });
  }, [photoUrls, selected]);

  async function handleOpenPhoto(record: AbnormalRecord) {
    if (!record.photoPath) return;

    setPhotoError('');
    setOpeningPhotoId(record.id);
    const photoWindow = window.open('', '_blank');

    if (!photoWindow) {
      setPhotoError('浏览器阻止了新窗口，请允许弹出窗口后重试。');
      setOpeningPhotoId('');
      return;
    }

    photoWindow.opener = null;

    try {
      const signedUrl = photoUrls[record.photoPath] ?? await attendanceManagementService.getAttendancePhotoSignedUrl(record.photoPath);
      setPhotoUrls((current) => ({ ...current, [record.photoPath]: signedUrl }));
      setPhotoError('');
      photoWindow.location.href = signedUrl;
    } catch {
      const message = '读取打卡照片失败，请稍后重试或联系管理员。';
      setPhotoError(message);
      photoWindow.document.body.textContent = message;
    } finally {
      setOpeningPhotoId('');
    }
  }

  async function handleReview(record: AbnormalRecord, reviewStatus: Extract<AttendanceAbnormalReviewStatus, 'normal' | 'abnormal'>) {
    const reason = abnormalReason.trim();

    if (reviewStatus === 'abnormal' && !reason) {
      setReviewError('请填写异常原因。');
      setAbnormalReasonRecordId(record.id);
      return;
    }

    setReviewingId(record.id);
    setReviewError('');

    try {
      await attendanceManagementService.reviewAbnormalRecord({
        attendanceRecordId: record.attendanceRecordId,
        reviewStatus,
        sourceAbnormalTypes: record.sourceAbnormalTypes,
        reason: reviewStatus === 'abnormal' ? reason : null,
      });
      setAbnormalReasonRecordId('');
      setAbnormalReason('');
      await onReviewed();
    } catch (errorValue) {
      setReviewError(errorValue instanceof Error ? errorValue.message : '审核异常打卡失败，请稍后重试。');
    } finally {
      setReviewingId('');
    }
  }

  function renderPhoto(record: AbnormalRecord) {
    if (!record.photoPath) {
      return '-';
    }

    const signedUrl = photoUrls[record.photoPath];

    if (signedUrl) {
      return (
        <button className="text-link-button" type="button" onClick={() => handleOpenPhoto(record)}>
          <img
            src={signedUrl}
            alt="打卡照片"
            loading="lazy"
            style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6 }}
          />
        </button>
      );
    }

    return (
      <button
        className="secondary-button compact-button"
        type="button"
        onClick={() => handleOpenPhoto(record)}
        disabled={openingPhotoId === record.id}
      >
        <Eye size={16} />
        <span>{openingPhotoId === record.id ? '读取中' : '查看照片'}</span>
      </button>
    );
  }

  return (
    <SystemModal
      title={selected ? `${getEmployeeDisplayName(selected.employee)} 的异常记录` : `${tabRecords.length} 次异常`}
      subtitle="异常打卡中心"
      ariaLabel="异常打卡中心"
      className="abnormal-center-modal"
      onClose={onClose}
      footer={
        <>
          {selected ? (
            <button className="secondary-button compact-button" type="button" onClick={() => setSelectedEmployeeId('')}>
              返回员工列表
            </button>
          ) : null}
          <button className="primary-button compact-button" type="button" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="employee-detail-sections">
        <section className="employee-detail-section">
          <h4>基础资料</h4>
          <div className="attendance-filters">
            <button
              className={activeTab === 'pending' ? 'primary-button compact-button' : 'secondary-button compact-button'}
              type="button"
              onClick={() => setActiveTab('pending')}
            >
              待处理 {pendingCount}
            </button>
            <button
              className={activeTab === 'abnormal' ? 'primary-button compact-button' : 'secondary-button compact-button'}
              type="button"
              onClick={() => setActiveTab('abnormal')}
            >
              异常记录 {abnormalCount}
            </button>
          </div>
          <div className="detail-list">
            <div>
              <span>异常员工</span>
              <strong>{selected ? selected.employee.full_name : `${groupedEmployees.length} 位员工`}</strong>
            </div>
            <div>
              <span>异常次数</span>
              <strong>{selected ? selected.records.length : tabRecords.length}</strong>
            </div>
          </div>
        </section>

        <section className="employee-detail-section">
          <h4>工作资料</h4>
          {photoError ? <p className="form-alert table-alert">{photoError}</p> : null}
          {reviewError ? <p className="form-alert table-alert">{reviewError}</p> : null}
          {tabRecords.length === 0 ? (
            <div className="table-state">当前周期暂无异常打卡。</div>
          ) : selected ? (
            <div className="staff-table-wrap">
              <table className="staff-table abnormal-center-table">
                <thead>
                  <tr>
                    <th>照片</th>
                    <th>日期</th>
                    <th>打卡类型</th>
                    <th>异常类型</th>
                    <th>打卡时间</th>
                    {activeTab === 'pending' ? <th>审核</th> : null}
                    {activeTab === 'abnormal' ? <th>审核结果</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {selected.records.map((record) => (
                    <Fragment key={record.id}>
                    <tr>
                      <td>{renderPhoto(record)}</td>
                      <td>{toDateKey(new Date(record.punchedAt))}</td>
                      <td>{formatPunchType(record.punchType)}</td>
                      <td>{record.sourceAbnormalTypes.join(' + ')}</td>
                      <td>{new Date(record.punchedAt).toLocaleString('zh-CN')}</td>
                      {activeTab === 'pending' ? (
                        <td className="abnormal-review-cell">
                          {abnormalReasonRecordId === record.id ? (
                            <label className="form-field">
                              <span>异常原因</span>
                              <textarea
                                value={abnormalReason}
                                onChange={(event) => setAbnormalReason(event.target.value)}
                                placeholder="请填写异常原因"
                              />
                            </label>
                          ) : null}
                          <div className="abnormal-review-actions">
                            <button
                              className="secondary-button compact-button"
                              type="button"
                              onClick={() => handleReview(record, 'normal')}
                              disabled={Boolean(reviewingId)}
                            >
                              {reviewingId === record.id ? '提交中' : '正常'}
                            </button>
                            {abnormalReasonRecordId === record.id ? (
                              <button
                                className="primary-button compact-button"
                                type="button"
                                onClick={() => handleReview(record, 'abnormal')}
                                disabled={Boolean(reviewingId)}
                              >
                                {reviewingId === record.id ? '提交中' : '确认异常'}
                              </button>
                            ) : (
                              <button
                                className="primary-button compact-button"
                                type="button"
                                onClick={() => {
                                  setReviewError('');
                                  setAbnormalReason('');
                                  setAbnormalReasonRecordId(record.id);
                                }}
                                disabled={Boolean(reviewingId)}
                              >
                                异常
                              </button>
                            )}
                          </div>
                        </td>
                      ) : null}
                      {activeTab === 'abnormal' ? (
                        <td className="device-cell">
                          员工：{getEmployeeDisplayName(record.employee)} / 原因：{record.reviewReason ?? '-'} / 审核人：
                          {record.reviewedByName ?? '-'} / 审核时间：
                          {record.reviewedAt ? new Date(record.reviewedAt).toLocaleString('zh-CN') : '-'}
                        </td>
                      ) : null}
                    </tr>
                    <tr className="abnormal-technical-row">
                      <td colSpan={activeTab === 'pending' ? 6 : 6}>
                        <span>技术详情</span>
                        <strong>GPS：{record.gps} / IP：{record.ip} / 设备：{record.deviceInfo}</strong>
                      </td>
                    </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="staff-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>员工姓名</th>
                    <th>异常次数</th>
                    <th>查看</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedEmployees.map((item) => (
                    <tr key={item.employee.id}>
                      <td><strong>{getEmployeeDisplayName(item.employee)}</strong></td>
                      <td>异常 {item.records.length} 次</td>
                      <td>
                        <button className="secondary-button compact-button" type="button" onClick={() => setSelectedEmployeeId(item.employee.id)}>
                          <Eye size={16} />
                          <span>查看详情</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </SystemModal>
  );
}

function AbnormalEmployeeCenter({ records, onClose }: { records: AbnormalRecord[]; onClose: () => void }) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [openingPhotoId, setOpeningPhotoId] = useState('');
  const [photoError, setPhotoError] = useState('');
  const groupedEmployees = useMemo(() => {
    const map = new Map<string, { employee: AttendanceEmployee; records: AbnormalRecord[] }>();

    records.forEach((record) => {
      const current = map.get(record.employee.id) ?? { employee: record.employee, records: [] };
      current.records.push(record);
      map.set(record.employee.id, current);
    });

    return [...map.values()].sort((a, b) => b.records.length - a.records.length);
  }, [records]);
  const selected = groupedEmployees.find((item) => item.employee.id === selectedEmployeeId) ?? null;

  async function handleOpenPhoto(record: AbnormalRecord) {
    if (!record.photoPath) return;

    setPhotoError('');
    setOpeningPhotoId(record.id);
    const photoWindow = window.open('', '_blank');

    if (!photoWindow) {
      setPhotoError('浏览器阻止了新窗口，请允许弹出窗口后重试。');
      setOpeningPhotoId('');
      return;
    }

    photoWindow.opener = null;

    try {
      const signedUrl = await attendanceManagementService.getAttendancePhotoSignedUrl(record.photoPath);
      setPhotoError('');
      photoWindow.location.href = signedUrl;
    } catch {
      const message = '读取打卡照片失败，请稍后重试或联系管理员。';
      setPhotoError(message);
      photoWindow.document.body.textContent = message;
    } finally {
      setOpeningPhotoId('');
    }
  }

  return (
    <SystemModal
      title={selected ? `${getEmployeeDisplayName(selected.employee)} 的异常记录` : `${records.length} 次异常`}
      subtitle="异常打卡中心"
      ariaLabel="异常打卡中心"
      onClose={onClose}
      footer={
        <>
          {selected ? (
            <button className="secondary-button compact-button" type="button" onClick={() => setSelectedEmployeeId('')}>
              返回员工列表
            </button>
          ) : null}
          <button className="primary-button compact-button" type="button" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="employee-detail-sections">
        <section className="employee-detail-section">
          <h4>基础资料</h4>
          <div className="detail-list">
            <div>
              <span>异常员工</span>
              <strong>{selected ? selected.employee.full_name : `${groupedEmployees.length} 位员工`}</strong>
            </div>
            <div>
              <span>异常次数</span>
              <strong>{selected ? selected.records.length : records.length}</strong>
            </div>
          </div>
        </section>

        <section className="employee-detail-section">
          <h4>工作资料</h4>
          {photoError ? <p className="form-alert table-alert">{photoError}</p> : null}
          {records.length === 0 ? (
            <div className="table-state">当前周期暂无异常打卡。</div>
          ) : selected ? (
            <div className="staff-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>异常类型</th>
                    <th>原因</th>
                    <th>打卡时间</th>
                    <th>照片</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.records.map((record) => (
                    <tr key={record.id}>
                      <td>{toDateKey(new Date(record.punchedAt))}</td>
                      <td>{record.type}</td>
                      <td>{record.type}</td>
                      <td>{new Date(record.punchedAt).toLocaleString('zh-CN')}</td>
                      <td>
                        {record.photoPath ? (
                          <>
                            <button
                              className="secondary-button compact-button"
                              type="button"
                              onClick={() => handleOpenPhoto(record)}
                              disabled={openingPhotoId === record.id}
                            >
                              <Eye size={16} />
                              <span>{openingPhotoId === record.id ? '读取中' : '查看照片'}</span>
                            </button>
                          </>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="device-cell">GPS：{record.gps} / IP：{record.ip} / 设备：{record.deviceInfo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="staff-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>员工姓名</th>
                    <th>异常次数</th>
                    <th>查看</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedEmployees.map((item) => (
                    <tr key={item.employee.id}>
                      <td><strong>{getEmployeeDisplayName(item.employee)}</strong></td>
                      <td>异常 {item.records.length} 次</td>
                      <td>
                        <button className="secondary-button compact-button" type="button" onClick={() => setSelectedEmployeeId(item.employee.id)}>
                          <Eye size={16} />
                          <span>查看详情</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="employee-detail-section">
          <h4>薪资资料</h4>
          <div className="detail-list">
            <div>
              <span>薪资处理</span>
              <strong>按 HR 审核结果处理</strong>
            </div>
          </div>
        </section>

        <section className="employee-detail-section">
          <h4>班次资料</h4>
          <div className="detail-list">
            <div>
              <span>异常来源</span>
              <strong>打卡时间、GPS、IP、设备</strong>
            </div>
          </div>
        </section>
      </div>
    </SystemModal>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="leave-stat-card">
      <BarChart3 size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getEmployeeDisplayName(employee: Pick<AttendanceEmployee, 'full_name' | 'nickname'>) {
  return employee.nickname?.trim() || employee.full_name;
}

function buildSummaries(
  employees: AttendanceEmployee[],
  attendanceRecords: AttendanceRecord[],
  abnormalReviewHistory: AttendanceAbnormalReviewHistory[],
  leaveRequests: LeaveRequest[],
  restDays: AttendanceRestDay[],
  publicHolidays: PublicHoliday[],
  startDate: string,
  endDate: string,
) {
  const dates = getDateRange(startDate, endDate);
  const today = toDateKey(new Date());
  const recordsByEmployeeDate = groupAttendanceRecords(attendanceRecords);
  const latestReviewByRecordId = getLatestReviewByRecordId(abnormalReviewHistory);
  const leavesByEmployeeDate = groupLeaveRequests(leaveRequests, dates);
  const replacementMakeUpDatesByEmployeeDate = groupApprovedReplacementMakeUpDates(leaveRequests, dates);
  const restDaysByEmployeeDate = groupRestDays(restDays);
  const publicHolidaysByRegionDate = groupPublicHolidays(publicHolidays);

  return employees.map((employee) => {
    const leaveCounts: Record<LeaveType, number> = {
      annual: 0,
      medical: 0,
      unpaid: 0,
      replacement: 0,
    };
    const abnormalRecords: AbnormalRecord[] = [];
    let lateCount = 0;
    let earlyLeaveCount = 0;
    let absentCount = 0;
    let overtimeBreakCount = 0;
    let abnormalPunchCount = 0;

    const employeeRecords = attendanceRecords.filter(
      (record) => record.employee_id === employee.id && shouldCountAttendanceDate(employee, toDateKey(new Date(record.punched_at))),
    );
    const expectedIp = mostFrequent(employeeRecords.map((record) => record.ip_address).filter(Boolean) as string[]);
    const expectedDevice = mostFrequent(employeeRecords.map((record) => record.device_info).filter(Boolean));
    const expectedGps = mostFrequent(employeeRecords.map((record) => gpsKey(record)).filter(Boolean));

    const dailyRecords = dates.map((date) => {
      const records = recordsByEmployeeDate.get(`${employee.id}:${date}`) ?? [];
      const clockIn = records.find((record) => record.punch_type === 'clock_in') ?? null;
      const breakStart = records.find((record) => record.punch_type === 'break_start') ?? null;
      const breakEnd = records.find((record) => record.punch_type === 'break_end') ?? null;
      const clockOut = [...records].reverse().find((record) => record.punch_type === 'clock_out') ?? null;
      const leave = leavesByEmployeeDate.get(`${employee.id}:${date}`) ?? null;
      const replacementMakeUpDate = replacementMakeUpDatesByEmployeeDate.get(`${employee.id}:${date}`) ?? null;
      const restDay = restDaysByEmployeeDate.get(`${employee.id}:${date}`) ?? null;
      const publicHoliday = getPublicHolidayForDate(publicHolidaysByRegionDate, employee.region_id, date);
      const breakMinutes = breakStart && breakEnd ? minutesBetween(breakStart.punched_at, breakEnd.punched_at) : 0;
      const workHours = clockIn && clockOut ? minutesBetween(clockIn.punched_at, clockOut.punched_at) / 60 : null;
      const statuses: string[] = [];
      const shouldCountAttendance = shouldCountAttendanceDate(employee, date);
      const isPastOrToday = date <= today;
      const weekend = isWeekend(date);
      const nonWorkingDay = Boolean(publicHoliday) || (weekend && !replacementMakeUpDate);

      if (!shouldCountAttendance) {
        return {
          date,
          clockIn,
          breakStart,
          breakEnd,
          clockOut,
          workHours: null,
          breakMinutes: 0,
          status: '-',
        };
      }

      if (publicHoliday) {
        statuses.push('公共假期');
      } else if (weekend && !replacementMakeUpDate) {
        statuses.push('周末');
      }

      if (!nonWorkingDay && leave?.status === 'approved') {
        statuses.push(`${leaveTypeLabels[leave.leave_type]}已通过`);
        leaveCounts[leave.leave_type] += 1;
      }

      if (restDay) {
        statuses.push('排休');
      }

      if (employee.require_attendance && !nonWorkingDay && !leave && !restDay && isPastOrToday && !clockIn) {
        statuses.push('旷工');
        absentCount += 1;
      }

      if (employee.require_attendance && !nonWorkingDay && !restDay && clockIn && employee.start_work_time && isAfterWorkTime(clockIn.punched_at, employee.start_work_time)) {
        statuses.push('迟到');
        lateCount += 1;
      }

      if (employee.require_attendance && !nonWorkingDay && !restDay && clockOut && employee.end_work_time && isBeforeWorkTime(clockOut.punched_at, employee.end_work_time)) {
        statuses.push('早退');
        earlyLeaveCount += 1;
      }

      if (employee.require_attendance && !nonWorkingDay && breakMinutes > 60 && breakEnd) {
        statuses.push('超时休息');
        overtimeBreakCount += 1;
      }

      if (!nonWorkingDay) {
        records.forEach((record) => {
          const abnormalTypes = getDeviceAbnormalTypes(record, expectedIp, expectedGps, expectedDevice);

          if (abnormalTypes.length === 0) {
            return;
          }

          const reviewSnapshot = latestReviewByRecordId.get(record.id);
          const reviewStatus = reviewSnapshot?.reviewStatus ?? 'pending';

          if (reviewStatus === 'abnormal') {
            abnormalPunchCount += 1;
            abnormalRecords.push(toAbnormal(record, employee, abnormalTypes, reviewStatus, reviewSnapshot));
          }

          if (reviewStatus === 'pending') {
            abnormalRecords.push(toAbnormal(record, employee, abnormalTypes, reviewStatus, reviewSnapshot));
          }
        });
      }

      if (!statuses.length && (clockIn || clockOut)) {
        statuses.push('正常');
      }

      return {
        date,
        clockIn,
        breakStart,
        breakEnd,
        clockOut,
        workHours,
        breakMinutes,
        status: statuses.join('、') || '-',
      };
    });

    return {
      employee,
      lateCount,
      earlyLeaveCount,
      absentCount,
      overtimeBreakCount,
      abnormalPunchCount,
      leaveCounts,
      dailyRecords,
      abnormalRecords,
    };
  });
}

function getLatestReviewByRecordId(history: AttendanceAbnormalReviewHistory[]) {
  const map = new Map<string, AbnormalReviewSnapshot>();
  const latestReviewedAtByRecordId = new Map<string, number>();

  history.forEach((item) => {
    const reviewedAt = new Date(item.reviewed_at).getTime();
    const currentReviewedAt = latestReviewedAtByRecordId.get(item.attendance_record_id) ?? -Infinity;

    if (reviewedAt >= currentReviewedAt) {
      latestReviewedAtByRecordId.set(item.attendance_record_id, reviewedAt);
      map.set(item.attendance_record_id, {
        reviewStatus: item.review_status,
        reason: item.reason,
        reviewedByName: item.reviewed_by_name,
        reviewedAt: item.reviewed_at,
      });
    }
  });

  return map;
}

function groupRestDays(restDays: AttendanceRestDay[]) {
  const map = new Map<string, AttendanceRestDay>();

  restDays.forEach((restDay) => {
    map.set(`${restDay.employee_id}:${restDay.rest_date}`, restDay);
  });

  return map;
}

function shouldCountAttendanceDate(employee: AttendanceEmployee, date: string) {
  return employee.status !== 'left' || !employee.employment_end_date || date < employee.employment_end_date;
}

function groupAttendanceRecords(records: AttendanceRecord[]) {
  const map = new Map<string, AttendanceRecord[]>();

  records.forEach((record) => {
    if (!record.employee_id) {
      return;
    }

    const key = `${record.employee_id}:${toDateKey(new Date(record.punched_at))}`;
    const current = map.get(key) ?? [];
    current.push(record);
    current.sort((a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime());
    map.set(key, current);
  });

  return map;
}

function groupLeaveRequests(requests: LeaveRequest[], dates: string[]) {
  const map = new Map<string, LeaveRequest>();
  const dateSet = new Set(dates);

  requests.forEach((request) => {
    if (!request.employee_id || request.status === 'rejected') {
      return;
    }

    if (request.leave_type === 'replacement') {
      if (request.status === 'approved' && dateSet.has(request.end_date)) {
        map.set(`${request.employee_id}:${request.end_date}`, request);
      }

      return;
    }

    getDateRange(request.start_date, request.end_date).forEach((date) => {
      if (dateSet.has(date)) {
        map.set(`${request.employee_id}:${date}`, request);
      }
    });
  });

  return map;
}

function groupApprovedReplacementMakeUpDates(requests: LeaveRequest[], dates: string[]) {
  const map = new Map<string, LeaveRequest>();
  const dateSet = new Set(dates);

  requests.forEach((request) => {
    if (
      !request.employee_id ||
      request.leave_type !== 'replacement' ||
      request.status !== 'approved' ||
      !dateSet.has(request.start_date)
    ) {
      return;
    }

    map.set(`${request.employee_id}:${request.start_date}`, request);
  });

  return map;
}

function groupPublicHolidays(publicHolidays: PublicHoliday[]) {
  const map = new Map<string, PublicHoliday>();

  publicHolidays.forEach((holiday) => {
    map.set(`${holiday.region_id ?? 'all'}:${holiday.holiday_date}`, holiday);
  });

  return map;
}

function getPublicHolidayForDate(
  publicHolidaysByRegionDate: Map<string, PublicHoliday>,
  regionId: string | null,
  date: string,
) {
  return publicHolidaysByRegionDate.get(`all:${date}`) ?? (regionId ? publicHolidaysByRegionDate.get(`${regionId}:${date}`) : null);
}

function getDateRange(startDate: string, endDate: string) {
  const date = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const dates: string[] = [];

  while (date <= end) {
    dates.push(toDateKey(date));
    date.setDate(date.getDate() + 1);
  }

  return dates;
}

function isWeekend(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function minutesBetween(startValue: string, endValue: string) {
  return Math.max(0, Math.round((new Date(endValue).getTime() - new Date(startValue).getTime()) / 60000));
}

function isAfterWorkTime(value: string, workTime: string) {
  return minutesOfDay(new Date(value)) > minutesFromTime(workTime);
}

function isBeforeWorkTime(value: string, workTime: string) {
  return minutesOfDay(new Date(value)) < minutesFromTime(workTime);
}

function minutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function minutesFromTime(value: string) {
  const [hourText, minuteText] = value.slice(0, 5).split(':');
  return Number(hourText) * 60 + Number(minuteText);
}

function mostFrequent(values: string[]) {
  const counts = new Map<string, number>();

  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

function gpsKey(record: AttendanceRecord) {
  if (record.latitude === null || record.longitude === null) {
    return '';
  }

  return `${Number(record.latitude).toFixed(3)},${Number(record.longitude).toFixed(3)}`;
}

function getDeviceAbnormalTypes(record: AttendanceRecord, expectedIp: string, expectedGps: string, expectedDevice: string) {
  const types: string[] = [];

  if (expectedIp && record.ip_address && record.ip_address !== expectedIp) {
    types.push('IP异常');
  }

  if (expectedGps && gpsKey(record) && gpsKey(record) !== expectedGps) {
    types.push('GPS异常');
  }

  if (expectedDevice && record.device_info && record.device_info !== expectedDevice) {
    types.push('设备异常');
  }

  return types;
}

function toAbnormal(
  record: AttendanceRecord,
  employee: AttendanceEmployee,
  sourceAbnormalTypes: string[],
  reviewStatus: AttendanceAbnormalReviewStatus,
  reviewSnapshot: AbnormalReviewSnapshot | undefined,
): AbnormalRecord {
  return {
    id: record.id,
    attendanceRecordId: record.id,
    employee,
    type: sourceAbnormalTypes.join(' + '),
    punchType: record.punch_type,
    sourceAbnormalTypes,
    reviewStatus,
    reviewReason: reviewSnapshot?.reason ?? null,
    reviewedByName: reviewSnapshot?.reviewedByName ?? null,
    reviewedAt: reviewSnapshot?.reviewedAt ?? null,
    punchedAt: record.punched_at,
    gps: `${Number(record.latitude).toFixed(5)}, ${Number(record.longitude).toFixed(5)}`,
    ip: record.ip_address ?? '-',
    deviceInfo: record.device_info,
    photoPath: record.photo_path,
  };
}

function formatRecordTime(record: AttendanceRecord | null) {
  if (!record) {
    return '-';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(record.punched_at));
}

function formatPunchType(punchType: AttendanceRecord['punch_type']) {
  const labels: Record<AttendanceRecord['punch_type'], string> = {
    clock_in: '上班',
    break_start: '开始休息',
    break_end: '结束休息',
    clock_out: '下班',
  };

  return labels[punchType];
}
