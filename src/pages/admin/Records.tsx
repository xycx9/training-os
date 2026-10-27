import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from '../../lib/data';
import { csvCell, downloadText, fmt, fmtH, todayMY, type Ledger } from '../../lib/logic';
import type { Attempt, Profile } from '../../lib/types';

export interface Filter { period: string; from: string; to: string; mod: string }

export function periodOpts(): [string, string][] {
  const y = Number(todayMY().slice(0, 4));
  return [['all', 'All time'], [String(y), `This year (${y})`], ...[1, 2, 3, 4].map((q) => [`${y}-Q${q}`, `Q${q} ${y}`] as [string, string]), [String(y - 1), String(y - 1)], ['custom', 'Custom range']];
}
export function periodRange(f: Filter): [string, string] | null {
  if (f.period === 'all') return null;
  if (f.period === 'custom') return [f.from || '0000-01-01', f.to || '9999-12-31'];
  const m = f.period.match(/^(\d{4})(?:-Q(\d))?$/);
  if (!m) return null;
  const y = Number(m[1]);
  if (!m[2]) return [`${y}-01-01`, `${y}-12-31`];
  const q = Number(m[2]), sm = (q - 1) * 3 + 1, em = q * 3;
  return [`${y}-${String(sm).padStart(2, '0')}-01`, `${y}-${String(em).padStart(2, '0')}-${new Date(y, em, 0).getDate()}`];
}
export function periodLabel(f: Filter) {
  if (f.period === 'custom') return `${f.from ? fmt(f.from) : 'the start'} to ${f.to ? fmt(f.to) : 'today'}`;
  const o = periodOpts().find((x) => x[0] === f.period);
  return o ? o[1] : f.period;
}
export function filtered(ledger: Ledger, sid: string, f: Filter): Attempt[] {
  const r = periodRange(f);
  return ledger.atts(sid).filter((a) => (!r || ((a.taken_on as string) >= r[0] && (a.taken_on as string) <= r[1])) && (f.mod === 'all' || a.module_id === f.mod));
}
export const sumH = (list: Attempt[]) => list.reduce((t, a) => t + (Number(a.hours) || 0), 0);
export const toQuery = (f: Filter, extra: Record<string, string> = {}) => new URLSearchParams({ ...f, ...extra }).toString();

export default function Records() {
  const { data, ledger } = useAdmin();
  const [f, setF] = useState<Filter>({ period: 'all', from: '', to: '', mod: 'all' });
  const [selId, setSelId] = useState<string | null>(null);
  if (!data || !ledger) return null;

  const staff = ledger.staff();
  const sel: Profile | undefined = staff.find((s) => s.id === selId) ?? staff[0];
  const label = periodLabel(f);
  const log = staff.flatMap((s) => filtered(ledger, s.id, f).map((a) => ({ ...a, who: s })))
    .sort((a, b) => ((a.submitted_at || '') < (b.submitted_at || '') ? 1 : -1));
  const passes = log.filter((a) => a.passed).length;
  const hist = sel ? filtered(ledger, sel.id, f).slice().reverse() : [];

  const exportCsv = () => {
    const head = ['Date', 'Staff', 'Username', 'Job role', 'Module', 'Version', 'Score %', 'Result', 'Training hours'];
    const rows = log.slice().reverse().map((a) => [a.taken_on, a.who.full_name, a.who.username, a.who.job_role, a.module_title, a.version_label, a.score, a.passed ? 'Pass' : 'Fail', a.passed ? a.hours : 0]);
    downloadText(`training-log-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`, [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n');
  };

  return (
    <>
      <div className="spread">
        <div><h1>Training records</h1><p className="muted small" style={{ marginTop: 4 }}>Evidence for BNM examinations and audits. Every attempt is kept, including fails.</p></div>
        <div className="row">
          <button type="button" className="btn" onClick={exportCsv} disabled={!log.length}>Export CSV</button>
          <Link className="btn primary" to={`/admin/records/print?${toQuery(f)}`}>Training log (print or PDF)</Link>
        </div>
      </div>

      <div className="panel pad row" style={{ alignItems: 'flex-end', gap: 14 }}>
        <label className="field" htmlFor="rec-period">Period
          <select id="rec-period" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>{periodOpts().map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {f.period === 'custom' && <>
          <label className="field" htmlFor="rec-from">From<input id="rec-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label className="field" htmlFor="rec-to">To<input id="rec-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        </>}
        <label className="field" htmlFor="rec-mod">Module
          <select id="rec-mod" value={f.mod} onChange={(e) => setF({ ...f, mod: e.target.value })}><option value="all">All modules</option>{data.modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
        {(f.period !== 'all' || f.mod !== 'all') && <button type="button" className="btn" onClick={() => setF({ period: 'all', from: '', to: '', mod: 'all' })}>Clear filters</button>}
      </div>
      <div className="row small">
        <b>{label}{f.mod !== 'all' ? ` · ${ledger.mod(f.mod)?.title}` : ''}</b>
        <span className="pill plain">{log.length} attempt{log.length === 1 ? '' : 's'}</span>
        <span className="pill ok">{passes} passed</span>
        <span className={`pill ${log.length - passes ? 'bad' : 'plain'}`}>{log.length - passes} failed</span>
        <span className="pill plain">{fmtH(sumH(log))} of training</span>
      </div>

      <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div className="stack" style={{ flex: '999 1 480px', minWidth: 0 }}>
          <div className="panel tablebox">
            <table>
              <thead><tr><th>Staff</th><th>Modules passed</th><th>Training hours</th><th>Attempts</th><th>Next due</th><th>Status today</th></tr></thead>
              <tbody>
                {staff.length === 0 && <tr><td colSpan={6} className="muted">No staff yet.</td></tr>}
                {staff.map((s) => {
                  const fa = filtered(ledger, s.id, f); const st = ledger.staffStatus(s.id);
                  return (
                    <tr key={s.id} className={`clickable ${sel?.id === s.id ? 'selected' : ''}`} onClick={() => setSelId(s.id)}>
                      <td><button type="button" className="link" onClick={() => setSelId(s.id)}>{s.full_name}</button><div className="small muted">{s.job_role}</div></td>
                      <td>{new Set(fa.filter((a) => a.passed).map((a) => a.module_id)).size}</td>
                      <td>{fmtH(sumH(fa))}</td>
                      <td>{fa.length}</td>
                      <td>{ledger.nextDue(s.id)}</td>
                      <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="panel">
            <div className="pad" style={{ paddingBottom: 0 }}><h2>Attempt log</h2><p className="small muted" style={{ marginTop: 4 }}>Every attempt in {label}, newest first. Hours are credited on a pass.</p></div>
            <div className="tablebox">
              {log.length ? (
                <table>
                  <thead><tr><th>Date</th><th>Staff</th><th>Module</th><th>Version</th><th>Score</th><th>Hours</th><th>Result</th></tr></thead>
                  <tbody>{log.map((a) => (
                    <tr key={a.id}><td>{fmt(a.taken_on)}</td><td>{a.who.full_name}</td><td>{a.module_title}</td><td className="mono">{a.version_label}</td><td>{a.score}%</td><td>{fmtH(a.hours)}</td>
                      <td>{a.passed ? <span className="pill ok">Pass</span> : <span className="pill bad">Fail</span>}</td></tr>
                  ))}</tbody>
                </table>
              ) : <p className="pad small muted">No attempts in this period.</p>}
            </div>
          </div>
        </div>

        {sel && (
          <aside className="panel pad stack" style={{ flex: '1 1 280px' }}>
            <div><h2>{sel.full_name}</h2><p className="small muted">{sel.job_role} · joined {fmt(sel.joined_on)}{sel.active ? '' : ' · deactivated'}</p></div>
            <div className="stack" style={{ gap: 8 }}>
              <h3>Assigned modules</h3>
              {ledger.assignedMods(sel.id).length ? ledger.assignedMods(sel.id).map((m) => {
                const a = ledger.asg(sel.id, m.id)!; const nr = ledger.nextRefresh(sel.id, m);
                return (
                  <div key={m.id} className="spread small" style={{ alignItems: 'center' }}>
                    <Link className="link" to={`/admin/modules/${m.id}`}>{m.title}</Link>
                    {ledger.done(sel.id, m) ? <span className="pill ok">Done{nr ? ` · next ${fmt(nr)}` : ''}</span>
                      : ledger.isOverdue(sel.id, m) ? <span className="pill bad">Overdue · {fmt(a.due_on)}</span>
                      : <span className="pill warn">{a.kind === 'initial' ? 'Due' : a.kind === 'refresher' ? 'Refresher due' : 'Retake due'} {fmt(a.due_on)}</span>}
                  </div>
                );
              }) : <p className="small muted">Nothing assigned.</p>}
            </div>
            <h3>Attempt history · {label}</h3>
            {hist.length ? (
              <div className="history">{hist.map((a) => (
                <div key={a.id}>
                  <div className="spread" style={{ alignItems: 'baseline' }}>
                    <b style={{ fontSize: 14 }}>{a.module_title} <span className="mono muted" style={{ fontWeight: 500 }}>{a.version_label}</span></b>
                    <span style={{ fontWeight: 600, color: a.passed ? 'var(--accent-soft-ink)' : 'var(--bad-ink)' }}>{a.score}% {a.passed ? 'Pass' : 'Fail'}</span>
                  </div>
                  <span className="small muted">{fmt(a.taken_on)}{a.passed ? ` · ${fmtH(a.hours)}` : ''}</span>
                </div>
              ))}</div>
            ) : <p className="small muted">No attempts in this period.</p>}
            <Link className="btn" to={`/admin/records/print?${toQuery(f, { staff: sel.id })}`}>Individual record (print or PDF)</Link>
          </aside>
        )}
      </div>
    </>
  );
}
