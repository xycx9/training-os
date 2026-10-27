import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { loadStaff, type StaffData } from '../../lib/data';
import { fmt, fmtH } from '../../lib/logic';
import type { Module } from '../../lib/types';

export function useStaffData() {
  const { profile } = useAuth();
  const [d, setD] = useState<StaffData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = async () => { if (!profile) return; try { setD(await loadStaff(profile)); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load your training'); } };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [profile?.id]);
  return { d, err, reload };
}

export function cardState(d: StaffData, m: Module) {
  const L = d.ledger; const me = d.me.id;
  const a = L.asg(me, m.id)!; const lp = L.lastPass(me, m.id); const fails = L.failsNow(me, m);
  if (L.done(me, m)) { const nr = L.nextRefresh(me, m); return { pill: <span className="pill ok">Passed {lp?.score}%</span>, line: `Completed ${fmt(lp?.taken_on)}${nr ? ` · next refresher ${fmt(nr)}` : ''}` }; }
  const due = ` · due ${fmt(a.due_on)}`;
  if (fails >= m.max_attempts) return { pill: <span className="pill bad">Locked</span>, line: `${m.max_attempts} failed attempts. Please see the compliance officer.` };
  const lead = L.isOverdue(me, m) ? <span className="pill bad">Overdue</span> : a.kind === 'refresher' ? <span className="pill warn">Refresher due</span> : a.kind === 'retake' ? <span className="pill warn">Updated, please retake</span> : null;
  if (fails > 0) return { pill: lead ?? <span className="pill bad">Retake needed</span>, line: `${m.max_attempts - fails} attempt${m.max_attempts - fails === 1 ? '' : 's'} left${due}` };
  const p = d.progress.find((x) => x.assignment_id === a.id);
  const cv = d.versions.find((v) => v.module_id === m.id);
  if (p) return { pill: lead ?? <span className="pill warn">In progress</span>, line: `Page ${p.max_page} of ${cv?.page_count ?? '—'}${due}` };
  return { pill: lead ?? <span className="pill plain">Not started</span>, line: `${fmtH(m.duration_hours)} session · ${m.per_attempt} questions${due}` };
}

export default function Home() {
  const { d, err, reload } = useStaffData();
  if (err) return <div className="panel pad stack"><div className="err">{err}</div><button type="button" className="btn" onClick={reload}>Try again</button></div>;
  if (!d) return <p className="muted">Loading…</p>;
  const L = d.ledger; const me = d.me.id;
  const mods = L.assignedMods(me).sort((x, y) => {
    const dx = L.done(me, x), dy = L.done(me, y);
    if (dx !== dy) return dx ? 1 : -1;
    return L.asg(me, x.id)!.due_on < L.asg(me, y.id)!.due_on ? -1 : 1;
  });
  const ok = mods.filter((m) => L.done(me, m)).length;

  return (
    <>
      <h1>My training</h1>
      {!mods.length ? <div className="panel pad muted">No training is assigned to you right now.</div> : <>
        <div className="panel pad stack" style={{ gap: 8 }}>
          <div className="spread" style={{ alignItems: 'center' }}><b>{ok} of {mods.length} done</b><span className="mono small muted">{Math.round((ok / mods.length) * 100)}%</span></div>
          <div className="progress"><i style={{ width: `${(ok / mods.length) * 100}%` }} /></div>
        </div>
        {mods.map((m) => { const st = cardState(d, m); return (
          <Link key={m.id} className="card" to={`/learn/${m.id}`}>
            <div className="spread" style={{ alignItems: 'flex-start', width: '100%' }}><h2 style={{ flex: '1 1 200px' }}>{m.title}</h2>{st.pill}</div>
            <span className="small muted">{st.line}</span>
          </Link>
        ); })}
      </>}
    </>
  );
}
