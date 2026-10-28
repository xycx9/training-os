import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { loadAdmin, type AdminData } from '../../lib/data';
import { fmt, fmtH, Ledger, resultLabel, todayMY } from '../../lib/logic';
import { APP_NAME, ORG_NAME } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { completedCount, filtered, periodLabel, readFilter, sourceText, sumH } from './Records';

/** A clean page for printing or saving as PDF from the browser. */
export default function PrintLog() {
  const [params] = useSearchParams();
  const { profile } = useAuth();
  const [data, setData] = useState<AdminData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadAdmin().then(setData).catch((e) => setErr(e.message)); }, []);
  const f = readFilter(params);
  const staffId = f.staff !== 'all' ? f.staff : null;
  const ledger = useMemo(() => (data ? new Ledger(data.modules, data.assignments, data.attempts, data.people, data.past) : null), [data]);

  if (err) return <div className="printpage"><div className="err">{err}</div></div>;
  if (!data || !ledger) return <div className="printpage muted">Preparing the training log…</div>;

  const people = ledger.staff().filter((s) => !staffId || s.id === staffId);
  const log = people.flatMap((s) => filtered(ledger, s.id, f).map((a) => ({ ...a, who: s })))
    .sort((a, b) => (a.taken_on === b.taken_on ? (a.submitted_at < b.submitted_at ? -1 : 1) : a.taken_on < b.taken_on ? -1 : 1));
  const nameOf = (id?: string | null) => data.people.find((p) => p.id === id)?.full_name ?? 'admin';
  const recorded = log.filter((a) => a.manual).length;
  const one = staffId ? people[0] : null;
  const label = periodLabel(f);
  const modTitle = f.mod === 'past' ? 'Recorded past training' : f.mod !== 'all' ? ledger.mod(f.mod)?.title : null;

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
        <p className="small">Period: <b>{label}</b>{modTitle ? <> · Training: <b>{modTitle}</b></> : null}</p>
        <p className="small muted">Generated {fmt(todayMY())} by {profile?.full_name}. Source: {APP_NAME}. “System assessment” rows were scored by the system; “Recorded” rows were entered by an administrator for training delivered outside the system, showing who entered them and when.</p>
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
          <thead><tr><th>Staff</th><th>Job role</th><th>Trainings completed</th><th>Records</th><th>Training hours</th><th>Status today</th></tr></thead>
          <tbody>{people.map((s) => { const fa = filtered(ledger, s.id, f); return (
            <tr key={s.id}><td>{s.full_name}</td><td>{s.job_role}</td><td>{completedCount(fa)}</td><td>{fa.length}</td><td>{fmtH(sumH(fa))}</td><td>{ledger.staffStatus(s.id).label}</td></tr>
          ); })}</tbody>
        </table>
        <p className="small">Total: {log.length} records ({log.length - recorded} system assessments, {recorded} recorded), {log.filter((a) => a.passed).length} completed or passed, {fmtH(sumH(log))} of training.</p>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <h2>Training log</h2>
        {log.length ? (
          <table>
            <thead><tr><th>Date</th><th>Staff</th><th>Training</th><th>Version</th><th>Score</th><th>Result</th><th>Hours</th><th>Source</th></tr></thead>
            <tbody>{log.map((a) => (
              <tr key={a.id}><td>{fmt(a.taken_on)}</td><td>{a.who.full_name}</td>
                <td>{a.module_title}{a.manual && (a.delivered_by || a.notes) ? <div className="small muted">{[a.delivered_by, a.notes].filter(Boolean).join(' · ')}</div> : null}</td>
                <td>{a.manual ? '—' : a.version_label}</td><td>{a.score != null ? `${a.score}%` : '—'}</td><td>{resultLabel(a)}</td><td>{fmtH(a.hours)}</td>
                <td>{sourceText(a, nameOf)}{a.manual && a.evidence_name ? `; evidence: ${a.evidence_name}` : ''}</td></tr>
            ))}</tbody>
          </table>
        ) : <p className="small muted">No training records in this period.</p>}
      </section>
    </div>
  );
}
