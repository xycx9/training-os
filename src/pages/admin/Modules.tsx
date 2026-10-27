import { Link, useNavigate } from 'react-router-dom';
import { useAdmin } from '../../lib/data';
import { cycleLabel, fmtH } from '../../lib/logic';
import type { Module } from '../../lib/types';

export const statusPill = (m: Module, pending = 0) =>
  m.status === 'published' ? <span className="pill ok">Published</span> : pending ? <span className="pill warn">Needs review</span> : <span className="pill plain">Draft</span>;

export default function Modules() {
  const { data, ledger, currentVersion } = useAdmin();
  const nav = useNavigate();
  if (!data || !ledger) return null;
  const staff = ledger.staff().filter((s) => s.active);
  const over = staff.filter((s) => ledger.staffStatus(s.id).label === 'Overdue').length;
  const ref = staff.filter((s) => ledger.staffStatus(s.id).label === 'Refresher due').length;

  return (
    <>
      <div className="spread">
        <div><h1>Training modules</h1><p className="muted small" style={{ marginTop: 4 }}>Each module is one PDF plus its question bank.</p></div>
        <Link className="btn primary" to="/admin/modules/new">+ New module</Link>
      </div>
      {(over > 0 || ref > 0) && (
        <div className="banner">
          <span>{over > 0 && <><b>{over} staff</b> overdue. </>}{ref > 0 && <><b>{ref} staff</b> {ref > 1 ? 'have' : 'has'} a refresher to do.</>}</span>
          <Link className="link" to="/admin/staff">View staff</Link>
        </div>
      )}
      {data.modules.length === 0 ? (
        <div className="panel pad stack">
          <h2>No modules yet</h2>
          <p className="muted">Create your first module: upload a PDF, add its questions, choose who must complete it, then publish.</p>
          <div><Link className="btn primary" to="/admin/modules/new">Create a module</Link></div>
        </div>
      ) : (
        <div className="panel tablebox">
          <table>
            <thead><tr><th>Module</th><th>Version</th><th>Rules</th><th>Current round</th><th>Status</th></tr></thead>
            <tbody>
              {data.modules.map((m) => {
                const v = currentVersion(m.id);
                const n = ledger.assignees(m).length;
                return (
                  <tr key={m.id} className="clickable" onClick={() => nav(`/admin/modules/${m.id}`)}>
                    <td>
                      <Link className="link" to={`/admin/modules/${m.id}`} onClick={(e) => e.stopPropagation()}>{m.title}</Link>
                      <div className="small muted">{v?.page_count ?? '—'} pages · {fmtH(m.duration_hours)} session · {cycleLabel(m)}</div>
                    </td>
                    <td className="mono">{v?.label ?? '—'}</td>
                    <td>{m.per_attempt} questions per attempt<div className="small muted">Pass mark {m.pass_mark}% · {m.max_attempts} attempts</div></td>
                    <td>{!n ? <span className="muted">Not assigned</span> : m.status === 'published' ? `${ledger.passedCount(m)} of ${n} done` : `${n} assigned`}</td>
                    <td>{statusPill(m)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
