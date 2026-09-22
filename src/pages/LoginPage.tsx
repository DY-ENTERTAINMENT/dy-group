import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { authService } from '../services/auth.service';
import { isSupabaseConfigured } from '../lib/supabase';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/dashboard';
  const accountDisabled = Boolean((location.state as { accountDisabled?: boolean } | null)?.accountDisabled);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');

    const { data, error } = await authService.signIn(email, password);

    setSubmitting(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    if (data.user) {
      navigate(from, { replace: true });
    }
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit}>
      <div className="auth-card-heading">
        <h2>登录</h2>
      </div>

      {!isSupabaseConfigured ? <p className="form-alert">请先在 .env 填写 Supabase 连接信息。</p> : null}

      <label className="form-field">
        <span>邮箱</span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>

      <label className="form-field">
        <span>密码</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={6}
          required
        />
      </label>

      {message ? <p className="form-alert">{message}</p> : null}
      {accountDisabled ? <p className="form-alert">该员工账号已停用，请联系管理员。</p> : null}

      <button className="primary-button" type="submit" disabled={submitting || !isSupabaseConfigured}>
        <LogIn size={18} />
        <span>{submitting ? '登录中' : '登录'}</span>
      </button>

      <p className="auth-switch auth-switch-stack">
        <Link to="/forgot-password">忘记密码？</Link>
        <Link to="/register">注册账号</Link>
      </p>
    </form>
  );
}
