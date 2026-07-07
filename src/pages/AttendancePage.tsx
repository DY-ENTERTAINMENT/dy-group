import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Camera, Coffee, Clock, FileClock, LogIn, LogOut } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import { useAuth } from '../hooks/useAuth';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { getBrowserGeoPosition } from '../services/attendance-location.service';
import { type AttendanceRecordItem, attendanceService, getPublicIpAddress } from '../services/attendance.service';
import type { AttendancePunchType } from '../types/database';

const punchTypeLabels: Record<AttendancePunchType, string> = {
  clock_in: '上班打卡',
  break_start: '开始休息',
  break_end: '结束休息',
  clock_out: '下班打卡',
};

type GeoState = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

export function AttendancePage() {
  const { profile } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [records, setRecords] = useState<AttendanceRecordItem[]>([]);
  const [geoState, setGeoState] = useState<GeoState | null>(null);
  const [ipAddress, setIpAddress] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<AttendancePunchType | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const deviceInfo = useMemo(() => navigator.userAgent, []);

  useEffect(() => {
    void startCamera();
    loadLocation();
    void loadIpAddress();

    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (profile?.id) {
      void loadRecords(profile.id);
    }
  }, [profile?.id]);

  usePullToRefresh(() => loadRecords(), [profile?.id]);

  async function startCamera() {
    setError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setCameraReady(true);
    } catch {
      setCameraReady(false);
      setError('无法启动摄像头。请允许浏览器使用摄像头后再试。');
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function loadLocation() {
    void getBrowserGeoPosition()
      .then((position) => {
        setGeoState(position);
      })
      .catch((locationError) => {
        setError(locationError instanceof Error ? locationError.message : '无法取得当前位置，请检查浏览器定位权限或网络后重试。');
      });
  }

  async function loadIpAddress() {
    const ip = await getPublicIpAddress();
    setIpAddress(ip);
  }

  async function loadRecords(profileId = profile?.id) {
    if (!profileId) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const attendanceRecords = await attendanceService.listMyAttendanceRecords(profileId);
      setRecords(attendanceRecords);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取打卡记录失败。');
    } finally {
      setLoading(false);
    }
  }

  async function handlePunch(punchType: AttendancePunchType) {
    if (!profile?.id) {
      setError('无法确认当前用户。');
      return;
    }

    if (!cameraReady) {
      setError('请先开启摄像头。');
      return;
    }

    if (!geoState) {
      setError('请允许浏览器定位权限，否则无法打卡。');
      return;
    }

    setSubmitting(punchType);
    setError('');
    setMessage('');

    try {
      const photoBlob = await capturePhotoBlob();
      await attendanceService.createAttendanceRecord({
        profileId: profile.id,
        punchType,
        photoBlob,
        latitude: geoState.latitude,
        longitude: geoState.longitude,
        accuracy: geoState.accuracy,
        ipAddress,
        deviceInfo,
      });

      setMessage(`${punchTypeLabels[punchType]}成功。`);
      await loadRecords(profile.id);
    } catch (punchError) {
      setError(punchError instanceof Error ? punchError.message : '打卡失败。');
    } finally {
      setSubmitting(null);
    }
  }

  async function capturePhotoBlob() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      throw new Error('无法读取摄像头画面。');
    }

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('无法生成打卡照片。');
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }

          reject(new Error('无法保存打卡照片。'));
        },
        'image/jpeg',
        0.88,
      );
    });
  }

  return (
    <section className="attendance-page">
      <div className="attendance-grid attendance-grid-single">
        <div className="camera-panel">
          <div className="panel-title-row">
            <div>
              <span>实时拍照</span>
              <h3>浏览器摄像头</h3>
            </div>
            <Camera size={22} />
          </div>

          <div className="camera-frame">
            <video ref={videoRef} autoPlay playsInline muted />
            {!cameraReady ? <div className="camera-placeholder">等待摄像头授权</div> : null}
          </div>
          <canvas ref={canvasRef} className="hidden-canvas" />

          <div className="attendance-meta-grid attendance-meta-compact">
            <MetaItem icon={<Clock size={17} />} label="时间" value={new Date().toLocaleString('zh-CN')} />
          </div>

          {error ? <p className="form-alert">{error}</p> : null}
          {message ? <p className="form-success">{message}</p> : null}

          <div className="punch-actions">
            <button className="primary-button" type="button" onClick={() => handlePunch('clock_in')} disabled={Boolean(submitting)}>
              <LogIn size={18} />
              <span>{submitting === 'clock_in' ? '打卡中...' : '上班打卡'}</span>
            </button>
            <button className="secondary-button" type="button" onClick={() => handlePunch('break_start')} disabled={Boolean(submitting)}>
              <Coffee size={18} />
              <span>{submitting === 'break_start' ? '记录中...' : '开始休息'}</span>
            </button>
            <button className="secondary-button" type="button" onClick={() => handlePunch('clock_out')} disabled={Boolean(submitting)}>
              <LogOut size={18} />
              <span>{submitting === 'clock_out' ? '打卡中...' : '下班打卡'}</span>
            </button>
            <button className="secondary-button" type="button" onClick={() => handlePunch('break_end')} disabled={Boolean(submitting)}>
              <Coffee size={18} />
              <span>{submitting === 'break_end' ? '记录中...' : '结束休息'}</span>
            </button>
          </div>

          <button className="secondary-button attendance-records-button" type="button" onClick={() => setRecordsOpen(true)}>
            <FileClock size={18} />
            <span>查看打卡记录</span>
          </button>
        </div>
      </div>

      {recordsOpen ? (
        <AttendanceRecordsModal records={records} loading={loading} onRefresh={() => loadRecords()} onClose={() => setRecordsOpen(false)} />
      ) : null}
    </section>
  );
}

function AttendanceRecordsModal({
  records,
  loading,
  onRefresh,
  onClose,
}: {
  records: AttendanceRecordItem[];
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  return (
    <SystemModal
      title="查看打卡记录"
      subtitle="打卡"
      ariaLabel="查看打卡记录"
      onClose={onClose}
      footer={
        <>
          <button className="secondary-button compact-button" type="button" onClick={onClose}>
            关闭
          </button>
          <button className="primary-button compact-button" type="button" onClick={onRefresh} disabled={loading}>
            刷新
          </button>
        </>
      }
    >
      {loading ? (
        <div className="table-state compact">正在读取打卡记录...</div>
      ) : records.length === 0 ? (
        <div className="table-state compact">暂无打卡记录。</div>
      ) : (
        <div className="staff-table-wrap">
          <table className="staff-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>时间</th>
                <th>照片</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{punchTypeLabels[record.punch_type]}</td>
                  <td>{new Date(record.punched_at).toLocaleString('zh-CN')}</td>
                  <td>已拍照</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SystemModal>
  );
}

function MetaItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="attendance-meta-item">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
