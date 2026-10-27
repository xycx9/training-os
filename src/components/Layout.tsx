import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ORG_NAME } from '../lib/supabase';
import { AdminDataProvider, useAdmin } from '../lib/data';

export function TopBar() {
  const { profile, signOut } = useAuth();
  const nav = useNavigate();
  return (
    <header className="topbar">
      <div className="brand"><b>Training OS</b><span className="muted small">{ORG_NAME}</span></div>
      {profile && (
        <div className="who">
          <span><b>{profile.full_name}</b> <span className="muted small">· {profile.role === 'admin' ? 'Admin' : profile.job_role}</span></span>
          <button type="button" className="btn slim" onClick={async () => { await signOut(); nav('/login'); }}>Sign out</button>
        </div>
      )}
    </header>
  );
}

function AdminBody() {
  const { data, error, reload } = useAdmin();
  if (error) return <div className="panel pad stack"><div className="err">{error}</div><button type="button" className="btn" onClick={reload}>Try again</button></div>;
  if (!data) return <p className="muted">Loading…</p>;
  return <Outlet />;
}

export function AdminLayout() {
  return (
    <AdminDataProvider>
      <TopBar />
      <div className="shell">
        <nav className="nav" aria-label="Admin">
          <NavLink to="/admin" end>Modules</NavLink>
          <NavLink to="/admin/staff">Staff</NavLink>
          <NavLink to="/admin/records">Training records</NavLink>
        </nav>
        <main className="work"><AdminBody /></main>
      </div>
    </AdminDataProvider>
  );
}

export function StaffLayout() {
  return (
    <>
      <TopBar />
      <main className="phone"><Outlet /></main>
    </>
  );
}
