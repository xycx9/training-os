import { Fragment, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fmt, fmtH, resultLabel, todayMY, type HistRow } from '../../lib/logic';
import { APP_NAME } from '../../lib/supabase';
import { useCompany } from '../../lib/company';
import { useStaffData } from './Home';
import { FileList } from '../../components/Files';

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
  const [showOff, setShowOff] = useState(false);
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
        <div className="row">
          <Link className="btn" to={`/records/print?year=${year}`}>Print my record</Link>
          <button type="button" className="btn primary" aria-expanded={showOff} onClick={() => setShowOff(!showOff)}>Official training record</button>
        </div>
      </div>
      {showOff && <OfficialPicker years={years} onClose={() => setShowOff(false)} />}
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
                    <tbody>{g.rows.map((r) => {
                      const ses = r.session_id ? d.sessions.find((x) => x.id === r.session_id) : undefined;
                      const mats = r.session_id ? d.sessionFiles.filter((f) => f.session_id === r.session_id) : [];
                      return (
                        <Fragment key={r.id}>
                          <tr><td style={{ whiteSpace: 'nowrap' }}>{fmt(r.taken_on)}</td><td>{ses ? `Classroom session${ses.delivered_by ? ` · ${ses.delivered_by}` : ''}` : sourceLabel(r)}</td><td className="mono small">{r.manual ? '—' : r.version_label}</td>
                            <td>{r.score != null ? `${r.score}%` : '—'}</td><td>{r.result === 'fail' ? <span className="pill bad">Fail</span> : <span className="pill ok">{r.session_id && r.result === 'completed' ? 'Attended' : resultLabel(r)}</span>}</td><td>{fmtH(r.hours)}</td></tr>
                          {ses && (
                            <tr className="sessrow"><td colSpan={6}>
                              <div className="stack" style={{ gap: 8 }}>
                                <span className="small muted">{fmtH(ses.hours)} session{ses.assessed ? ` · assessed${ses.pass_mark != null ? `, pass mark ${ses.pass_mark}%` : ''}` : ' · attendance only'}{ses.notes ? ` · ${ses.notes}` : ''}</span>
                                {mats.length > 0 && <><b className="small">Slides and materials from this session</b><FileList files={mats} bucket="readings" /></>}
                                <span className="small muted">Your marked paper and the attendance sheet are kept by your administrator.</span>
                              </div>
                            </td></tr>
                          )}
                        </Fragment>
                      );
                    })}</tbody>
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

/** Choose the period for an official statement, then open it. */
function OfficialPicker({ years, onClose }: { years: string[]; onClose: () => void }) {
  const nav = useNavigate();
  const thisYear = todayMY().slice(0, 4);
  const [mode, setMode] = useState<'year' | 'custom' | 'all'>('year');
  const [y, setY] = useState(years.includes(thisYear) ? thisYear : years[0] ?? thisYear);
  const [from, setFrom] = useState(`${thisYear}-01-01`);
  const [to, setTo] = useState(todayMY());
  const go = () => {
    const q = mode === 'year' ? `from=${y}-01-01&to=${y}-12-31` : mode === 'custom' ? `from=${from}&to=${to}` : '';
    nav(`/records/official${q ? `?${q}` : ''}`);
  };
  return (
    <section className="panel pad stack" style={{ borderColor: 'var(--accent)' }}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px' }}><h2>Official training record</h2>
          <p className="small muted" style={{ marginTop: 4 }}>A statement on company letterhead for outside parties, for example to claim CPD/CPE points. It lists the training you completed or attended, with hours. Print it, then ask your compliance officer to sign and stamp it.</p></div>
        <button type="button" className="btn slim" onClick={onClose}>Close</button>
      </div>
      <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
        <label className="field" htmlFor="off-mode">Period
          <select id="off-mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="year">Calendar year</option><option value="custom">Custom dates</option><option value="all">All records</option>
          </select></label>
        {mode === 'year' && <label className="field" htmlFor="off-year">Year
          <select id="off-year" value={y} onChange={(e) => setY(e.target.value)}>{(years.length ? years : [thisYear]).map((x) => <option key={x}>{x}</option>)}</select></label>}
        {mode === 'custom' && <>
          <label className="field" htmlFor="off-from">From<input id="off-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field" htmlFor="off-to">To<input id="off-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </>}
        <button type="button" className="btn primary" disabled={mode === 'custom' && (!from || !to || to < from)} onClick={go}>Preview and print</button>
      </div>
      <p className="small muted">Failed attempts are not shown on this statement. They stay in your record here and in the company’s files.</p>
    </section>
  );
}

/** Printable copy of the signed-in staff member's own record. */
export function MyRecordPrint() {
  const { d, err } = useStaffData();
  const { company } = useCompany();
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
        <p className="small muted">{company.name}</p>
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
