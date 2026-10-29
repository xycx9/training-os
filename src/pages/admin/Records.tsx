import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from '../../lib/data';
import { csvCell, downloadText, fmt, fmtH, resultLabel, todayMY, type HistRow, type Ledger } from '../../lib/logic';
import { errText, signedUrl, supabase } from '../../lib/supabase';
import { useToast } from '../../components/Toast';
import PastTrainingForm from './PastTrainingForm';
import type { Profile } from '../../lib/types';

export interface Filter { year: string; part: string; from: string; to: string; mod: string; staff: string; former: string }
export const blankFilter = (): Filter => ({ year: todayMY().slice(0, 4), part: 'full', from: '', to: '', mod: 'all', staff: 'all', former: '0' });
/** Staff shown in records: active people only, unless "Include former staff" is ticked. */
export const visibleStaff = (ledger: Ledger, f: Filter) => ledger.staff().filter((s) => s.active || f.former === '1');

/** Every year that has a record, plus the current year, newest first. */
export function yearOpts(ledger: Ledger): string[] {
  const ys = new Set<string>([todayMY().slice(0, 4)]);
  ledger.attempts.forEach((a) => { if (a.taken_on) ys.add(a.taken_on.slice(0, 4)); });
  ledger.past.forEach((p) => ys.add(p.completed_on.slice(0, 4)));
  return [...ys].sort().reverse();
}
export function periodRange(f: Filter): [string, string] | null {
  if (f.part === 'custom') return [f.from || '0000-01-01', f.to || '9999-12-31'];
  if (f.year === 'all') return null;
  const y = Number(f.year);
  if (f.part === 'full') return [`${y}-01-01`, `${y}-12-31`];
  const q = Number(f.part.replace('Q', '')), sm = (q - 1) * 3 + 1, em = q * 3;
  return [`${y}-${String(sm).padStart(2, '0')}-01`, `${y}-${String(em).padStart(2, '0')}-${new Date(y, em, 0).getDate()}`];
}
export function periodLabel(f: Filter) {
  if (f.part === 'custom') return `${f.from ? fmt(f.from) : 'the start'} to ${f.to ? fmt(f.to) : 'today'}`;
  if (f.year === 'all') return 'All years';
  if (f.part === 'full') return f.year;
  const q = Number(f.part.replace('Q', ''));
  const months = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'][q - 1];
  return `${f.part} ${f.year} (${months})`;
}
export function filtered(ledger: Ledger, sid: string, f: Filter): HistRow[] {
  const r = periodRange(f);
  return ledger.history(sid).filter((a) => (!r || (a.taken_on >= r[0] && a.taken_on <= r[1]))
    && (f.mod === 'all' || (f.mod === 'past' ? a.manual : a.module_id === f.mod)));
}
/** Count of distinct trainings completed (modules by id, recorded training by name). */
export const completedCount = (rows: HistRow[]) => new Set(rows.filter((a) => a.passed).map((a) => a.module_id ?? `t:${a.module_title.toLowerCase()}`)).size;
export const sourceText = (a: HistRow, nameOf: (id?: string | null) => string) =>
  a.manual ? `Recorded by ${nameOf(a.entered_by)} on ${fmt((a.entered_at || '').slice(0, 10))}` : 'System assessment';
export function readFilter(p: URLSearchParams): Filter {
  const d = blankFilter();
  return { year: p.get('year') || d.year, part: p.get('part') || d.part, from: p.get('from') || '', to: p.get('to') || '', mod: p.get('mod') || 'all', staff: p.get('staff') || 'all', former: p.get('former') === '1' ? '1' : '0' };
}
export const sumH = (list: HistRow[]) => list.reduce((t, a) => t + (Number(a.hours) || 0), 0);
export const toQuery = (f: Filter, extra: Record<string, string> = {}) => new URLSearchParams({ ...f, ...extra }).toString();

export default function Records() {
  const { data, ledger, reload } = useAdmin();
  const toast = useToast();
  const [f, setF] = useState<Filter>(blankFilter);
  const [selId, setSelId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (!data || !ledger) return null;
  const nameOf = (id?: string | null) => data.people.find((p) => p.id === id)?.full_name ?? 'admin';
  const openEvidence = async (path: string) => {
    try { window.open(await signedUrl(path, 'evidence'), '_blank', 'noopener'); } catch (e) { toast(errText(e), true); }
  };
  const removePast = async (a: HistRow & { who: Profile }) => {
    if (!window.confirm(`Remove the recorded training "${a.module_title}" on ${fmt(a.taken_on)} for ${a.who.full_name}? Use this only to correct a mistake.`)) return;
    const { error } = await supabase.from('past_training').delete().eq('id', a.id);
    if (error) { toast(error.message, true); return; }
    if (a.evidence_path) await supabase.storage.from('evidence').remove([a.evidence_path]);
    toast('Record removed'); await reload();
  };

  const allStaff = visibleStaff(ledger, f);
  const formerCount = ledger.staff().filter((s) => !s.active).length;
  const staff = f.staff === 'all' ? allStaff : allStaff.filter((s) => s.id === f.staff);
  const sel: Profile | undefined = staff.find((s) => s.id === selId) ?? staff[0];
  const isDefault = JSON.stringify(f) === JSON.stringify(blankFilter());
  const label = periodLabel(f);
  const log = staff.flatMap((s) => filtered(ledger, s.id, f).map((a) => ({ ...a, who: s })))
    .sort((a, b) => (a.taken_on === b.taken_on ? (a.submitted_at < b.submitted_at ? 1 : -1) : a.taken_on < b.taken_on ? 1 : -1));
  const passes = log.filter((a) => a.passed).length;
  const hist = sel ? filtered(ledger, sel.id, f).slice().reverse() : [];

  const exportCsv = () => {
    const head = ['Date', 'Staff', 'Username', 'Job role', 'Training', 'Version', 'Score %', 'Result', 'Training hours', 'Source', 'Delivered by', 'Notes'];
    const rows = log.slice().reverse().map((a) => [a.taken_on, a.who.full_name, a.who.username, a.who.job_role, a.module_title, a.manual ? '' : a.version_label, a.score ?? '', resultLabel(a), a.hours, sourceText(a, nameOf), a.delivered_by ?? '', a.notes ?? '']);
    downloadText(`training-log-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`, [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n');
  };

  return (
    <>
      <div className="spread">
        <div><h1>Training records</h1><p className="muted small" style={{ marginTop: 4 }}>Evidence for BNM examinations and audits. Every attempt is kept, including fails.</p></div>
        <div className="row">
          <Link className="btn" to="/admin/sessions/new">+ Record a past session</Link>
          {!adding && <button type="button" className="btn" onClick={() => setAdding(true)}>+ Single record</button>}
          <button type="button" className="btn" onClick={exportCsv} disabled={!log.length}>Export CSV</button>
          <Link className="btn primary" to={`/admin/records/print?${toQuery(f)}`}>Training log (print or PDF)</Link>
        </div>
      </div>

      {adding && <PastTrainingForm onClose={() => setAdding(false)} />}

      <div className="panel pad row" style={{ alignItems: 'flex-end', gap: 14 }}>
        <label className="field" htmlFor="rec-year">Year
          <select id="rec-year" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value, part: e.target.value === 'all' && f.part !== 'custom' ? 'full' : f.part })}>
            {yearOpts(ledger).map((y) => <option key={y} value={y}>{y}</option>)}
            <option value="all">All years</option>
          </select></label>
        <label className="field" htmlFor="rec-part">Period
          <select id="rec-part" value={f.part} onChange={(e) => setF({ ...f, part: e.target.value })}>
            <option value="full">{f.year === 'all' ? 'All dates' : 'Full year'}</option>
            {f.year !== 'all' && ['Q1', 'Q2', 'Q3', 'Q4'].map((q, i) => <option key={q} value={q}>{q} ({['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'][i]})</option>)}
            <option value="custom">Custom dates</option>
          </select></label>
        {f.part === 'custom' && <>
          <label className="field" htmlFor="rec-from">From<input id="rec-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label className="field" htmlFor="rec-to">To<input id="rec-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        </>}
        <label className="field" htmlFor="rec-mod">Module
          <select id="rec-mod" value={f.mod} onChange={(e) => setF({ ...f, mod: e.target.value })}><option value="all">All training</option>{data.modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}<option value="past">Recorded past training</option></select></label>
        <label className="field" htmlFor="rec-staff">Staff
          <select id="rec-staff" value={f.staff} onChange={(e) => { setF({ ...f, staff: e.target.value }); setSelId(e.target.value === 'all' ? null : e.target.value); }}>
            <option value="all">All staff</option>{allStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.active ? '' : ' (former staff)'}</option>)}
          </select></label>
        {formerCount > 0 && <label className="check small" htmlFor="rec-former" style={{ minHeight: 44, fontWeight: 600 }}>
          <input id="rec-former" type="checkbox" checked={f.former === '1'} onChange={(e) => {
            const on = e.target.checked; const gone = !on && f.staff !== 'all' && !ledger.staff().find((s) => s.id === f.staff)?.active;
            setF({ ...f, former: on ? '1' : '0', staff: gone ? 'all' : f.staff }); if (gone) setSelId(null);
          }} /> Include former staff ({formerCount})</label>}
        {!isDefault && <button type="button" className="btn" onClick={() => { setF(blankFilter()); setSelId(null); }}>Reset</button>}
      </div>
      <div className="row small">
        <b>{label}{f.mod === 'past' ? ' · Recorded past training' : f.mod !== 'all' ? ` · ${ledger.mod(f.mod)?.title}` : ''}{f.staff !== 'all' && staff[0] ? ` · ${staff[0].full_name}` : ''}</b>
        <span className="pill plain">{log.length} record{log.length === 1 ? '' : 's'}</span>
        <span className="pill ok">{passes} completed or passed</span>
        <span className={`pill ${log.length - passes ? 'bad' : 'plain'}`}>{log.length - passes} failed</span>
        <span className="pill plain">{fmtH(sumH(log))} of training</span>
      </div>

      <div className="stack" style={{ gap: 20 }}>
        <div className="stack" style={{ minWidth: 0 }}>
          <div className="panel tablebox">
            <table>
              <thead><tr><th>Staff</th><th>Trainings completed</th><th>Training hours</th><th>Records</th><th>Next due</th><th>Status today</th></tr></thead>
              <tbody>
                {staff.length === 0 && <tr><td colSpan={6} className="muted">No staff yet.</td></tr>}
                {staff.map((s) => {
                  const fa = filtered(ledger, s.id, f); const st = ledger.staffStatus(s.id);
                  return (
                    <tr key={s.id} className={`clickable ${sel?.id === s.id ? 'selected' : ''}`} onClick={() => setSelId(s.id)}>
                      <td><button type="button" className="link" onClick={() => setSelId(s.id)}>{s.full_name}</button><div className="small muted">{s.job_role}</div></td>
                      <td>{completedCount(fa)}</td>
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
          {sel && (
            <aside className="panel pad stack">
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
              <h3>Training history · {label}</h3>
              {hist.length ? (
                <div className="history">{hist.map((a) => (
                  <div key={a.id}>
                    <div className="spread" style={{ alignItems: 'baseline' }}>
                      <b style={{ fontSize: 14 }}>{a.module_title} <span className="mono muted" style={{ fontWeight: 500 }}>{a.manual ? '' : a.version_label}</span></b>
                      <span style={{ fontWeight: 600, color: a.passed ? 'var(--ok-ink)' : 'var(--bad-ink)' }}>{a.score != null ? `${a.score}% ` : ''}{resultLabel(a)}</span>
                    </div>
                    <span className="small muted">{fmt(a.taken_on)}{a.passed ? ` · ${fmtH(a.hours)}` : ''}{a.manual ? ' · Recorded' : ''}</span>
                  </div>
                ))}</div>
              ) : <p className="small muted">No training records in this period.</p>}
              <Link className="btn" to={`/admin/records/print?${toQuery(f, { staff: sel.id })}`}>Individual record (print or PDF)</Link>
            </aside>
          )}
          <LogPanel log={log} label={label} nameOf={nameOf} openEvidence={openEvidence} removePast={removePast} />
        </div>

      </div>
    </>
  );
}

type LogRow = HistRow & { who: Profile };
const PAGE = 25;

function RowCells({ a, nameOf, openEvidence, removePast, showStaff = true }: { a: LogRow; nameOf: (id?: string | null) => string; openEvidence: (p: string) => void; removePast: (a: LogRow) => void; showStaff?: boolean }) {
  return (
    <>
      <td style={{ whiteSpace: 'nowrap' }}>{fmt(a.taken_on)}</td>
      {showStaff && <td>{a.who.full_name}</td>}
      <td>{a.session_id ? <Link className="link" to={`/admin/sessions/${a.session_id}`}>{a.module_title}</Link> : a.module_title}{a.manual && (a.delivered_by || a.notes) ? <div className="small muted">{[a.delivered_by, a.notes].filter(Boolean).join(' · ')}</div> : null}</td>
      <td>{a.manual ? <><span className="pill plain">Recorded</span><div className="small muted">by {nameOf(a.entered_by)}, {fmt((a.entered_at || '').slice(0, 10))}</div>
          <div className="row small" style={{ gap: 10, marginTop: 2 }}>{a.session_id ? <Link className="link" to={`/admin/sessions/${a.session_id}`}>Session</Link> : <>{a.evidence_path && <button type="button" className="link" onClick={() => openEvidence(a.evidence_path!)}>Evidence</button>}<button type="button" className="link" style={{ color: 'var(--bad-ink)' }} onClick={() => removePast(a)}>Remove</button></>}</div></>
        : <span className="mono small">System · {a.version_label}</span>}</td>
      <td>{a.score != null ? `${a.score}%` : '—'}</td><td>{fmtH(a.hours)}</td>
      <td>{a.result === 'fail' ? <span className="pill bad">Fail</span> : <span className="pill ok">{resultLabel(a)}</span>}</td>
    </>
  );
}

function Pager({ page, pages, total, setPage }: { page: number; pages: number; total: number; setPage: (n: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="spread pad" style={{ alignItems: 'center', paddingTop: 12 }}>
      <span className="small muted">Showing {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total}</span>
      <div className="row">
        <button type="button" className="btn slim" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="small mono">{page} / {pages}</span>
        <button type="button" className="btn slim" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

/** Training log with a grouped Summary view (default) and the Full log, searchable and in pages of 25. */
function LogPanel({ log, label, nameOf, openEvidence, removePast }: { log: LogRow[]; label: string; nameOf: (id?: string | null) => string; openEvidence: (p: string) => void; removePast: (a: LogRow) => void }) {
  const [view, setView] = useState<'summary' | 'full'>('summary');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const needle = q.trim().toLowerCase();
  const rows = needle ? log.filter((a) => `${a.who.full_name} ${a.module_title}`.toLowerCase().includes(needle)) : log;

  const groups = useMemo(() => {
    const m = new Map<string, LogRow[]>();
    rows.forEach((a) => { const k = `${a.staff_id}|${a.module_id ?? 't:' + a.module_title.toLowerCase()}`; m.set(k, [...(m.get(k) ?? []), a]); });
    return [...m.entries()].map(([k, rs]) => {
      const best = rs.filter((x) => x.passed).sort((x, y) => (y.score ?? 101) - (x.score ?? 101))[0];
      return { k, rs, latest: rs[0], best, hours: rs.reduce((t, x) => t + (Number(x.hours) || 0), 0) };
    }).sort((x, y) => (x.latest.taken_on < y.latest.taken_on ? 1 : -1));
  }, [rows]);

  const total = view === 'summary' ? groups.length : rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const cur = Math.min(page, pages);
  const slice = <T,>(arr: T[]) => arr.slice((cur - 1) * PAGE, cur * PAGE);

  return (
    <div className="panel">
      <div className="pad stack" style={{ paddingBottom: 0, gap: 12 }}>
        <div className="spread" style={{ alignItems: 'center' }}>
          <div><h2>Training log</h2><p className="small muted" style={{ marginTop: 4 }}>{view === 'summary' ? `One line per person per training in ${label}. Click a line to see every attempt.` : `Every record in ${label}, newest first.`} “Recorded” entries were entered by an admin for training outside the system.</p></div>
          <label className="field" htmlFor="log-q" style={{ minWidth: 220 }}><span className="small">Search</span><input id="log-q" type="search" placeholder="Staff or training" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        </div>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'summary'} onClick={() => { setView('summary'); setPage(1); }}>Summary ({groups.length})</button>
          <button type="button" role="tab" aria-selected={view === 'full'} onClick={() => { setView('full'); setPage(1); }}>Full log ({rows.length})</button>
        </div>
      </div>
      <div className="tablebox">
        {!rows.length ? <p className="pad small muted">{needle ? 'Nothing matches your search.' : 'No training records in this period.'}</p> : view === 'full' ? (
          <table>
            <thead><tr><th>Date</th><th>Staff</th><th>Training</th><th>Source</th><th>Score</th><th>Hours</th><th>Result</th></tr></thead>
            <tbody>{slice(rows).map((a) => <tr key={a.id}><RowCells a={a} nameOf={nameOf} openEvidence={openEvidence} removePast={removePast} /></tr>)}</tbody>
          </table>
        ) : (
          <table>
            <thead><tr><th>Staff</th><th>Training</th><th>Latest</th><th>Result</th><th>Records</th><th>Hours</th><th aria-label="Expand" /></tr></thead>
            <tbody>{slice(groups).map((g) => {
              const isOpen = !!open[g.k];
              return (
                <Fragment key={g.k}>
                  <tr className="clickable" onClick={() => setOpen({ ...open, [g.k]: !isOpen })} aria-expanded={isOpen}>
                    <td><b>{g.latest.who.full_name}</b><div className="small muted">{g.latest.who.job_role}</div></td>
                    <td>{g.latest.module_title}{g.rs.some((x) => x.manual) && <div className="small muted">Includes recorded training</div>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(g.latest.taken_on)}</td>
                    <td>{g.best ? <span className="pill ok">{g.best.result === 'completed' ? 'Completed' : 'Passed'}{g.best.score != null ? ` ${g.best.score}%` : ''}</span> : <span className="pill bad">Not passed</span>}</td>
                    <td>{g.rs.length}</td>
                    <td>{fmtH(g.hours)}</td>
                    <td><button type="button" className="link small" onClick={(e) => { e.stopPropagation(); setOpen({ ...open, [g.k]: !isOpen }); }}>{isOpen ? 'Hide' : 'Show'}</button></td>
                  </tr>
                  {isOpen && (
                    <tr><td colSpan={7} style={{ background: 'var(--surface-2)', padding: '8px 16px 14px' }}>
                      <table style={{ minWidth: 0 }}>
                        <thead><tr><th>Date</th><th>Training</th><th>Source</th><th>Score</th><th>Hours</th><th>Result</th></tr></thead>
                        <tbody>{g.rs.map((a) => <tr key={a.id}><RowCells a={a} nameOf={nameOf} openEvidence={openEvidence} removePast={removePast} showStaff={false} /></tr>)}</tbody>
                      </table>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}</tbody>
          </table>
        )}
      </div>
      <Pager page={cur} pages={pages} total={total} setPage={setPage} />
    </div>
  );
}
