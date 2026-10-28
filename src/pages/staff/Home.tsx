import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { loadStaff, type StaffData } from '../../lib/data';
import { fmt, fmtH, todayMY } from '../../lib/logic';
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
  const overdue = mods.filter((m) => L.isOverdue(me, m)).length;
  const todo = mods.length - ok;
  const first = d.me.full_name.split(' ')[0];
  const year = todayMY().slice(0, 4);
  const yearHours = L.history(me).filter((r) => r.taken_on.startsWith(year)).reduce((t, r) => t + r.hours, 0);
  const progressOf = (m: typeof mods[number]) => {
    const a = L.asg(me, m.id); const p = a && d.progress.find((x) => x.assignment_id === a.id);
    const n = d.versions.find((v) => v.module_id === m.id)?.page_count ?? 0;
    return p && n && !L.done(me, m) ? { at: Math.min(p.max_page, n), n } : null;
  };

  return (
    <>
      <section className="welcome">
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow">My training</p>
          <h1 style={{ marginTop: 4 }}>Welcome, {first}</h1>
          <p className="muted small" style={{ marginTop: 6 }}>{!mods.length ? 'No training is assigned to you right now.' : todo ? `You have ${todo} module${todo === 1 ? '' : 's'} to complete${overdue ? `, ${overdue} overdue` : ''}.` : 'You are up to date with all your training.'}</p>
        </div>
        {mods.length > 0 && (
          <div className="stats">
            <div className="stat"><b>{todo}</b><span>To complete</span></div>
            <div className={`stat ${overdue ? 'bad' : ''}`}><b>{overdue}</b><span>Overdue</span></div>
            <div className="stat ok"><b>{fmtH(yearHours)}</b><span>Training in {year}</span></div>
          </div>
        )}
      </section>
      {mods.length > 0 && <div className="sectionhead"><h2>Assigned to you</h2><span className="small muted">Sorted by due date</span></div>}
      {mods.length > 0 && (
        <div className="cardgrid">
          {mods.map((m) => { const st = cardState(d, m); const isDone = L.done(me, m); return (
            <Link key={m.id} className="card" to={`/learn/${m.id}`}>
              <div className="spread" style={{ alignItems: 'flex-start', width: '100%' }}><h2 style={{ flex: '1 1 160px' }}>{m.title}</h2>{st.pill}</div>
              <span className="small muted">{st.line}</span>
              {(() => { const pr = progressOf(m); return pr ? <div className="row" style={{ flexWrap: 'nowrap' }}><div className="bar6"><i style={{ width: `${(pr.at / pr.n) * 100}%` }} /></div><span className="mono small muted">{pr.at}/{pr.n}</span></div> : null; })()}
              <span className="go">{isDone ? 'Review material →' : progressOf(m) ? 'Continue →' : 'Start module →'}</span>
            </Link>
          ); })}
        </div>
      )}
      <div className="panel pad spread" style={{ alignItems: 'center' }}>
        <div><h3>Your training record</h3><p className="small muted" style={{ marginTop: 2 }}>Every training you’ve completed, with dates, scores and hours, including earlier classroom sessions.</p></div>
        <Link className="btn" to="/records">Open My records</Link>
      </div>
    </>
  );
}
