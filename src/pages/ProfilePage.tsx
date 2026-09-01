import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { Camera, Download, Lock, Pencil, ShieldCheck, Trash2, Upload, UserRound } from 'lucide-react';
import { SystemModal } from '../components/SystemModal';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { profileService, type BusinessCardQrType, type MyProfileData, type MyProfileUpdateValues } from '../services/profile.service';
import { authService } from '../services/auth.service';
import logoUrl from '../assets/logo.png';
import whatsappIconUrl from '../assets/icons/whatsapp.svg';
import wechatIconUrl from '../assets/icons/wechat.svg';
import instagramIconUrl from '../assets/icons/instagram.svg';
import facebookIconUrl from '../assets/icons/facebook.svg';

type ProfileForm = {
  phone: string;
  avatar_url: string | null;
  nickname: string;
  address: string;
  bank_name: string;
  bank_account: string;
};

type ContactKind = 'whatsapp' | 'wechat' | 'instagram' | 'facebook';

const legacyWechatStorageKey = 'dy-group-business-card-wechat';
const avatarOriginalStorageKey = 'dy-group-avatar-original-url';
const avatarCropSize = 320;
const avatarOutputSize = 800;

export function ProfilePage() {
  const [profileData, setProfileData] = useState<MyProfileData | null>(null);
  const [form, setForm] = useState<ProfileForm>({
    phone: '',
    avatar_url: null,
    nickname: '',
    address: '',
    bank_name: '',
    bank_account: '',
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloadChoiceOpen, setDownloadChoiceOpen] = useState(false);
  const [businessCardPreviewUrl, setBusinessCardPreviewUrl] = useState<string | null>(null);
  const [contactEditOpen, setContactEditOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordResetSending, setPasswordResetSending] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [socialForm, setSocialForm] = useState({ wechat_id: '', instagram_username: '', use_personal_instagram: false, show_wechat_qr_on_card: false, show_instagram_qr_on_card: false });
  const [avatarOriginalUrl, setAvatarOriginalUrl] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState({ whatsapp: '', wechat: '' });
  const [cropOriginalFile, setCropOriginalFile] = useState<File | null>(null);
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);
  const [cropImageSize, setCropImageSize] = useState({ width: 0, height: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [qrUploadingType, setQrUploadingType] = useState<BusinessCardQrType | null>(null);
  const [downloadingCard, setDownloadingCard] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const cropDragRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const avatarUploadInputRef = useRef<HTMLInputElement | null>(null);
  const wechatQrInputRef = useRef<HTMLInputElement | null>(null);
  const instagramQrInputRef = useRef<HTMLInputElement | null>(null);

  const employee = profileData?.employee;
  const profile = profileData?.profile;
  const displayName = employee?.full_name || profile?.full_name || 'DY Group';
  const initials = useMemo(() => displayName.slice(0, 1).toUpperCase(), [displayName]);
  const avatarUrl = employee?.avatar_url || form.avatar_url;
  const avatarPreviewUrl = avatarOriginalUrl || avatarUrl;
  const whatsapp = form.phone || employee?.phone || profile?.phone || '';
  const cardWechat = employee?.wechat_id?.trim() || '';
  const companyChineseName = '东娱传媒';
  const companyEnglishName = employee?.region?.company_english_name ?? '';
  const companyRegistrationNo = employee?.region?.company_registration_no ?? '';
  const companyInstagram = employee?.region?.company_instagram ?? '';
  const cardInstagram = employee?.use_personal_instagram && employee.instagram_username?.trim() ? employee.instagram_username.trim() : companyInstagram;
  const companyFacebook = employee?.region?.company_facebook ?? '';
  const accountEmail = profile?.email || employee?.email || '';
  const wechatQrUrl = employee?.wechat_qr_url ?? null;
  const instagramQrUrl = employee?.instagram_qr_url ?? null;
  const businessCardQrs = [
    { type: 'wechat' as const, label: 'WeChat', url: employee?.show_wechat_qr_on_card ? wechatQrUrl : null },
    { type: 'instagram' as const, label: 'Instagram', url: employee?.show_instagram_qr_on_card ? instagramQrUrl : null },
  ].filter((item): item is { type: BusinessCardQrType; label: string; url: string } => Boolean(item.url));
  const businessCardContacts = [
    { kind: 'whatsapp' as const, label: 'Whatsapp', value: whatsapp },
    { kind: 'instagram' as const, label: employee?.use_personal_instagram ? 'Instagram' : '公司 Instagram', value: cardInstagram },
    { kind: 'wechat' as const, label: '微信', value: cardWechat },
    { kind: 'facebook' as const, label: '公司 Facebook', value: companyFacebook },
  ];
  const cropBaseScale =
    cropImageSize.width && cropImageSize.height ? Math.max(avatarCropSize / cropImageSize.width, avatarCropSize / cropImageSize.height) : 1;
  const cropDisplayWidth = cropImageSize.width * cropBaseScale * cropZoom;
  const cropDisplayHeight = cropImageSize.height * cropBaseScale * cropZoom;

  useEffect(() => {
    void loadProfile();
  }, []);

  usePullToRefresh(loadProfile);

  useEffect(() => {
    setAvatarOriginalUrl(window.localStorage.getItem(avatarOriginalStorageKey));
  }, []);

  useEffect(() => {
    return () => {
      if (cropImageUrl) {
        URL.revokeObjectURL(cropImageUrl);
      }
    };
  }, [cropImageUrl]);

  async function loadProfile() {
    setLoading(true);
    setError('');

    try {
      const data = await profileService.getMyProfile();
      setProfileData(data);
      setForm({
        phone: data.employee?.phone ?? data.profile.phone ?? '',
        avatar_url: data.employee?.avatar_url ?? data.profile.avatar_url,
        nickname: data.employee?.nickname ?? '',
        address: data.employee?.address ?? '',
        bank_name: data.employee?.bank_name ?? '',
        bank_account: data.employee?.bank_account ?? '',
      });
      setSocialForm({
        wechat_id: data.employee?.wechat_id ?? '',
        instagram_username: data.employee?.instagram_username ?? '',
        use_personal_instagram: data.employee?.use_personal_instagram ?? false,
        show_wechat_qr_on_card: data.employee?.show_wechat_qr_on_card ?? false,
        show_instagram_qr_on_card: data.employee?.show_instagram_qr_on_card ?? false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取个人资料失败。');
    } finally {
      setLoading(false);
    }
  }

  function getUpdateValues(nextForm = form): MyProfileUpdateValues {
    return {
      full_name: displayName,
      phone: nextForm.phone,
      avatar_url: nextForm.avatar_url,
      nickname: nextForm.nickname,
      address: nextForm.address,
      bank_name: nextForm.bank_name,
      bank_account: nextForm.bank_account,
    };
  }

  function openContactEditor() {
    setContactForm({
      whatsapp: form.phone || employee?.phone || profile?.phone || '',
      wechat: cardWechat,
    });
    setContactEditOpen(true);
  }

  function openPasswordModal() {
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setPasswordMessage('');
    setPasswordSuccess('');
    setPasswordModalOpen(true);
  }

  function closePasswordModal() {
    if (passwordSaving || passwordResetSending) return;
    setPasswordModalOpen(false);
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage('');
    setPasswordSuccess('');

    const currentPassword = passwordForm.currentPassword;
    const newPassword = passwordForm.newPassword;
    const confirmPassword = passwordForm.confirmPassword;

    if (!currentPassword) {
      setPasswordMessage('请输入当前密码。');
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      setPasswordMessage('新密码至少需要 6 位。');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage('新密码与确认密码不一致。');
      return;
    }

    if (!accountEmail) {
      setPasswordMessage('找不到当前账号邮箱，无法修改密码。');
      return;
    }

    setPasswordSaving(true);

    try {
      const { error: verifyError } = await authService.signIn(accountEmail, currentPassword);
      if (verifyError) {
        throw new Error(`当前密码验证失败：${verifyError.message}`);
      }

      const { error: updateError } = await authService.updatePassword(newPassword);
      if (updateError) {
        throw updateError;
      }

      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordSuccess('密码修改成功');
    } catch (err) {
      setPasswordMessage(err instanceof Error ? err.message : '密码修改失败。');
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleForgotCurrentPassword() {
    setPasswordMessage('');
    setPasswordSuccess('');

    if (!accountEmail) {
      setPasswordMessage('找不到当前账号邮箱，无法发送重置邮件。');
      return;
    }

    setPasswordResetSending(true);
    const { error: resetError } = await authService.resetPasswordForEmail(accountEmail);
    setPasswordResetSending(false);

    if (resetError) {
      setPasswordMessage(`发送重置邮件失败：${resetError.message}`);
      return;
    }

    setPasswordSuccess('密码重置邮件已发送，请到邮箱查看重置链接。');
  }

  async function handleSaveBusinessCardContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const nextForm = { ...form, phone: contactForm.whatsapp };
      await profileService.updateMyProfile(getUpdateValues(nextForm));
      await profileService.updateBusinessCardSocial({ ...socialForm, wechat_id: contactForm.wechat.trim() });
      window.localStorage.removeItem(legacyWechatStorageKey);
      setForm(nextForm);
      setSocialForm((current) => ({ ...current, wechat_id: contactForm.wechat.trim() }));
      setProfileData((current) =>
        current
          ? {
              ...current,
              profile: { ...current.profile, phone: nextForm.phone.trim() || null },
              employee: current.employee ? { ...current.employee, phone: nextForm.phone.trim() || null, wechat_id: contactForm.wechat.trim() || null } : current.employee,
            }
          : current,
      );
      setContactEditOpen(false);
      setSuccess('电子名片联系方式已更新。');
    } catch (err) {
      setError(`保存电子名片联系方式失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError('');
    setSuccess('');

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setCropImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      setCropZoom(1);
      setCropOffset({ x: 0, y: 0 });
      setCropOriginalFile(file);
      setPreviewOpen(false);
      setCropImageUrl(objectUrl);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setError('无法读取这张图片，请重新选择。');
    };
    image.src = objectUrl;
  }

  function handleAvatarPhotoClick() {
    if (avatarUrl) {
      setPreviewOpen(true);
      return;
    }

    avatarUploadInputRef.current?.click();
  }

  async function handleSaveCroppedAvatar() {
    if (!cropImageUrl || !cropImageSize.width || !cropImageSize.height) return;

    setUploading(true);
    setError('');
    setSuccess('');

    try {
      const originalUrl = cropOriginalFile ? await profileService.uploadAvatar(cropOriginalFile) : null;
      const avatarBlob = await createCroppedAvatarBlob(cropImageUrl, cropImageSize, cropZoom, cropOffset);
      const avatarFile = new File([avatarBlob], `avatar-${Date.now()}.jpg`, { type: avatarBlob.type });
      const uploadedUrl = await profileService.uploadAvatar(avatarFile);
      const nextForm = { ...form, avatar_url: uploadedUrl };
      await profileService.updateMyProfile(getUpdateValues(nextForm));
      setForm(nextForm);
      setProfileData((current) =>
        current
          ? {
              ...current,
              profile: { ...current.profile, avatar_url: uploadedUrl },
              employee: current.employee ? { ...current.employee, avatar_url: uploadedUrl } : current.employee,
            }
          : current,
      );
      if (originalUrl) {
        window.localStorage.setItem(avatarOriginalStorageKey, originalUrl);
        setAvatarOriginalUrl(originalUrl);
      }
      closeAvatarCrop();
      setSuccess('头像已更新。');
    } catch (err) {
      setError(`头像上传失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setUploading(false);
    }
  }

  function closeAvatarCrop() {
    setCropImageUrl(null);
    setCropImageSize({ width: 0, height: 0 });
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setCropOriginalFile(null);
    cropDragRef.current = null;
  }

  function handleCropPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!cropImageUrl) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    cropDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: cropOffset.x,
      offsetY: cropOffset.y,
    };
  }

  function handleCropPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    setCropOffset(
      clampCropOffset(
        {
          x: drag.offsetX + event.clientX - drag.startX,
          y: drag.offsetY + event.clientY - drag.startY,
        },
        cropImageSize,
        cropZoom,
      ),
    );
  }

  function handleCropPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (cropDragRef.current?.pointerId === event.pointerId) {
      cropDragRef.current = null;
    }
  }

  function handleCropZoomChange(event: ChangeEvent<HTMLInputElement>) {
    const nextZoom = Number(event.target.value);
    setCropZoom(nextZoom);
    setCropOffset((current) => clampCropOffset(current, cropImageSize, nextZoom));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await profileService.updateMyProfile(getUpdateValues());
      setProfileData((current) =>
        current
          ? {
              ...current,
              profile: {
                ...current.profile,
                phone: form.phone.trim() || null,
                avatar_url: form.avatar_url,
              },
              employee: current.employee
                ? {
                    ...current.employee,
                    phone: form.phone.trim() || null,
                    nickname: form.nickname.trim() || null,
                    address: form.address.trim() || null,
                    bank_name: form.bank_name.trim() || null,
                    bank_account: form.bank_account.trim() || null,
                    avatar_url: form.avatar_url,
                  }
                : current.employee,
            }
          : current,
      );
      setSuccess('个人资料已保存。');
    } catch (err) {
      setError(`保存个人资料失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadCard(orientation: 'horizontal' | 'vertical') {
    setDownloadingCard(true);
    setError('');

    try {
      const canvas = document.createElement('canvas');
      canvas.width = orientation === 'horizontal' ? 1600 : 960;
      canvas.height = orientation === 'horizontal' ? 960 : 1600;
      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('无法生成电子名片。');
      }

      await drawBusinessCard(context, {
        orientation,
        name: displayName,
        jobTitle: employee?.job_title?.name ?? 'DY Group',
        whatsapp,
        wechat: cardWechat,
        avatarUrl,
        initials,
        companyEnglishName,
        companyRegistrationNo,
        companyChineseName,
        companyInstagram: cardInstagram,
        companyFacebook,
        wechatQrUrl,
        instagramQrUrl,
        showWechatQrOnCard: employee?.show_wechat_qr_on_card ?? false,
        showInstagramQrOnCard: employee?.show_instagram_qr_on_card ?? false,
      });

      const filename = `${displayName}-${orientation === 'horizontal' ? '横式' : '竖式'}电子名片.png`;

      if (isIOSDevice()) {
        const dataUrl = canvas.toDataURL('image/png');
        const blob = await canvasToPngBlob(canvas);

        if (!blob) {
          setBusinessCardPreviewUrl(dataUrl);
          setDownloadChoiceOpen(false);
          return;
        }

        const file = new File([blob], filename, { type: 'image/png' });
        const shared = await shareBusinessCardFile(file);

        if (!shared.supported) {
          setBusinessCardPreviewUrl(dataUrl);
        }

        setDownloadChoiceOpen(false);
        return;
      }

      const link = document.createElement('a');
      link.download = filename;
      link.href = canvas.toDataURL('image/png');
      link.click();
      setDownloadChoiceOpen(false);
    } catch (downloadError) {
      if (isShareAbortError(downloadError)) {
        setDownloadChoiceOpen(false);
        return;
      }

      setError(downloadError instanceof Error ? downloadError.message : '下载电子名片失败。');
    } finally {
      setDownloadingCard(false);
    }
  }

  async function handleBusinessCardQrChange(type: BusinessCardQrType, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setQrUploadingType(type);
    setError('');
    setSuccess('');
    try {
      const previousUrl = type === 'wechat' ? wechatQrUrl : instagramQrUrl;
      const uploadedUrl = await profileService.uploadBusinessCardQr(type, file, previousUrl);
      setProfileData((current) =>
        current?.employee
          ? { ...current, employee: { ...current.employee, [type === 'wechat' ? 'wechat_qr_url' : 'instagram_qr_url']: uploadedUrl } }
          : current,
      );
      setSuccess(`${type === 'wechat' ? 'WeChat' : 'Instagram'} 二维码已更新。`);
    } catch (err) {
      setError(`上传二维码失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setQrUploadingType(null);
    }
  }

  async function handleSaveBusinessCardSocial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (socialForm.show_wechat_qr_on_card && !wechatQrUrl) {
      setError('请先上传微信二维码，再选择在名片显示。');
      return;
    }
    if (socialForm.show_instagram_qr_on_card && !instagramQrUrl) {
      setError('请先上传 Instagram 二维码，再选择在名片显示。');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await profileService.updateBusinessCardSocial(socialForm);
      window.localStorage.removeItem(legacyWechatStorageKey);
      setProfileData((current) =>
        current?.employee
          ? {
              ...current,
              employee: {
                ...current.employee,
                wechat_id: socialForm.wechat_id.trim() || null,
                instagram_username: socialForm.instagram_username.trim().replace(/^@+/, '') || null,
                use_personal_instagram: socialForm.use_personal_instagram,
                show_wechat_qr_on_card: socialForm.show_wechat_qr_on_card,
                show_instagram_qr_on_card: socialForm.show_instagram_qr_on_card,
              },
            }
          : current,
      );
      setSuccess('社交资料已保存。');
    } catch (err) {
      setError(`保存社交资料失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteBusinessCardQr(type: BusinessCardQrType) {
    const currentUrl = type === 'wechat' ? wechatQrUrl : instagramQrUrl;
    if (!currentUrl || !window.confirm(`确定删除 ${type === 'wechat' ? 'WeChat' : 'Instagram'} 二维码吗？`)) return;

    setQrUploadingType(type);
    setError('');
    setSuccess('');
    try {
      await profileService.deleteBusinessCardQr(type, currentUrl);
      setProfileData((current) =>
        current?.employee
          ? { ...current, employee: { ...current.employee, [type === 'wechat' ? 'wechat_qr_url' : 'instagram_qr_url']: null, [type === 'wechat' ? 'show_wechat_qr_on_card' : 'show_instagram_qr_on_card']: false } }
          : current,
      );
      setSuccess(`${type === 'wechat' ? 'WeChat' : 'Instagram'} 二维码已删除。`);
    } catch (err) {
      setError(`删除二维码失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setQrUploadingType(null);
    }
  }

  if (loading) {
    return (
      <section className="profile-page">
        <div className="page-panel table-state">正在读取个人资料...</div>
      </section>
    );
  }

  return (
    <section className="profile-page">
      {error ? <p className="form-alert">{error}</p> : null}
      {success ? <p className="form-success">{success}</p> : null}

      <div className="profile-card business-card-section">
        <div className="business-card-preview">
          <div className="business-card-content">
            <div className="business-card-company">
              <img src={logoUrl} alt="DY Group" />
              <strong>{companyChineseName}</strong>
              {companyEnglishName ? <span>{companyEnglishName}</span> : null}
              {companyRegistrationNo ? <small>{companyRegistrationNo}</small> : null}
            </div>

            <div className="business-card-info">
              <h2>{displayName}</h2>
              <strong>{employee?.job_title?.name ?? '未设置职称'}</strong>
              <div className="business-card-contact-grid">
                {businessCardContacts.map((contact) => (
                  <CardContact key={contact.kind} kind={contact.kind} label={contact.label} value={contact.value} />
                ))}
              </div>
              {businessCardQrs.length ? <BusinessCardQrPreview qrs={businessCardQrs} /> : null}
            </div>
          </div>

          <button className="business-card-photo" type="button" onClick={handleAvatarPhotoClick}>
            {avatarUrl ? <img src={avatarUrl} alt="个人头像" /> : <span>{initials}</span>}
          </button>
          <input
            ref={avatarUploadInputRef}
            className="sr-only"
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            disabled={uploading || saving}
          />
        </div>
        <div className="business-card-actions">
          <button className="primary-button business-card-download" type="button" onClick={() => setDownloadChoiceOpen(true)} disabled={downloadingCard}>
            <Download size={18} />
            <span>{downloadingCard ? '生成中...' : '下载电子名片'}</span>
          </button>
          <button className="secondary-action business-card-edit" type="button" onClick={openContactEditor} disabled={saving}>
            <Pencil size={17} />
            <span>编辑</span>
          </button>
        </div>
      </div>

      <form className="profile-card" onSubmit={handleSubmit}>
        <div className="panel-title-row">
          <div>
            <span>基本资料</span>
            <h3>个人与员工资料</h3>
          </div>
          <UserRound size={20} />
        </div>

        <div className="profile-final-grid">
          <ReadOnlyField label="姓名" value={displayName} />
          <EditableField label="昵称" value={form.nickname} onChange={(value) => setForm((current) => ({ ...current, nickname: value }))} />
          <ReadOnlyField label="生日" value={employee?.birthday} />
          <EditableField label="电话" value={form.phone} onChange={(value) => setForm((current) => ({ ...current, phone: value }))} />
          <ReadOnlyField label="邮箱" value={profile?.email} />
          <EditableField label="地址" value={form.address} onChange={(value) => setForm((current) => ({ ...current, address: value }))} />
          <ReadOnlyField label="员工编号" value={employee?.employee_code} />
          <ReadOnlyField label="职位" value={employee?.job_title?.name} />
          <ReadOnlyField label="区域" value={employee?.region?.name ?? employee?.region?.code} />
          <ReadOnlyField label="雇佣类型" value={employee?.employment_type?.name} />
          <ReadOnlyField label="入职日期" value={employee?.hire_date} />
          <ReadOnlyField label="正式日期" value={employee?.probation_confirm_date} />
          <ReadOnlyField label="上班时间" value={formatTime(employee?.start_work_time)} />
          <ReadOnlyField label="下班时间" value={formatTime(employee?.end_work_time)} />
          <EditableField label="银行" value={form.bank_name} onChange={(value) => setForm((current) => ({ ...current, bank_name: value }))} />
          <EditableField label="银行户口" value={form.bank_account} onChange={(value) => setForm((current) => ({ ...current, bank_account: value }))} />
        </div>

        <button className="primary-button profile-save-button" type="submit" disabled={saving || uploading}>
          {saving ? '保存中...' : '保存个人资料'}
        </button>
      </form>

      <section className="profile-card business-card-qr-settings">
        <div className="panel-title-row">
          <div>
            <span>社交二维码</span>
            <h3>个人名片连接方式</h3>
          </div>
          <Upload size={20} />
        </div>
        <form className="business-card-qr-upload-grid" onSubmit={handleSaveBusinessCardSocial}>
          <QrUploadCard type="wechat" label="WeChat" url={wechatQrUrl} inputRef={wechatQrInputRef} uploading={qrUploadingType === 'wechat'} onChange={handleBusinessCardQrChange} onDelete={handleDeleteBusinessCardQr}>
            <label className="form-field"><span>微信号</span><input value={socialForm.wechat_id} onChange={(event) => setSocialForm((current) => ({ ...current, wechat_id: event.target.value }))} /></label>
            <label className="business-card-qr-toggle"><input type="checkbox" checked={socialForm.show_wechat_qr_on_card} disabled={!wechatQrUrl} onChange={(event) => setSocialForm((current) => ({ ...current, show_wechat_qr_on_card: event.target.checked }))} /> 下载名片时显示微信二维码</label>
          </QrUploadCard>
          <QrUploadCard type="instagram" label="Instagram" url={instagramQrUrl} inputRef={instagramQrInputRef} uploading={qrUploadingType === 'instagram'} onChange={handleBusinessCardQrChange} onDelete={handleDeleteBusinessCardQr}>
            <label className="form-field"><span>个人 Instagram</span><input value={socialForm.instagram_username} placeholder="@username" onChange={(event) => setSocialForm((current) => ({ ...current, instagram_username: event.target.value }))} /></label>
            <label className="business-card-qr-toggle"><input type="checkbox" checked={socialForm.use_personal_instagram} onChange={(event) => setSocialForm((current) => ({ ...current, use_personal_instagram: event.target.checked }))} /> 在名片使用我的个人 Instagram</label>
            <label className="business-card-qr-toggle"><input type="checkbox" checked={socialForm.show_instagram_qr_on_card} disabled={!instagramQrUrl} onChange={(event) => setSocialForm((current) => ({ ...current, show_instagram_qr_on_card: event.target.checked }))} /> 下载名片时显示 Instagram 二维码</label>
          </QrUploadCard>
          <button className="primary-button profile-save-button" type="submit" disabled={saving || qrUploadingType !== null}>{saving ? '保存中...' : '保存社交资料'}</button>
        </form>
      </section>

      <div className="profile-card">
        <div className="panel-title-row">
          <div>
            <span>敏感资料</span>
            <h3>未来由权限系统控制</h3>
          </div>
          <ShieldCheck size={20} />
        </div>
        <div className="profile-info-list">
          <ProfileInfo label="基本薪资" value={formatMoney(employee?.base_salary)} />
          <ProfileInfo label="身份证号码" value={employee?.identity_number} />
        </div>
      </div>

      <div className="profile-card profile-security-card">
        <div className="panel-title-row">
          <div>
            <span>账号安全</span>
            <h3>安全设置</h3>
          </div>
          <Lock size={20} />
        </div>
        <div className="profile-security-list">
          <button className="secondary-action" type="button" onClick={openPasswordModal}>
            修改密码
          </button>
          <button className="secondary-action" type="button" disabled>
            登出所有设备
          </button>
          <button className="secondary-action" type="button" disabled>
            两步验证 Coming Soon
          </button>
        </div>
      </div>

      {previewOpen && avatarPreviewUrl ? (
        <SystemModal
          title={displayName}
          subtitle="头像预览"
          ariaLabel="头像预览"
          className="profile-preview-modal"
          onClose={() => setPreviewOpen(false)}
          footer={
            <label className="secondary-action profile-upload-button">
              <Camera size={17} />
              {uploading ? '上传中...' : '更换头像'}
              <input type="file" accept="image/*" onChange={handleAvatarChange} disabled={uploading || saving} />
            </label>
          }
        >
          <img src={avatarPreviewUrl} alt="头像原图" />
        </SystemModal>
      ) : null}

      {passwordModalOpen ? (
        <SystemModal
          title="修改密码"
          subtitle="账号安全"
          ariaLabel="修改密码"
          wide={false}
          onClose={closePasswordModal}
          footer={
            <>
              <button className="secondary-button compact-button" type="button" onClick={closePasswordModal} disabled={passwordSaving || passwordResetSending}>
                取消
              </button>
              <button className="primary-button compact-button" type="submit" form="profile-change-password-form" disabled={passwordSaving || passwordResetSending}>
                {passwordSaving ? '保存中' : '保存'}
              </button>
            </>
          }
        >
          <form id="profile-change-password-form" className="profile-password-form" onSubmit={handleChangePassword}>
            <label className="form-field">
              <span>当前密码</span>
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                required
              />
            </label>

            <label className="form-field">
              <span>新密码</span>
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                minLength={6}
                required
              />
            </label>

            <label className="form-field">
              <span>确认新密码</span>
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                minLength={6}
                required
              />
            </label>

            <button className="text-button profile-forgot-password" type="button" onClick={handleForgotCurrentPassword} disabled={passwordSaving || passwordResetSending}>
              {passwordResetSending ? '发送中' : '忘记当前密码？'}
            </button>

            {passwordMessage ? <p className="form-alert">{passwordMessage}</p> : null}
            {passwordSuccess ? <p className="form-success">{passwordSuccess}</p> : null}
          </form>
        </SystemModal>
      ) : null}

      {cropImageUrl ? (
        <SystemModal
          title="调整头像"
          subtitle="拖动图片选择正方形范围，可放大或缩小"
          ariaLabel="调整头像"
          className="profile-crop-modal"
          onClose={uploading ? () => undefined : closeAvatarCrop}
          footer={
            <>
              <button className="secondary-action" type="button" onClick={closeAvatarCrop} disabled={uploading}>
                取消
              </button>
              <button className="primary-button" type="button" onClick={handleSaveCroppedAvatar} disabled={uploading}>
                {uploading ? '保存中...' : '保存头像'}
              </button>
            </>
          }
        >
          <div className="avatar-crop-panel">
            <div
              className="avatar-crop-frame"
              onPointerDown={handleCropPointerDown}
              onPointerMove={handleCropPointerMove}
              onPointerUp={handleCropPointerEnd}
              onPointerCancel={handleCropPointerEnd}
            >
              <img
                src={cropImageUrl}
                alt="头像裁切预览"
                draggable={false}
                style={{
                  width: `${cropDisplayWidth}px`,
                  height: `${cropDisplayHeight}px`,
                  transform: `translate(calc(-50% + ${cropOffset.x}px), calc(-50% + ${cropOffset.y}px))`,
                }}
              />
            </div>
            <label className="avatar-crop-control">
              <span>缩放</span>
              <input type="range" min="1" max="3" step="0.01" value={cropZoom} onChange={handleCropZoomChange} disabled={uploading} />
            </label>
          </div>
        </SystemModal>
      ) : null}

      {downloadChoiceOpen ? (
        <SystemModal title="下载电子名片" subtitle="选择版式" ariaLabel="下载电子名片" wide={false} onClose={() => setDownloadChoiceOpen(false)}>
          <div className="business-card-download-options">
            <button className="secondary-action" type="button" onClick={() => handleDownloadCard('horizontal')} disabled={downloadingCard}>
              下载横式电子名片
            </button>
            <button className="secondary-action" type="button" onClick={() => handleDownloadCard('vertical')} disabled={downloadingCard}>
              下载竖式电子名片
            </button>
          </div>
        </SystemModal>
      ) : null}

      {businessCardPreviewUrl ? (
        <SystemModal title="电子名片预览" subtitle="长按电子名片即可保存图片" ariaLabel="电子名片高清预览" onClose={() => setBusinessCardPreviewUrl(null)}>
          <img
            src={businessCardPreviewUrl}
            alt="电子名片高清预览"
            style={{ display: 'block', width: '100%', maxWidth: '100%', height: 'auto', objectFit: 'contain' }}
          />
        </SystemModal>
      ) : null}

      {contactEditOpen ? (
        <SystemModal
          title="编辑电子名片"
          subtitle="联系方式"
          ariaLabel="编辑电子名片联系方式"
          wide={false}
          onClose={() => setContactEditOpen(false)}
          footer={
            <>
              <button className="secondary-action" type="button" onClick={() => setContactEditOpen(false)} disabled={saving}>
                取消
              </button>
              <button className="primary-button" type="submit" form="business-card-contact-form" disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </>
          }
        >
          <form id="business-card-contact-form" className="business-card-contact-form" onSubmit={handleSaveBusinessCardContact}>
            <label className="form-field">
              <span>Whatsapp</span>
              <input value={contactForm.whatsapp} onChange={(event) => setContactForm((current) => ({ ...current, whatsapp: event.target.value }))} />
            </label>
            <label className="form-field">
              <span>Wechat</span>
              <input value={contactForm.wechat} onChange={(event) => setContactForm((current) => ({ ...current, wechat: event.target.value }))} />
            </label>
          </form>
        </SystemModal>
      ) : null}
    </section>
  );
}

function BusinessCardQrPreview({ qrs }: { qrs: Array<{ type: BusinessCardQrType; label: string; url: string }> }) {
  return (
    <div className={`business-card-qr-preview business-card-qr-preview-${qrs.length}`}>
      <span>SCAN TO CONNECT</span>
      <div>
        {qrs.map((qr) => (
          <figure key={qr.type}>
            <img src={qr.url} alt={`${qr.label} QR Code`} />
            <figcaption>{qr.label}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function QrUploadCard({
  type,
  label,
  url,
  inputRef,
  uploading,
  onChange,
  onDelete,
  children,
}: {
  type: BusinessCardQrType;
  label: string;
  url: string | null;
  inputRef: RefObject<HTMLInputElement>;
  uploading: boolean;
  onChange: (type: BusinessCardQrType, event: ChangeEvent<HTMLInputElement>) => void;
  onDelete: (type: BusinessCardQrType) => void;
  children: ReactNode;
}) {
  return (
    <article className="business-card-qr-upload-card">
      <strong>{label}</strong>
      {children}
      {url ? <img src={url} alt={`${label} 预览`} /> : <p>尚未上传</p>}
      <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onChange(type, event)} disabled={uploading} />
      <div>
        <button className="secondary-action" type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
          <Upload size={16} />
          {uploading ? '上传中...' : url ? '更换' : '上传'}
        </button>
        {url ? (
          <button className="text-button business-card-qr-delete" type="button" onClick={() => onDelete(type)} disabled={uploading}>
            <Trash2 size={16} /> 删除
          </button>
        ) : null}
      </div>
      <small>支持 JPEG、PNG、WebP，最大 5MB。</small>
    </article>
  );
}

function CardContact({
  kind,
  label,
  value,
}: {
  kind: ContactKind;
  label: string;
  value: string;
}) {
  const icons: Record<ContactKind, string> = {
    whatsapp: whatsappIconUrl,
    wechat: wechatIconUrl,
    instagram: instagramIconUrl,
    facebook: facebookIconUrl,
  };

  return (
    <div className={`business-card-contact-row ${kind}`}>
      <span className={`business-card-app-icon ${kind}`} aria-label={label}>
        <img src={icons[kind]} alt="" />
      </span>
      <strong>{value.trim() || '-'}</strong>
    </div>
  );
}

function EditableField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="form-field profile-final-field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <label className="form-field profile-final-field">
      <span>{label}</span>
      <input value={value || '未设置'} disabled />
    </label>
  );
}

function ProfileInfo({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || '未设置'}</strong>
    </div>
  );
}

function formatTime(value: string | null | undefined) {
  return value ? value.slice(0, 5) : '未设置';
}

function formatMoney(value: number | null | undefined) {
  return value === null || value === undefined ? '未设置' : `RM ${value.toFixed(2)}`;
}

function isIOSDevice() {
  const platform = navigator.platform || '';
  return /iPhone|iPad|iPod/.test(platform) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

async function shareBusinessCardFile(file: File) {
  const shareData: ShareData = { files: [file] };

  if (!navigator.share) {
    return { supported: false };
  }

  if (navigator.canShare && !navigator.canShare(shareData)) {
    return { supported: false };
  }

  try {
    await navigator.share(shareData);
    return { supported: true };
  } catch (error) {
    if (isShareAbortError(error)) {
      throw error;
    }

    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'NotSupportedError')) {
      return { supported: false };
    }

    throw error;
  }
}

function isShareAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function drawBusinessCard(
  context: CanvasRenderingContext2D,
  values: {
    orientation: 'horizontal' | 'vertical';
    name: string;
    jobTitle: string;
    whatsapp: string;
    wechat: string;
    avatarUrl: string | null | undefined;
    initials: string;
    companyChineseName: string;
    companyEnglishName: string;
    companyRegistrationNo: string;
    companyInstagram: string;
    companyFacebook: string;
    wechatQrUrl: string | null;
    instagramQrUrl: string | null;
    showWechatQrOnCard: boolean;
    showInstagramQrOnCard: boolean;
  },
) {
  const { canvas } = context;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const accentGradient = context.createLinearGradient(0, 0, canvas.width, 0);
  accentGradient.addColorStop(0, '#e83e8c');
  accentGradient.addColorStop(1, '#7c3aed');

  context.fillStyle = '#ffffff';
  context.strokeStyle = '#dfe6ef';
  context.lineWidth = 2;
  roundedRect(context, 34, 34, canvas.width - 68, canvas.height - 68, 26);
  context.fill();
  context.stroke();

  const logo = await loadImage(logoUrl);
  const isHorizontal = values.orientation === 'horizontal';
  const leftGroupX = 90;
  const leftGroupWidth = isHorizontal ? 800 : canvas.width - 244;
  const companyCenterX = isHorizontal ? leftGroupX + leftGroupWidth / 2 : canvas.width / 2;
  const companyTop = isHorizontal ? 72 : 92;

  if (logo) {
    const logoSize = isHorizontal ? 116 : 92;
    drawContainImage(context, logo, companyCenterX - logoSize / 2, companyTop, logoSize, logoSize);
  }

  context.fillStyle = '#172033';
  context.textAlign = 'center';
  context.font = `bold ${isHorizontal ? 56 : 42}px "Microsoft YaHei", Arial`;
  context.fillText(values.companyChineseName, companyCenterX, companyTop + (isHorizontal ? 170 : 138));

  context.fillStyle = '#172033';
  context.font = `bold ${isHorizontal ? 28 : 26}px Arial`;
  if (values.companyEnglishName) {
    context.fillText(values.companyEnglishName, companyCenterX, companyTop + (isHorizontal ? 216 : 178));
  }

  context.fillStyle = '#68758a';
  context.font = `${isHorizontal ? 25 : 22}px Arial`;
  if (values.companyRegistrationNo) {
    context.fillText(values.companyRegistrationNo, companyCenterX, companyTop + (isHorizontal ? 258 : 214));
  }

  context.fillStyle = accentGradient;
  context.fillRect(companyCenterX - 95, companyTop + (isHorizontal ? 302 : 242), 190, 7);
  context.fillRect(0, canvas.height - (values.orientation === 'horizontal' ? 24 : 30), canvas.width, values.orientation === 'horizontal' ? 24 : 30);
  context.beginPath();
  context.moveTo(canvas.width - 210, canvas.height - (values.orientation === 'horizontal' ? 44 : 54));
  context.lineTo(canvas.width, canvas.height - (values.orientation === 'horizontal' ? 44 : 54));
  context.lineTo(canvas.width, canvas.height - (values.orientation === 'horizontal' ? 24 : 30));
  context.lineTo(canvas.width - 246, canvas.height - (values.orientation === 'horizontal' ? 24 : 30));
  context.closePath();
  context.fill();

  const image = values.avatarUrl ? await loadImage(values.avatarUrl) : null;
  const qrs = await loadBusinessCardQrs(
    values.showWechatQrOnCard ? values.wechatQrUrl : null,
    values.showInstagramQrOnCard ? values.instagramQrUrl : null,
  );
  const contactLogos = {
    whatsapp: await loadImage(whatsappIconUrl),
    wechat: await loadImage(wechatIconUrl),
    instagram: await loadImage(instagramIconUrl),
    facebook: await loadImage(facebookIconUrl),
  };

  if (values.orientation === 'horizontal') {
    drawCardDetails(context, values, contactLogos, leftGroupX, qrs.length ? 450 : 520, leftGroupWidth);
    drawBusinessCardQrs(context, qrs, 90, 680, 800, 182);
    drawAvatar(context, values, image, 990, 224, 500);
    return;
  }

  drawAvatar(context, values, image, 340, 420, 280);
  drawCardDetails(context, values, contactLogos, 122, 780, 716);
  drawBusinessCardQrs(context, qrs, 122, 1160, 716, 198);
}

async function loadBusinessCardQrs(wechatQrUrl: string | null, instagramQrUrl: string | null) {
  const entries = await Promise.all(
    ([
      ['wechat', 'WeChat', wechatQrUrl],
      ['instagram', 'Instagram', instagramQrUrl],
    ] as const)
      .filter(([, , url]) => Boolean(url))
      .map(async ([type, label, url]) => {
        const image = await loadImage(url!);
        if (!image) throw new Error(`${label} 二维码加载失败，无法生成完整电子名片。`);
        return { type, label, image };
      }),
  );
  return entries;
}

function drawBusinessCardQrs(
  context: CanvasRenderingContext2D,
  qrs: Array<{ type: BusinessCardQrType; label: string; image: HTMLImageElement }>,
  x: number,
  y: number,
  width: number,
  size: number,
) {
  if (!qrs.length) return;

  context.textAlign = 'center';
  context.fillStyle = '#68758a';
  context.font = 'bold 18px Arial';
  context.fillText('SCAN TO CONNECT', x + width / 2, y);
  const gap = qrs.length === 2 ? 42 : 0;
  const totalWidth = qrs.length * size + (qrs.length - 1) * gap;
  const startX = x + (width - totalWidth) / 2;

  qrs.forEach((qr, index) => {
    const qrX = startX + index * (size + gap);
    context.fillStyle = '#ffffff';
    roundedRect(context, qrX - 10, y + 16, size + 20, size + 20, 8);
    context.fill();
    drawContainImage(context, qr.image, qrX, y + 26, size, size);
    context.fillStyle = '#172033';
    context.font = 'bold 19px Arial';
    context.fillText(qr.label, qrX + size / 2, y + size + 68);
  });
}

function drawCardDetails(
  context: CanvasRenderingContext2D,
  values: {
    orientation: 'horizontal' | 'vertical';
    name: string;
    jobTitle: string;
    whatsapp: string;
    wechat: string;
    companyInstagram: string;
    companyFacebook: string;
  },
  contactLogos: Record<ContactKind, HTMLImageElement | null>,
  x: number,
  y: number,
  width: number,
) {
  if (values.orientation === 'vertical') {
    const centerX = x + width / 2;
    context.textAlign = 'center';
    context.fillStyle = '#05070d';
    context.font = 'bold 52px "Microsoft YaHei", Arial';
    context.fillText(values.name, centerX, y);

    context.font = 'bold 32px "Microsoft YaHei", Arial';
    const verticalTitleGradient = context.createLinearGradient(centerX - 90, y + 34, centerX + 90, y + 64);
    verticalTitleGradient.addColorStop(0, '#e83e8c');
    verticalTitleGradient.addColorStop(1, '#7c3aed');
    context.fillStyle = verticalTitleGradient;
    context.fillText(values.jobTitle, centerX, y + 58);

    const rows = [
      ['whatsapp', values.whatsapp],
      ['instagram', values.companyInstagram],
      ['wechat', values.wechat],
      ['facebook', values.companyFacebook],
    ].filter(([, value]) => value.trim()) as Array<[ContactKind, string]>;

    if (rows.length === 0) {
      return;
    }

    const contactTop = y + 126;
    const columnWidth = 308;
    const dividerX = x + width / 2;
    context.strokeStyle = '#d8dde7';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(dividerX, contactTop - 26);
    context.lineTo(dividerX, contactTop + 116);
    context.stroke();

    rows.forEach(([kind, value], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const rowX = column === 0 ? x + 34 : dividerX + 34;
      drawCanvasContactRow(context, kind, value, contactLogos[kind], rowX, contactTop + row * 76, columnWidth, false);
    });
    return;
  }

  context.textAlign = 'left';
  context.fillStyle = '#05070d';
  context.font = 'bold 56px "Microsoft YaHei", Arial';
  context.fillText(values.name, x, y);

  context.font = 'bold 30px "Microsoft YaHei", Arial';
  const titleGradient = context.createLinearGradient(x, y + 34, x + 190, y + 64);
  titleGradient.addColorStop(0, '#e83e8c');
  titleGradient.addColorStop(1, '#7c3aed');
  context.fillStyle = titleGradient;
  context.fillText(values.jobTitle, x, y + 58);

  const contactTop = y + 140;
  const dividerX = x + 430;
  context.strokeStyle = '#d8dde7';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(dividerX, contactTop - 20);
  context.lineTo(dividerX, contactTop + 118);
  context.stroke();

  drawCanvasContactRow(context, 'whatsapp', values.whatsapp, contactLogos.whatsapp, x, contactTop, 330, false);
  drawCanvasContactRow(context, 'wechat', values.wechat, contactLogos.wechat, x, contactTop + 72, 330, false);
  drawCanvasContactRow(context, 'instagram', values.companyInstagram || '-', contactLogos.instagram, x + 500, contactTop, width - 500, false);
  drawCanvasContactRow(context, 'facebook', values.companyFacebook || '-', contactLogos.facebook, x + 500, contactTop + 72, width - 500, false);
}

function drawCanvasContactRow(
  context: CanvasRenderingContext2D,
  kind: ContactKind,
  value: string,
  logo: HTMLImageElement | null,
  x: number,
  y: number,
  width: number,
  withDivider: boolean,
) {
  if (withDivider) {
    context.strokeStyle = '#d8dde7';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x, y + 52);
    context.lineTo(x + width, y + 52);
    context.stroke();
  }

  drawCanvasAppIcon(context, kind, logo, x, y - 30, 44);
  context.fillStyle = '#111827';
  context.font = '30px Arial';
  context.textAlign = 'left';
  context.fillText(value, x + 68, y + 4);
}

function drawCanvasAppIcon(
  context: CanvasRenderingContext2D,
  kind: ContactKind,
  logo: HTMLImageElement | null,
  x: number,
  y: number,
  size: number,
) {
  if (logo) {
    context.save();
    roundedRect(context, x, y, size, size, 12);
    context.clip();
    drawContainImage(context, logo, x + 10, y + 10, 24, 24);
    context.restore();
    return;
  }

  const gradient = context.createLinearGradient(x, y, x + size, y + size);
  if (kind === 'whatsapp' || kind === 'instagram') {
    gradient.addColorStop(0, '#f01384');
    gradient.addColorStop(1, '#8a21d2');
  } else {
    gradient.addColorStop(0, '#5e239d');
    gradient.addColorStop(1, '#43229b');
  }

  context.fillStyle = gradient;
  roundedRect(context, x, y, size, size, 12);
  context.fill();

  context.strokeStyle = '#ffffff';
  context.fillStyle = '#ffffff';
  context.lineWidth = 4;

  if (kind === 'instagram') {
    roundedRect(context, x + 13, y + 13, size - 26, size - 26, 9);
    context.stroke();
    context.beginPath();
    context.arc(x + size / 2, y + size / 2, 8, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(x + size - 17, y + 17, 2.8, 0, Math.PI * 2);
    context.fill();
    return;
  }

  if (kind === 'facebook') {
    context.font = 'bold 40px Arial';
    context.textAlign = 'center';
    context.fillText('f', x + size / 2 + 2, y + size - 10);
    return;
  }

  if (kind === 'wechat') {
    context.beginPath();
    context.ellipse(x + 23, y + 25, 14, 11, 0, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.ellipse(x + 34, y + 32, 14, 11, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#43229b';
    context.beginPath();
    context.arc(x + 18, y + 23, 2, 0, Math.PI * 2);
    context.arc(x + 27, y + 23, 2, 0, Math.PI * 2);
    context.arc(x + 30, y + 30, 2, 0, Math.PI * 2);
    context.arc(x + 39, y + 30, 2, 0, Math.PI * 2);
    context.fill();
    return;
  }

  context.beginPath();
  context.arc(x + size / 2, y + size / 2, 16, 0.35, Math.PI * 1.78);
  context.stroke();
  context.font = 'bold 28px Arial';
  context.textAlign = 'center';
  context.fillText('☎', x + size / 2, y + size / 2 + 10);
}

function drawAvatar(
  context: CanvasRenderingContext2D,
  values: { initials: string },
  image: HTMLImageElement | null,
  x: number,
  y: number,
  size: number,
) {
  context.save();
  roundedRect(context, x, y, size, size, 26);
  context.clip();

  if (image) {
    drawCoverImage(context, image, x, y, size, size);
  } else {
    const gradient = context.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, '#e83e8c');
    gradient.addColorStop(1, '#7c3aed');
    context.fillStyle = gradient;
    context.fillRect(x, y, size, size);
    context.fillStyle = '#ffffff';
    context.font = `bold ${Math.round(size * 0.38)}px Arial`;
    context.textAlign = 'center';
    context.fillText(values.initials, x + size / 2, y + size * 0.62);
  }

  context.restore();
  context.strokeStyle = '#dfe6ef';
  context.lineWidth = 3;
  roundedRect(context, x, y, size, size, 26);
  context.stroke();
}

async function createCroppedAvatarBlob(
  imageUrl: string,
  imageSize: { width: number; height: number },
  zoom: number,
  offset: { x: number; y: number },
) {
  const image = await loadImage(imageUrl);

  if (!image) {
    throw new Error('无法读取头像图片。');
  }

  const canvas = document.createElement('canvas');
  canvas.width = avatarOutputSize;
  canvas.height = avatarOutputSize;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('无法处理头像图片。');
  }

  const baseScale = Math.max(avatarCropSize / imageSize.width, avatarCropSize / imageSize.height);
  const displayWidth = imageSize.width * baseScale * zoom;
  const displayHeight = imageSize.height * baseScale * zoom;
  const outputScale = avatarOutputSize / avatarCropSize;
  const drawX = (avatarCropSize / 2 + offset.x - displayWidth / 2) * outputScale;
  const drawY = (avatarCropSize / 2 + offset.y - displayHeight / 2) * outputScale;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, avatarOutputSize, avatarOutputSize);
  context.drawImage(image, drawX, drawY, displayWidth * outputScale, displayHeight * outputScale);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('头像图片生成失败。'));
        }
      },
      'image/jpeg',
      0.92,
    );
  });
}

function clampCropOffset(offset: { x: number; y: number }, imageSize: { width: number; height: number }, zoom: number) {
  if (!imageSize.width || !imageSize.height) return offset;

  const baseScale = Math.max(avatarCropSize / imageSize.width, avatarCropSize / imageSize.height);
  const displayWidth = imageSize.width * baseScale * zoom;
  const displayHeight = imageSize.height * baseScale * zoom;
  const maxX = Math.max(0, (displayWidth - avatarCropSize) / 2);
  const maxY = Math.max(0, (displayHeight - avatarCropSize) / 2);

  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function drawContainImage(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawCoverImage(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}
