import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { loadAdmin, type AdminData } from '../../lib/data';
import { fmt, fmtH, Ledger, todayMY } from '../../lib/logic';
import { ORG_NAME } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { filtered, periodLabel, sumH, type Filter } from './Records';

/** A clean page for printing or saving as PDF from the browser. */
export default function PrintLog() {
  const [params] = useSearchParams();
  const { profile } = useAuth();
  const [data, setData] = useState<AdminData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadAdmin().then(setData).catch((e) => setErr(e.message)); }, []);
  const f: Filter = { period: params.get('period') || 'all', from: params.get('from') || '', to: params.get('to') || '', mod: params.get('mod') || 'all' };
  const staffId = params.get('staff');
  const ledger = useMemo(() => (data ? new Ledger(data.modules, data.assignments, data.attempts, data.people) : null), [data]);

  if (err) return <div className="printpage"><div className="err">{err}</div></div>;
  if (!data || !ledger) return <div className="printpage muted">Preparing the training log…</div>;

  const people = ledger.staff().filter((s) => !staffId || s.id === staffId);
  const log = people.flatMap((s) => filtered(ledger, s.id, f).map((a) => ({ ...a, who: s })))
    .sort((a, b) => ((a.submitted_at || '') < (b.submitted_at || '') ? -1 : 1));
  const one = staffId ? people[0] : null;
  const label = periodLabel(f);
  const modTitle = f.mod !== 'all' ? ledger.mod(f.mod)?.title : null;

  return (
    <div className="printpage stack">
      <div className="row noprint">
        <Link className="btn" to="/admin/records">← Back</Link>
        <button type="button" className="btn primary" onClick={() => window.print()}>Print or save as PDF</button>
        <span className="small muted">In the print window, choose “Save as PDF” to keep a file.</span>
      </div>
      <header className="stack" style={{ gap: 4 }}>
        <p className="small muted">{ORG_NAME}</p>
        <h1>{one ? `Training record: ${one.full_name}` : 'Staff training log'}</h1>
        <p className="small">Period: <b>{label}</b>{modTitle ? <> · Module: <b>{modTitle}</b></> : null}</p>
        <p className="small muted">Generated {fmt(todayMY())} by {profile?.full_name}. Source: Training OS attempt records (scored by the system).</p>
      </header>

      {one && (
        <section className="panel pad small">
          <div className="grid-fields">
            <div><b>Username</b><br />{one.username}</div>
            <div><b>Job role</b><br />{one.job_role}</div>
            <div><b>Joined</b><br />{fmt(one.joined_on)}</div>
            <div><b>Status today</b><br />{ledger.staffStatus(one.id).label}</div>
          </div>
        </section>
      )}

      <section className="stack" style={{ gap: 8 }}>
        <h2>Summary</h2>
        <table>
          <thead><tr><th>Staff</th><th>Job role</th><th>Modules passed</th><th>Attempts</th><th>Training hours</th><th>Status today</th></tr></thead>
          <tbody>{people.map((s) => { const fa = filtered(ledger, s.id, f); return (
            <tr key={s.id}><td>{s.full_name}</td><td>{s.job_role}</td><td>{new Set(fa.filter((a) => a.passed).map((a) => a.module_id)).size}</td><td>{fa.length}</td><td>{fmtH(sumH(fa))}</td><td>{ledger.staffStatus(s.id).label}</td></tr>
          ); })}</tbody>
        </table>
        <p className="small">Total: {log.length} attempts, {log.filter((a) => a.passed).length} passed, {fmtH(sumH(log))} of training.</p>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <h2>Attempts</h2>
        {log.length ? (
          <table>
            <thead><tr><th>Date</th><th>Staff</th><th>Module</th><th>Version</th><th>Score</th><th>Result</th><th>Hours</th></tr></thead>
            <tbody>{log.map((a) => (
              <tr key={a.id}><td>{fmt(a.taken_on)}</td><td>{a.who.full_name}</td><td>{a.module_title}</td><td>{a.version_label}</td><td>{a.score}%</td><td>{a.passed ? 'Pass' : 'Fail'}</td><td>{fmtH(a.hours)}</td></tr>
            ))}</tbody>
          </table>
        ) : <p className="small muted">No attempts in this period.</p>}
      </section>
    </div>
  );
}
