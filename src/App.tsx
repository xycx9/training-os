import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { configured } from './lib/supabase';
import type { Role } from './lib/types';
import { AdminLayout, StaffLayout } from './components/Layout';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Modules from './pages/admin/Modules';
import ModuleDetail from './pages/admin/ModuleDetail';
import ModuleEditor from './pages/admin/ModuleEditor';
import Staff from './pages/admin/Staff';
import Records from './pages/admin/Records';
import PrintLog from './pages/admin/PrintLog';
import Sessions, { SessionDetail } from './pages/admin/Sessions';
import SessionForm from './pages/admin/SessionForm';
import Home from './pages/staff/Home';
import Learn from './pages/staff/Learn';
import Quiz from './pages/staff/Quiz';
import MyRecords, { MyRecordPrint } from './pages/staff/MyRecords';
import OfficialRecord from './pages/staff/Official';
import Company from './pages/admin/Company';
import SteYears from './pages/admin/ste/Years';
import SteWorkbook from './pages/admin/ste/Workbook';
import SteTrainerPage from './pages/admin/ste/Trainer';
import SteReport from './pages/admin/ste/Report';

function Splash() {
  return <div className="center"><p className="muted">Loading…</p></div>;
}

function Gate({ role, children }: { role?: Role; children: ReactNode }) {
  const { loading, profile } = useAuth();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!profile) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (profile.must_change_password) return <Navigate to="/change-password" replace />;
  if (role && profile.role !== role) return <Navigate to={profile.role === 'admin' ? '/admin' : '/'} replace />;
  return <>{children}</>;
}

export default function App() {
  if (!configured) {
    return (
      <div className="center"><div className="panel pad stack loginbox" style={{ padding: 28 }}>
        <h1>Almost there</h1>
        <p>The app is not connected to Supabase yet. Add <span className="mono">VITE_SUPABASE_URL</span> and <span className="mono">VITE_SUPABASE_ANON_KEY</span> to the environment settings and deploy again. The setup guide in README.md explains where to find them.</p>
      </div></div>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route path="/admin/records/print" element={<Gate role="admin"><PrintLog /></Gate>} />
      <Route path="/admin" element={<Gate role="admin"><AdminLayout /></Gate>}>
        <Route index element={<Modules />} />
        <Route path="modules/new" element={<ModuleEditor />} />
        <Route path="modules/:id" element={<ModuleDetail />} />
        <Route path="modules/:id/edit" element={<ModuleEditor />} />
        <Route path="staff" element={<Staff />} />
        <Route path="records" element={<Records />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="sessions/new" element={<SessionForm />} />
        <Route path="sessions/:id" element={<SessionDetail />} />
        <Route path="company" element={<Company />} />
        <Route path="ste" element={<SteYears />} />
        <Route path="ste/:id" element={<SteWorkbook />} />
        <Route path="ste/:id/trainer" element={<SteTrainerPage />} />
        <Route path="ste/:id/report" element={<SteReport />} />
      </Route>
      <Route path="/records/print" element={<Gate role="staff"><MyRecordPrint /></Gate>} />
      <Route path="/records/official" element={<Gate role="staff"><OfficialRecord /></Gate>} />
      <Route path="/" element={<Gate role="staff"><StaffLayout /></Gate>}>
        <Route index element={<Home />} />
        <Route path="learn/:id" element={<Learn />} />
        <Route path="learn/:id/quiz" element={<Quiz />} />
        <Route path="records" element={<MyRecords />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
