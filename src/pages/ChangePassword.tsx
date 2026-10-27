import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { rpc, supabase } from '../lib/supabase';

export default function ChangePassword() {
  const { profile, loading, reloadProfile, signOut } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;
  if (!profile) return <Navigate to="/login" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) return setError('Use at least 8 characters.');
    if (pw !== pw2) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: pw });
      if (err) throw new Error(err.message.includes('different') ? 'Choose a password different from the temporary one.' : err.message);
      await rpc('clear_password_flag');
      await reloadProfile();
      nav(profile.role === 'admin' ? '/admin' : '/', { replace: true });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not change the password.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="center">
      <form className="panel pad stack loginbox" onSubmit={submit}>
        <div><h1>Choose your password</h1>
          <p className="muted small" style={{ marginTop: 4 }}>{profile.must_change_password ? 'You signed in with a temporary password. Choose your own to continue.' : 'Choose a new password.'}</p></div>
        {error && <div className="err" role="alert">{error}</div>}
        <label className="field" htmlFor="pw1">New password
          <input id="pw1" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </label>
        <label className="field" htmlFor="pw2">Type it again
          <input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
        </label>
        <button type="submit" className="btn primary block" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        <button type="button" className="link small" onClick={async () => { await signOut(); nav('/login'); }}>Sign out instead</button>
      </form>
    </div>
  );
}
