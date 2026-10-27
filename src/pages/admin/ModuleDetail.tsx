import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAdmin } from '../../lib/data';
import { addDays, cycleLabel, fmt, fmtH, kindLabel } from '../../lib/logic';
import { errText, rpc, signedUrl, supabase } from '../../lib/supabase';
import type { Module, Question } from '../../lib/types';
import { PdfViewer } from '../../components/PdfViewer';
import { useToast } from '../../components/Toast';
import { statusPill } from './Modules';

const L = 'ABCD';
type Tab = 'material' | 'assign' | 'questions' | 'results' | 'versions';

export function QuestionView({ q, i, actions }: { q: Question; i: number; actions?: ReactNode }) {
  return (
    <div className={`q ${q.approved ? '' : 'pending'}`}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <h3 style={{ flex: '1 1 300px' }}>Q{i + 1}. {q.prompt}</h3>
        {q.approved ? <span className="pill ok">Approved</span> : <span className="pill warn">To review</span>}
      </div>
      <div className="opts">{q.options.map((o, k) => <div key={k} className={k === q.correct ? 'right' : ''}>{L[k]}. {o}{k === q.correct ? ' ✓' : ''}</div>)}</div>
      <div className="small muted">Source: page {q.source_page}</div>
      {actions}
    </div>
  );
}

export default function ModuleDetail() {
  const { id } = useParams();
  const { data, ledger, reload, currentVersion } = useAdmin();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('material');
  const [page, setPage] = useState(1);
  const [questions, setQuestions] = useState<(Question & { id: string })[] | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const m = data?.modules.find((x) => x.id === id);
  const cv = m ? currentVersion(m.id) : undefined;

  const loadQuestions = async () => {
    if (!cv) return;
    const { data: qs, error } = await supabase.from('questions').select('*').eq('version_id', cv.id).order('position');
    if (error) toast(error.message, true); else setQuestions(qs as (Question & { id: string })[]);
  };
  useEffect(() => { setQuestions(null); loadQuestions(); /* eslint-disable-next-line */ }, [cv?.id]);
  useEffect(() => {
    setUrl(null);
    if (cv?.file_path) signedUrl(cv.file_path).then(setUrl).catch((e) => toast(errText(e), true));
  }, [cv?.file_path, toast]);

  if (!data || !ledger) return null;
  if (!m || !cv) return <div className="panel pad">Module not found. <Link className="link" to="/admin">Back to modules</Link></div>;

  const pending = questions?.filter((q) => !q.approved).length ?? 0;
  const approved = questions?.filter((q) => q.approved).length ?? 0;
  const canPublish = m.status !== 'published' && questions !== null && pending === 0 && approved >= m.per_attempt;
  const nameOf = (uid: string | null) => data.people.find((p) => p.id === uid)?.full_name ?? '—';
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); await reload(); }
    catch (e) { toast(errText(e), true); }
    finally { setBusy(false); }
  };

  const tabs: [Tab, string][] = [
    ['material', 'Material'], ['assign', `Assigned (${ledger.assignees(m).length})`], ['questions', `Question bank (${questions?.length ?? '…'})`],
    ['results', 'Results'], ['versions', `Versions (${data.versions.filter((v) => v.module_id === m.id).length})`],
  ];

  return (
    <>
      <div><Link className="link small" to="/admin">← Modules</Link></div>
      <div className="spread">
        <div>
          <h1>{m.title}</h1>
          <p className="muted small" style={{ marginTop: 4 }}>
            <span className="mono">{cv.label}</span> · {fmtH(m.duration_hours)} session · {cycleLabel(m)} · {cv.published_on ? `Published by ${nameOf(cv.published_by)} on ${fmt(cv.published_on)}` : 'Not yet published'}
          </p>
        </div>
        <div className="row">
          {statusPill(m, pending)}
          <Link className="btn" to={`/admin/modules/${m.id}/edit`}>Edit module</Link>
          {m.status !== 'published' && (
            <button type="button" className="btn primary" disabled={!canPublish || busy}
              onClick={() => run(() => rpc('publish_module', { p_module: m.id }), `${m.title} published. Assign staff in the Assigned tab.`)}>
              {pending ? `Publish (${pending} to review)` : approved < m.per_attempt ? `Publish (needs ${m.per_attempt} questions)` : 'Publish'}
            </button>
          )}
        </div>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'material' && (
        <div className="viewer">
          <div className="pagelist" aria-label="Pages">
            {Array.from({ length: cv.page_count ?? 0 }, (_, i) => (
              <button key={i} type="button" aria-current={page === i + 1} onClick={() => setPage(i + 1)}>{i + 1}</button>
            ))}
          </div>
          <div className="stage">
            <PdfViewer src={url} page={page} />
            <div className="spread" style={{ alignItems: 'center' }}>
              <div className="row">
                <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <button type="button" className="btn" disabled={page >= (cv.page_count ?? 1)} onClick={() => setPage(page + 1)}>Next</button>
              </div>
              <span className="mono small muted">Page {page} / {cv.page_count ?? '—'} · {cv.file_name}</span>
            </div>
            <div className="panel pad small"><b>{questions?.filter((q) => q.source_page === page).length ?? 0} questions</b> in the bank cite this page as their source.</div>
          </div>
        </div>
      )}

      {tab === 'assign' && <AssignTab m={m} busy={busy} run={run} />}

      {tab === 'questions' && (
        <div className="stack">
          <div className="row small">
            <span className="pill ok">{approved} approved</span>{pending > 0 && <span className="pill warn">{pending} to review</span>}
            <span className="muted">Each attempt draws {m.per_attempt} at random · pass mark {m.pass_mark}%</span>
          </div>
          <p className="small muted">To change or add questions, use Edit module, so the change is versioned.</p>
          {questions?.map((q, i) => (
            <QuestionView key={q.id} q={q} i={i} actions={m.status !== 'published' && !q.approved ? (
              <div className="row">
                <button type="button" className="btn primary" disabled={busy} onClick={() => run(async () => {
                  const { error } = await supabase.from('questions').update({ approved: true }).eq('id', q.id); if (error) throw error; await loadQuestions();
                }, 'Question approved')}>Approve</button>
                <button type="button" className="btn danger" disabled={busy} onClick={() => run(async () => {
                  const { error } = await supabase.from('questions').delete().eq('id', q.id); if (error) throw error; await loadQuestions();
                }, 'Question removed')}>Remove</button>
              </div>
            ) : undefined} />
          ))}
        </div>
      )}

      {tab === 'results' && <ResultsTab m={m} />}

      {tab === 'versions' && (
        <>
          <div className="panel pad history">
            {data.versions.filter((v) => v.module_id === m.id).slice().reverse().map((v) => (
              <div key={v.id}>
                <div className="row"><b className="mono">{v.label}</b>{v.is_current && <span className="pill ok">Current</span>}<span className="small muted">{v.file_name} · {v.page_count} pages</span></div>
                {data.logs.filter((l) => l.version_id === v.id).map((l) => (
                  <span key={l.id} className="small muted">{fmt(l.at.slice(0, 10))} · {l.kind === 'correction' ? 'Correction' : l.kind === 'archived' ? 'Archived' : l.kind === 'published' ? 'Published' : 'Created'}{l.note ? `: ${l.note}` : ''} · {nameOf(l.by_user)}</span>
                ))}
              </div>
            ))}
          </div>
          <p className="small muted">A new version keeps its own PDF and question bank. Past results stay linked to the version that was taken. Corrections keep the version number and are logged here.</p>
        </>
      )}
    </>
  );
}

function AssignTab({ m, busy, run }: { m: Module; busy: boolean; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const { data, ledger } = useAdmin();
  const [dueDays, setDueDays] = useState(String(m.due_days));
  const y = useMemo(() => { const t = new Date(); return t.getFullYear() + (t.getMonth() >= 9 ? 1 : 0); }, []);
  const [open, setOpen] = useState(`${y}-01-02`);
  const [due, setDue] = useState(`${y}-03-31`);
  if (!data || !ledger) return null;
  const staff = ledger.staff().filter((s) => s.active);
  const roles = [...new Set(staff.map((s) => s.job_role))];
  const everAssigned = staff.filter((s) => ledger.allAsg(s.id, m.id).length);
  const rounds = new Map<string, number>();
  ledger.scheduled(m.id).forEach((a) => { const k = `${a.assigned_on}|${a.due_on}`; rounds.set(k, (rounds.get(k) ?? 0) + 1); });
  const assign = (ids: string[]) => run(async () => {
    const n = await rpc<number>('assign_staff', { p_module: m.id, p_staff: ids });
    if (!n) throw new Error('Everyone selected is already assigned');
  }, `Assigned, due ${fmt(addDays(ledger.today, m.due_days))}`);

  return (
    <div className="stack">
      {m.cycle === 'none' && <div className="note">One-off module. Staff complete it once; there is no refresher. You can change this with Edit module.</div>}
      {m.cycle === 'rolling' && <div className="note"><b>Refresher every {m.refresher_months} months.</b> Each person’s refresher opens 30 days before the anniversary of their last pass and is due on that date. It is assigned automatically.</div>}
      {m.cycle === 'fixed' && (
        <div className="panel pad stack">
          <div><h2>Yearly refresher round</h2><p className="small muted" style={{ marginTop: 4 }}>Everyone assigned to this module redoes it once a year by the same deadline. Schedule the round in advance; staff see it from the opening date.</p></div>
          {[...rounds.entries()].map(([k, n]) => { const [o, d] = k.split('|'); return <div key={k} className="row small"><span className="pill warn">Scheduled</span> Opens {fmt(o)} · due {fmt(d)} · {n} staff</div>; })}
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field" htmlFor="rr-open">Opens on<input id="rr-open" type="date" value={open} onChange={(e) => setOpen(e.target.value)} /></label>
            <label className="field" htmlFor="rr-due">Due by<input id="rr-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            <button type="button" className="btn primary" disabled={busy || !everAssigned.length || m.status !== 'published'}
              onClick={() => run(async () => {
                if (!open || !due || due < open) throw new Error('Choose an opening date and a later due date');
                const n = await rpc<number>('assign_staff', { p_module: m.id, p_staff: everAssigned.map((s) => s.id), p_kind: 'refresher', p_open: open, p_due: due });
                if (!n) throw new Error('That round is already scheduled');
              }, 'Refresher round scheduled')}>Schedule round for {everAssigned.length} staff</button>
          </div>
        </div>
      )}

      <div className="panel pad stack">
        <div className="spread">
          <div style={{ flex: '1 1 300px' }}><h2>Who must complete this module</h2><p className="small muted" style={{ marginTop: 4 }}>Assigned staff see it under My training with a due date.{m.status !== 'published' && ' They will see it once it is published.'}</p></div>
          <label className="field" htmlFor="m-due" style={{ width: 200 }}>Complete within (days)
            <input id="m-due" type="number" min={1} max={365} value={dueDays} onChange={(e) => setDueDays(e.target.value)}
              onBlur={() => { const n = Math.max(1, Math.min(365, Number(dueDays) || 14)); if (n !== m.due_days) run(async () => { const { error } = await supabase.from('modules').update({ due_days: n }).eq('id', m.id); if (error) throw error; }, `New assignments are due ${n} days after assigning`); }} />
          </label>
        </div>
        <div className="row"><span className="small muted">Quick assign:</span>
          <button type="button" className="btn" disabled={busy} onClick={() => assign(staff.map((s) => s.id))}>All staff</button>
          {roles.map((r) => <button key={r} type="button" className="btn" disabled={busy} onClick={() => assign(staff.filter((s) => s.job_role === r).map((s) => s.id))}>{r}</button>)}
        </div>
      </div>

      <div className="panel tablebox">
        <table>
          <thead><tr><th style={{ width: 80 }}>Assign</th><th>Staff</th><th>Current round</th><th>Due</th><th>Progress</th></tr></thead>
          <tbody>
            {staff.length === 0 && <tr><td colSpan={5} className="muted">No staff yet. Add them on the Staff page.</td></tr>}
            {staff.map((s) => {
              const a = ledger.asg(s.id, m.id); const ok = ledger.done(s.id, m);
              return (
                <tr key={s.id}>
                  <td><label className="check" style={{ minHeight: 24 }} htmlFor={`as-${s.id}`}>
                    <input id={`as-${s.id}`} type="checkbox" disabled={busy} checked={!!a} aria-label={`Assign to ${s.full_name}`}
                      onChange={(e) => {
                        if (e.target.checked) assign([s.id]);
                        else if (window.confirm(`Remove ${s.full_name} from this module? Their past attempts stay in the training record.`))
                          run(() => rpc('unassign_staff', { p_module: m.id, p_staff: s.id }), `Removed ${s.full_name}`);
                      }} />
                  </label></td>
                  <td><b>{s.full_name}</b><div className="small muted">{s.job_role}</div></td>
                  <td>{a ? <>{kindLabel(a.kind)}<div className="small muted">from {fmt(a.assigned_on)}</div></> : '—'}</td>
                  <td>{a ? fmt(a.due_on) : '—'}</td>
                  <td>{!a ? <span className="muted small">Not assigned</span> : ok ? <span className="pill ok">Done</span> : ledger.isOverdue(s.id, m) ? <span className="pill bad">Overdue</span> : <span className="pill warn">Not yet passed</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">Removing an assignment keeps that person’s past attempts in the training record.</p>
    </div>
  );
}

function ResultsTab({ m }: { m: Module }) {
  const { ledger } = useAdmin();
  if (!ledger) return null;
  const rows = ledger.staff().filter((s) => ledger.asg(s.id, m.id) || ledger.atts(s.id, m.id).length);
  if (!rows.length) return <div className="panel pad muted">No results yet.</div>;
  return (
    <div className="panel tablebox">
      <table>
        <thead><tr><th>Staff</th><th>Latest attempt</th><th>Score</th><th>Version</th><th>Attempts</th><th>Result</th></tr></thead>
        <tbody>
          {rows.map((s) => {
            const a = ledger.atts(s.id, m.id); const l = a[a.length - 1];
            return (
              <tr key={s.id}>
                <td><b>{s.full_name}</b><div className="small muted">{s.job_role}</div></td>
                <td>{l ? fmt(l.taken_on) : <span className="muted">Not started</span>}</td>
                <td>{l ? `${l.score}%` : '—'}</td>
                <td className="mono">{l?.version_label ?? '—'}</td>
                <td>{a.length}</td>
                <td>{l ? (l.passed ? <span className="pill ok">Pass</span> : <span className="pill bad">Fail</span>) : <span className="pill plain">Pending</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
