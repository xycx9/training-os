import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, fmtH, resultLabel, type HistRow } from '../../lib/logic';
import { APP_NAME, ORG_NAME } from '../../lib/supabase';
import { useStaffData } from './Home';

interface Group { key: string; title: string; rows: HistRow[]; best?: HistRow; hours: number; recorded: boolean }

function groupRows(rows: HistRow[]): Group[] {
  const m = new Map<string, HistRow[]>();
  rows.forEach((r) => { const k = r.module_id ?? `t:${r.module_title.toLowerCase()}`; m.set(k, [...(m.get(k) ?? []), r]); });
  return [...m.entries()].map(([key, rs]) => {
    const sorted = rs.slice().sort((a, b) => (a.taken_on === b.taken_on ? (a.submitted_at < b.submitted_at ? 1 : -1) : a.taken_on < b.taken_on ? 1 : -1));
    const best = sorted.filter((x) => x.passed).sort((a, b) => (b.score ?? 101) - (a.score ?? 101))[0];
    return { key, title: sorted[0].module_title, rows: sorted, best, hours: sorted.reduce((t, x) => t + x.hours, 0), recorded: sorted.some((x) => x.manual) };
  }).sort((a, b) => (a.rows[0].taken_on < b.rows[0].taken_on ? 1 : -1));
}

const sourceLabel = (r: HistRow) => (r.manual ? `Recorded${r.delivered_by ? ` · ${r.delivered_by}` : ''}` : 'Online assessment');

export default function MyRecords() {
  const { d, err } = useStaffData();
  const [year, setYear] = useState('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const all = useMemo(() => (d ? d.ledger.history(d.me.id) : []), [d]);
  if (err) return <div className="err">{err}</div>;
  if (!d) return <p className="muted">Loading…</p>;

  const years = [...new Set(all.map((r) => r.taken_on.slice(0, 4)))].sort().reverse();
  const rows = all.filter((r) => year === 'all' || r.taken_on.startsWith(year));
  const groups = groupRows(rows);
  const hours = rows.reduce((t, r) => t + r.hours, 0);

  return (
    <>
      <div className="spread">
        <div><p className="eyebrow">My records</p><h1 style={{ marginTop: 4 }}>Your training record</h1>
          <p className="small muted" style={{ marginTop: 6 }}>Everything you’ve completed, including failed attempts and earlier training entered by your administrator.</p></div>
        <Link className="btn" to={`/records/print?year=${year}`}>Print my record</Link>
      </div>
      <div className="panel pad row" style={{ alignItems: 'flex-end', gap: 14, justifyContent: 'space-between' }}>
        <label className="field" htmlFor="my-year">Year
          <select id="my-year" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="all">All years</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select></label>
        <div className="stats">
          <div className="stat ok"><b>{groups.filter((g) => g.best).length}</b><span>Trainings completed</span></div>
          <div className="stat"><b>{fmtH(hours)}</b><span>Training hours</span></div>
          <div className="stat"><b>{rows.length}</b><span>Records</span></div>
        </div>
      </div>
      <div className="panel">
        {!groups.length ? <p className="pad muted">{all.length ? 'No records for this year.' : 'No training records yet. Completed modules will appear here.'}</p> : groups.map((g) => {
          const isOpen = !!open[g.key];
          return (
            <div className="group" key={g.key}>
              <button type="button" className="ghead" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [g.key]: !isOpen })}>
                <span className="t"><b>{g.title}</b><span>{g.rows.length} record{g.rows.length === 1 ? '' : 's'} · latest {fmt(g.rows[0].taken_on)}{g.recorded ? ' · includes recorded training' : ''}</span></span>
                <span className="hide-sm">{g.best ? <span className="pill ok">{g.best.result === 'completed' ? 'Completed' : 'Passed'}{g.best.score != null ? ` ${g.best.score}%` : ''}</span> : <span className="pill bad">Not passed</span>}</span>
                <span className="hide-sm mono small muted">{fmtH(g.hours)}</span>
                <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </button>
              {isOpen && (
                <div className="attempts"><div className="box">
                  <table>
                    <thead><tr><th>Date</th><th>Type</th><th>Version</th><th>Score</th><th>Result</th><th>Hours</th></tr></thead>
                    <tbody>{g.rows.map((r) => (
                      <tr key={r.id}><td style={{ whiteSpace: 'nowrap' }}>{fmt(r.taken_on)}</td><td>{sourceLabel(r)}</td><td className="mono small">{r.manual ? '—' : r.version_label}</td>
                        <td>{r.score != null ? `${r.score}%` : '—'}</td><td>{r.result === 'fail' ? <span className="pill bad">Fail</span> : <span className="pill ok">{resultLabel(r)}</span>}</td><td>{fmtH(r.hours)}</td></tr>
                    ))}</tbody>
                  </table>
                </div></div>
              )}
            </div>
          );
        })}
      </div>
      <p className="small muted">“Recorded” means the training happened outside this system and your administrator entered it. If anything here looks wrong, tell your compliance officer.</p>
    </>
  );
}

/** Printable copy of the signed-in staff member's own record. */
export function MyRecordPrint() {
  const { d, err } = useStaffData();
  const year = new URLSearchParams(window.location.search).get('year') || 'all';
  if (err) return <div className="printpage err">{err}</div>;
  if (!d) return <div className="printpage muted">Preparing your record…</div>;
  const rows = d.ledger.history(d.me.id).filter((r) => year === 'all' || r.taken_on.startsWith(year));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  return (
    <div className="printpage stack">
      <div className="row noprint">
        <Link className="btn" to="/records">← Back</Link>
        <button type="button" className="btn primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <header className="stack" style={{ gap: 4 }}>
        <p className="small muted">{ORG_NAME}</p>
        <h1>Training record: {d.me.full_name}</h1>
        <p className="small">{d.me.job_role} · joined {fmt(d.me.joined_on)} · Period: <b>{year === 'all' ? 'All years' : year}</b></p>
        <p className="small muted">Printed {fmt(today)} from {APP_NAME}. “Recorded” rows were entered by an administrator for training delivered outside the system.</p>
      </header>
      <p className="small">{rows.length} records · {fmtH(rows.reduce((t, r) => t + r.hours, 0))} of training</p>
      {rows.length ? (
        <table>
          <thead><tr><th>Date</th><th>Training</th><th>Type</th><th>Score</th><th>Result</th><th>Hours</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{fmt(r.taken_on)}</td><td>{r.module_title}{r.manual ? '' : ` (${r.version_label})`}</td><td>{sourceLabel(r)}</td><td>{r.score != null ? `${r.score}%` : '—'}</td><td>{resultLabel(r)}</td><td>{fmtH(r.hours)}</td></tr>
          ))}</tbody>
        </table>
      ) : <p className="small muted">No records for this period.</p>}
    </div>
  );
}
