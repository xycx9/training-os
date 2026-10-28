import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { APP_NAME } from '../lib/supabase';
import { useCompany } from '../lib/company';
import { Mark } from '../components/Mark';

export default function Login() {
  const { company } = useCompany();
  const { profile, loading, signIn, notice } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && profile) return <Navigate to={profile.must_change_password ? '/change-password' : profile.role === 'admin' ? '/admin' : '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await signIn(username, password); nav('/', { replace: true }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="center">
      <form className="panel loginbox" onSubmit={submit}>
        <div className="loginhead">
          <Mark size={44} tone="onWhite" />
          <div>
            <p className="eyebrow">{company.name}</p>
            <h1 style={{ marginTop: 4 }}>{APP_NAME}</h1>
            <p className="muted small" style={{ marginTop: 6 }}>Sign in to continue your training.</p>
          </div>
        </div>
        <div className="loginbody">
          {notice && <div className="warnbox">{notice}</div>}
          {error && <div className="err" role="alert">{error}</div>}
          <label className="field" htmlFor="login-user">Username
            <input id="login-user" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label className="field" htmlFor="login-pass">Password
            <input id="login-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="small muted">Forgot your password? Ask your administrator to reset it.</p>
        </div>
      </form>
    </div>
  );
}
