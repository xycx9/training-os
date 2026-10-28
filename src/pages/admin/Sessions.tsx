import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAdmin } from '../../lib/data';
import { fmt, fmtH } from '../../lib/logic';
import { errText, rpc, supabase } from '../../lib/supabase';
import { useCompany } from '../../lib/company';
import type { SessionFile } from '../../lib/types';
import { FileList, viewFile } from '../../components/Files';
import { useToast } from '../../components/Toast';

/** All recorded past sessions, newest first. */
export default function Sessions() {
  const { data } = useAdmin();
  if (!data) return null;
  const rows = data.sessions.slice().sort((a, b) => (a.held_on < b.held_on ? 1 : -1));
  const people = (id: string) => data.past.filter((p) => p.session_id === id);
  return (
    <>
      <div className="spread">
        <div><h1>Past sessions</h1><p className="muted small" style={{ marginTop: 4, maxWidth: 720 }}>Classroom sessions and briefings held before this system or outside it, with the slides used, the evidence and each attendee’s result. Every attendee’s result also appears in Training records.</p></div>
        <Link className="btn primary" to="/admin/sessions/new">+ Record a session</Link>
      </div>
      <div className="panel tablebox">
        <table>
          <thead><tr><th>Date held</th><th>Training</th><th>Delivered by</th><th>Attendees</th><th>Results</th><th>Hours</th></tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={6} className="muted">No sessions recorded yet. Use “Record a session” to add a past classroom session with its slides and results.</td></tr>}
            {rows.map((s) => {
              const ps = people(s.id); const pass = ps.filter((p) => p.result === 'pass').length; const fail = ps.filter((p) => p.result === 'fail').length;
              return (
                <tr key={s.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmt(s.held_on)}</td>
                  <td><Link className="link" to={`/admin/sessions/${s.id}`}>{s.title}</Link></td>
                  <td>{s.delivered_by || '—'}</td>
                  <td>{ps.length}</td>
                  <td>{s.assessed ? <span className="row small" style={{ gap: 6 }}><span className="pill ok">{pass} pass</span>{fail > 0 && <span className="pill bad">{fail} fail</span>}</span> : <span className="pill plain">Attendance only</span>}</td>
                  <td>{fmtH(s.hours)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** One recorded session: details, attendees and results, materials and evidence. Printable. */
export function SessionDetail() {
  const { id } = useParams();
  const { data, reload } = useAdmin();
  const toast = useToast();
  const nav = useNavigate();
  const [files, setFiles] = useState<SessionFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { company } = useCompany();
  useEffect(() => {
    if (!id) return;
    supabase.from('session_files').select('*').eq('session_id', id).order('file_name')
      .then(({ data: rows, error }) => { if (error) toast(error.message, true); setFiles((rows as SessionFile[] | null) ?? []); });
  }, [id, toast]);
  if (!data) return null;
  const s = data.sessions.find((x) => x.id === id);
  if (!s) return <div className="panel pad">Session not found. <Link className="link" to="/admin/sessions">Back to past sessions</Link></div>;

  const person = (sid: string) => data.people.find((p) => p.id === sid);
  const nameOf = (uid: string | null) => person(uid ?? '')?.full_name ?? 'admin';
  const rows = data.past.filter((p) => p.session_id === s.id).sort((a, b) => (person(a.staff_id)?.full_name ?? '').localeCompare(person(b.staff_id)?.full_name ?? ''));
  const pass = rows.filter((r) => r.result === 'pass').length; const fail = rows.filter((r) => r.result === 'fail').length;
  const scored = rows.filter((r) => r.score != null);
  const avg = scored.length ? Math.round(scored.reduce((t, r) => t + (r.score ?? 0), 0) / scored.length) : null;
  const materials = files?.filter((f) => f.kind === 'material') ?? [];
  const evidence = files?.filter((f) => f.kind === 'evidence') ?? [];

  const remove = async () => {
    if (!window.confirm(`Remove the session “${s.title}” on ${fmt(s.held_on)}? This deletes its ${rows.length} training record${rows.length === 1 ? '' : 's'} and all its files. Use this only to correct a mistake; you can then record it again.`)) return;
    setBusy(true);
    try {
      const out = await rpc<{ files: { kind: string; path: string }[]; papers: string[] }>('delete_session', { p_session: s.id });
      const r = out.files.filter((f) => f.kind === 'material').map((f) => f.path);
      const e = out.files.filter((f) => f.kind === 'evidence').map((f) => f.path).concat(out.papers);
      if (r.length) await supabase.storage.from('readings').remove(r);
      if (e.length) await supabase.storage.from('evidence').remove(e);
      await reload();
      toast('Session removed');
      nav('/admin/sessions');
    } catch (err) { toast(errText(err), true); setBusy(false); }
  };

  return (
    <div className="stack sessionpage">
      <div className="noprint"><Link className="link small" to="/admin/sessions">← Past sessions</Link></div>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 360px' }}>
          <p className="small muted printonly">{company.name} · Record of training session</p>
          <h1>{s.title}</h1>
          <p className="muted small" style={{ marginTop: 4 }}>{fmt(s.held_on)} · {fmtH(s.hours)}{s.delivered_by ? ` · delivered by ${s.delivered_by}` : ''} · {s.assessed ? `assessed${s.pass_mark != null ? `, pass mark ${s.pass_mark}%` : ''}` : 'attendance only'}</p>
          <p className="small muted" style={{ marginTop: 2 }}><span className="pill plain">Recorded</span> by {nameOf(s.entered_by)} on {fmt(s.entered_at.slice(0, 10))}</p>
        </div>
        <div className="row noprint">
          <button type="button" className="btn" onClick={() => window.print()}>Print session record</button>
          <button type="button" className="btn danger" disabled={busy} onClick={remove}>{busy ? 'Removing…' : 'Remove session'}</button>
        </div>
      </div>
      {s.notes && <div className="note">{s.notes}</div>}

      <div className="stats">
        <div className="stat"><b>{rows.length}</b><span>Attendees</span></div>
        {s.assessed && <div className="stat ok"><b>{pass}</b><span>Passed</span></div>}
        {s.assessed && <div className={`stat ${fail ? 'bad' : ''}`}><b>{fail}</b><span>Failed</span></div>}
        {avg != null && <div className="stat"><b>{avg}%</b><span>Average score</span></div>}
      </div>

      <section className="panel tablebox">
        <table>
          <thead><tr><th>Staff</th><th>Job role</th><th>Result</th>{s.assessed && <th>Score</th>}<th>Hours credited</th>{s.assessed && <th className="noprint">Marked paper</th>}</tr></thead>
          <tbody>{rows.map((r) => { const p = person(r.staff_id); return (
            <tr key={r.id}>
              <td><b>{p?.full_name ?? '—'}</b><div className="small muted mono">{p?.username}</div></td>
              <td>{p?.job_role ?? '—'}</td>
              <td>{r.result === 'fail' ? <span className="pill bad">Fail</span> : <span className="pill ok">{r.result === 'pass' ? 'Pass' : 'Attended'}</span>}</td>
              {s.assessed && <td>{r.score != null ? `${r.score}%` : '—'}</td>}
              <td>{fmtH(r.result === 'fail' ? 0 : r.hours)}</td>
              {s.assessed && <td className="noprint">{r.evidence_path ? <button type="button" className="link" onClick={() => viewFile('evidence', r.evidence_path!).catch((e) => toast(errText(e), true))}>View</button> : <span className="muted">—</span>}</td>}
            </tr>
          ); })}</tbody>
        </table>
      </section>
      {s.assessed && <p className="small muted">A failed result is kept on the record but no training hours are credited for it.</p>}

      <div className="row" style={{ alignItems: 'stretch', gap: 16 }}>
        <section className="panel pad stack" style={{ flex: '1 1 340px' }}>
          <div><h2>Slides and training materials</h2><p className="small muted" style={{ marginTop: 2 }}>Attendees can download these from My records.</p></div>
          {files === null ? <p className="small muted">Loading…</p> : <FileList files={materials} bucket="readings" empty="No materials were added." />}
        </section>
        <section className="panel pad stack" style={{ flex: '1 1 340px' }}>
          <div><h2>Evidence <span className="pill plain">Admins only</span></h2><p className="small muted" style={{ marginTop: 2 }}>Attendance sheet, question paper and answer key.</p></div>
          {files === null ? <p className="small muted">Loading…</p> : <FileList files={evidence} bucket="evidence" view empty="No evidence was added." />}
        </section>
      </div>
      <p className="small muted noprint">A recorded session can’t be edited. If something is wrong, remove it and record it again.</p>
    </div>
  );
}
