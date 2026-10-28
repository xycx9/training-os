import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { APP_NAME } from '../lib/supabase';
import { useCompany } from '../lib/company';
import { AdminDataProvider, useAdmin } from '../lib/data';
import { Mark } from './Mark';

export function TopBar({ tabs }: { tabs?: boolean }) {
  const { profile, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const { company } = useCompany();
  return (
    <header className="topbar">
      <div className="bar gutter">
        <Link className="brand" to="/">
          <Mark />
          <span className="name"><b>{APP_NAME}</b><span>{company.name}</span></span>
        </Link>
        {tabs && (
          <nav className="stabs" aria-label="My training">
            <NavLink to="/" end className={({ isActive }) => (isActive || loc.pathname.startsWith('/learn') ? 'active' : '')}>My training</NavLink>
            <NavLink to="/records">My records</NavLink>
          </nav>
        )}
        {profile && (
          <div className="who">
            <span className="person"><b>{profile.full_name}</b><span>{profile.role === 'admin' ? 'Administrator' : profile.job_role}</span></span>
            <button type="button" className="btn onbrand" onClick={async () => { await signOut(); nav('/login'); }}>Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}

function AdminBody() {
  const { data, error, reload } = useAdmin();
  if (error) return <div className="panel pad stack"><div className="err">{error}</div><button type="button" className="btn" onClick={reload}>Try again</button></div>;
  if (!data) return <p className="muted">Loading…</p>;
  return <Outlet />;
}

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export function AdminLayout() {
  return (
    <AdminDataProvider>
      <TopBar />
      <div className="shell">
        <nav className="nav" aria-label="Administration">
          <span className="navlabel">Administration</span>
          <NavLink to="/admin" end><Icon d="M4 5h16v14H4zM4 9h16M9 9v10" />Modules</NavLink>
          <NavLink to="/admin/staff"><Icon d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.15a3 3 0 0 1 0 5.7" />Staff</NavLink>
          <NavLink to="/admin/records"><Icon d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />Training records</NavLink>
          <NavLink to="/admin/sessions"><Icon d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M8 14h3" />Past sessions</NavLink>
          <NavLink to="/admin/company"><Icon d="M4 21V5l8-2v18M12 7h8v14M7 8h2M7 12h2M7 16h2M15 11h2M15 15h2M2 21h20" />Company profile</NavLink>
        </nav>
        <main className="work"><AdminBody /></main>
      </div>
    </AdminDataProvider>
  );
}

export function StaffLayout() {
  return (
    <>
      <TopBar tabs />
      <main className="staffwrap"><Outlet /></main>
    </>
  );
}
