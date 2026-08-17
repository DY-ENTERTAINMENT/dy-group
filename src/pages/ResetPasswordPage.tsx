import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { authService } from '../services/auth.service';
import { isSupabaseConfigured } from '../lib/supabase';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setSuccessMessage('');

    if (password.length < 6) {
      setMessage('新密码至少需要 6 位。');
      return;
    }

    if (password !== confirmPassword) {
      setMessage('两次输入的密码不一致。');
      return;
    }

    setSubmitting(true);
    const { error } = await authService.updatePassword(password);
    setSubmitting(false);

    if (error) {
      setMessage(`密码更新失败：${error.message}`);
      return;
    }

    setSuccessMessage('密码已更新，请使用新密码登录。');
    setTimeout(() => navigate('/login', { replace: true }), 1200);
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit}>
      <div className="auth-card-heading">
        <h2>重置密码</h2>
      </div>

      {!isSupabaseConfigured ? <p className="form-alert">请先在 .env 填写 Supabase 连接信息。</p> : null}

      <label className="form-field password-field">
        <span>新密码</span>
        <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={6}
          required
        />
        <button
          type="button"
          onClick={() => setShowPassword((value) => !value)}
          aria-label={showPassword ? '隐藏密码' : '显示密码'}
        >
          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </label>

      <label className="form-field password-field">
        <span>确认密码</span>
        <input
          type={showConfirmPassword ? 'text' : 'password'}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          minLength={6}
          required
        />
        <button
          type="button"
          onClick={() => setShowConfirmPassword((value) => !value)}
          aria-label={showConfirmPassword ? '隐藏密码' : '显示密码'}
        >
          {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </label>

      {message ? <p className="form-alert">{message}</p> : null}
      {successMessage ? <p className="form-success">{successMessage}</p> : null}

      <button className="primary-button" type="submit" disabled={submitting || !isSupabaseConfigured}>
        <KeyRound size={18} />
        <span>{submitting ? '修改中' : '确认修改'}</span>
      </button>

      <p className="auth-switch">
        <Link to="/login">返回登录</Link>
      </p>
    </form>
  );
}
