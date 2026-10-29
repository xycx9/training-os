import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAdmin } from '../../../lib/data';
import { useAuth } from '../../../lib/auth';
import { fmt, todayMY } from '../../../lib/logic';
import { CATS, dueDate, fyLabel, fyStart, money, pct, statusOf, totals } from '../../../lib/ste';
import { errText, rpc, supabase } from '../../../lib/supabase';
import type { BnmLevel, Participation, SteCategory, SteExpense, SteYear } from '../../../lib/types';
import { useToast } from '../../../components/Toast';
import { AddFiles, EVIDENCE_EXT, EVIDENCE_MB, uploadFile, viewFile } from '../../../components/Files';
import { BNM_LEVELS } from '../JobRoles';
import { useSte } from './useSte';

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;
interface Form { id: string | null; spent_on: string; category: SteCategory; description: string; amount: string; payee: string; payment_ref: string; link: string; file: File | null; doc_path: string | null; doc_name: string | null }

/** One financial year: budget, every cost by category with its documents, participation, submission. */
export default function SteWorkbook() {
  const { id } = useParams();
  const { d, err, reload } = useSte(id);
  const { data } = useAdmin();
  const { profile } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [form, setForm] = useState<Form | null>(null);
  const [edit, setEdit] = useState<SteYear | null>(null);
  const [submit, setSubmit] = useState<{ on: string; ref: string } | null>(null);
  const [reopen, setReopen] = useState<string | null>(null);
  const [part, setPart] = useState<Participation | null>(null);
  const [busy, setBusy] = useState(false);

  if (err) return <div className="panel pad stack"><div className="err">{err}</div><Link className="link" to="/admin/ste">← Training expenditure</Link></div>;
  if (!d || !data) return <p className="muted">Loading…</p>;
  const y = d.year; const t = totals(y, d.expenses); const locked = y.status === 'submitted'; const st = statusOf(y);
  const nameOf = (uid: string | null) => data.people.find((p) => p.id === uid)?.full_name ?? 'admin';
  const start = fyStart(y.fy_end);
  const sessionsInYear = data.sessions.filter((s) => s.held_on >= start && s.held_on <= y.fy_end);
  const linkLabel = (e: SteExpense) => e.trainer_id ? 'Trainer worksheet' : e.session_id ? data.sessions.find((s) => s.id === e.session_id)?.title ?? 'Session' : e.module_id ? data.modules.find((m) => m.id === e.module_id)?.title ?? 'Module' : '—';

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); await reload(); return true; }
    catch (e) { toast(errText(e), true); return false; }
    finally { setBusy(false); }
  };

  const blank = (): Form => ({ id: null, spent_on: todayMY() <= y.fy_end && todayMY() >= start ? todayMY() : y.fy_end, category: 'a', description: '', amount: '', payee: '', payment_ref: '', link: '', file: null, doc_path: null, doc_name: null });
  const openEdit = (e: SteExpense) => setForm({ id: e.id, spent_on: e.spent_on, category: e.category, description: e.description, amount: String(e.amount), payee: e.payee ?? '', payment_ref: e.payment_ref ?? '', link: e.session_id ? `s:${e.session_id}` : e.module_id ? `m:${e.module_id}` : '', file: null, doc_path: e.doc_path, doc_name: e.doc_name });

  const saveExpense = async () => {
    if (!form) return;
    if (!form.description.trim()) { toast('Enter a description', true); return; }
    if (form.spent_on < start || form.spent_on > y.fy_end) { toast(`The date must fall within ${fyLabel(y.fy_end)} (${fmt(start)} to ${fmt(y.fy_end)})`, true); return; }
    const ok = await run(async () => {
      let doc_path = form.doc_path, doc_name = form.doc_name;
      if (form.file) { const u = await uploadFile('ste-docs', `${y.id}`, form.file); doc_path = u.file_path; doc_name = u.file_name; }
      const row = {
        year_id: y.id, spent_on: form.spent_on, category: form.category, description: form.description.trim(), amount: num(form.amount),
        payee: form.payee.trim() || null, payment_ref: form.payment_ref.trim() || null,
        session_id: form.link.startsWith('s:') ? form.link.slice(2) : null, module_id: form.link.startsWith('m:') ? form.link.slice(2) : null,
        doc_path, doc_name,
      };
      const { error } = form.id ? await supabase.from('ste_expenses').update(row).eq('id', form.id) : await supabase.from('ste_expenses').insert({ ...row, created_by: profile?.id });
      if (error) { if (form.file && doc_path) await supabase.storage.from('ste-docs').remove([doc_path]); throw error; }
      if (form.file && form.doc_path) await supabase.storage.from('ste-docs').remove([form.doc_path]);
    }, form.id ? 'Expense updated' : 'Expense added');
    if (ok) setForm(null);
  };
  const removeExpense = (e: SteExpense) => {
    if (!window.confirm(`Remove “${e.description}” (RM${money(e.amount)})?`)) return;
    run(async () => {
      const { error } = await supabase.from('ste_expenses').delete().eq('id', e.id); if (error) throw error;
      if (e.doc_path) await supabase.storage.from('ste-docs').remove([e.doc_path]);
    }, 'Expense removed');
  };
  const saveYear = async () => {
    if (!edit) return;
    const ok = await run(async () => {
      const { error } = await supabase.from('ste_years').update({
        gross_wages_prev: Number(edit.gross_wages_prev) || 0, carry_forward: Number(edit.carry_forward) || 0, carry_forward_ref: edit.carry_forward_ref?.trim() || null,
        prepared_name: edit.prepared_name?.trim() || null, prepared_title: edit.prepared_title?.trim() || null, prepared_contact: edit.prepared_contact?.trim() || null,
        report_date: edit.report_date || null, notes: edit.notes?.trim() || null,
      }).eq('id', y.id);
      if (error) throw error;
    }, 'Year details saved');
    if (ok) setEdit(null);
  };
  const savePart = () => part && run(async () => { const { error } = await supabase.from('ste_years').update({ participation: part }).eq('id', y.id); if (error) throw error; setPart(null); }, 'Participation saved');
  const doSubmit = async () => {
    if (!submit?.on) { toast('Enter the date it was submitted', true); return; }
    const ok = await run(async () => {
      const { error } = await supabase.from('ste_years').update({ status: 'submitted', submitted_on: submit.on, fibox_ref: submit.ref.trim() || null }).eq('id', y.id);
      if (error) throw error;
    }, `${fyLabel(y.fy_end)} marked as submitted and locked`);
    if (ok) setSubmit(null);
  };
  const doReopen = async () => {
    const ok = await run(() => rpc('reopen_ste_year', { p_year: y.id, p_reason: reopen ?? '' }), `${fyLabel(y.fy_end)} reopened`);
    if (ok) setReopen(null);
  };
  const deleteYear = () => {
    if (!window.confirm(`Delete ${fyLabel(y.fy_end)} and all ${d.expenses.length} expense${d.expenses.length === 1 ? '' : 's'} in it? This cannot be undone.`)) return;
    run(async () => {
      const paths = d.expenses.map((e) => e.doc_path).filter(Boolean) as string[];
      const { error } = await supabase.from('ste_years').delete().eq('id', y.id); if (error) throw error;
      if (paths.length) await supabase.storage.from('ste-docs').remove(paths);
      nav('/admin/ste');
    }, 'Year deleted');
  };
  const P = part ?? y.participation ?? {};
  const pv = (l: BnmLevel, k: 'soft' | 'technical' | 'leadership') => P[l]?.[k] ?? '';

  return (
    <>
      <div><Link className="link small" to="/admin/ste">← Training expenditure</Link></div>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 380px' }}>
          <h1>{fyLabel(y.fy_end)} <span className={`pill ${st.cls}`} style={{ verticalAlign: 'middle' }}>{st.label}</span></h1>
          <p className="muted small" style={{ marginTop: 4 }}>{fmt(start)} to {fmt(y.fy_end)}{y.historical ? ' · historical record' : ''} · report due {fmt(dueDate(y.fy_end))}{locked ? ` · submitted ${fmt(y.submitted_on)}${y.fibox_ref ? `, FIBox ref ${y.fibox_ref}` : ''} · locked` : ''}</p>
        </div>
        <div className="row">
          <Link className="btn" to={`/admin/ste/${y.id}/trainer`}>In-house trainer cost</Link>
          <Link className="btn primary" to={`/admin/ste/${y.id}/report`}>BNM report</Link>
        </div>
      </div>

      <div className="tiles">
        <div className="tile"><span>A · Gross wages, previous year</span><b>{money(y.gross_wages_prev)}</b></div>
        <div className="tile"><span>B · Requirement (2% of A)</span><b>{money(t.req)}</b></div>
        <div className="tile"><span>Carried forward (BNM approved)</span><b>{money(y.carry_forward)}</b><small>{y.carry_forward ? y.carry_forward_ref || 'no reference' : 'none'}</small></div>
        <div className={`tile ${t.spent >= t.req ? 'ok' : 'warn'}`}><span>C · STE incurred</span><b>{money(t.spent)}</b></div>
        <div className={`tile ${t.util >= 1 ? 'ok' : 'warn'}`}><span>D · Utilisation (C ÷ B)</span><b>{pct(t.util)}</b>{t.unused > 0 && <small>RM{money(t.unused)} not used</small>}</div>
      </div>
      {!locked && t.unused > 0 && todayMY() > y.fy_end && <div className="note">RM{money(t.unused)} of this year’s allocation was not used. It can only be carried forward to the next year with BNM’s written approval (S 7.4), with justification and a plan for using it.</div>}

      {edit ? (
        <section className="panel pad stack" style={{ borderColor: 'var(--accent)' }}>
          <h2>Year details</h2>
          <div className="grid-fields">
            <label className="field" htmlFor="ye-gross">A · Gross wages of the previous year (RM)<input id="ye-gross" inputMode="decimal" value={String(edit.gross_wages_prev)} onChange={(e) => setEdit({ ...edit, gross_wages_prev: num(e.target.value) })} /></label>
            <label className="field" htmlFor="ye-carry">Carried forward with BNM approval (RM)<input id="ye-carry" inputMode="decimal" value={String(edit.carry_forward)} onChange={(e) => setEdit({ ...edit, carry_forward: num(e.target.value) })} /></label>
            <label className="field" htmlFor="ye-cref">BNM approval reference<input id="ye-cref" value={edit.carry_forward_ref ?? ''} onChange={(e) => setEdit({ ...edit, carry_forward_ref: e.target.value })} /></label>
            <label className="field" htmlFor="ye-pn">Prepared by: name<input id="ye-pn" value={edit.prepared_name ?? ''} onChange={(e) => setEdit({ ...edit, prepared_name: e.target.value })} /></label>
            <label className="field" htmlFor="ye-pt">Designation<input id="ye-pt" value={edit.prepared_title ?? ''} onChange={(e) => setEdit({ ...edit, prepared_title: e.target.value })} /></label>
            <label className="field" htmlFor="ye-pc">Tel. no. / Email<input id="ye-pc" value={edit.prepared_contact ?? ''} onChange={(e) => setEdit({ ...edit, prepared_contact: e.target.value })} /></label>
            <label className="field" htmlFor="ye-rd">Report date<input id="ye-rd" type="date" value={edit.report_date ?? ''} onChange={(e) => setEdit({ ...edit, report_date: e.target.value })} /></label>
            <label className="field" htmlFor="ye-notes" style={{ gridColumn: '1 / -1' }}>Notes (internal)<input id="ye-notes" value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={saveYear}>Save</button></div>
        </section>
      ) : !locked && <div className="row"><button type="button" className="btn slim" onClick={() => setEdit({ ...y })}>Edit year details</button>{y.notes && <span className="small muted">Note: {y.notes}</span>}</div>}

      {form && (
        <section className="panel pad stack" style={{ borderColor: 'var(--accent)' }}>
          <div className="spread"><h2>{form.id ? 'Edit expense' : 'Add expense'}</h2><button type="button" className="btn slim" onClick={() => setForm(null)}>Close</button></div>
          <div className="grid-fields">
            <label className="field" htmlFor="ex-date">Date<input id="ex-date" type="date" min={start} max={y.fy_end} value={form.spent_on} onChange={(e) => setForm({ ...form, spent_on: e.target.value })} /></label>
            <label className="field" htmlFor="ex-cat" style={{ gridColumn: 'span 2' }}>Category (S 7.2)
              <select id="ex-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as SteCategory })}>
                {CATS.map((c) => <option key={c.key} value={c.key}>{c.code} {c.label}{c.key === 'b_iv' ? ' (or use the trainer worksheet)' : ''}</option>)}
              </select></label>
            <label className="field" htmlFor="ex-amt">Amount (RM)<input id="ex-amt" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
            <label className="field" htmlFor="ex-desc" style={{ gridColumn: '1 / -1' }}>Description<input id="ex-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. AML/CFT/CPF update seminar fee, 2 staff" /></label>
            <label className="field" htmlFor="ex-link">Linked training (optional)
              <select id="ex-link" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })}>
                <option value="">—</option>
                {sessionsInYear.map((s) => <option key={s.id} value={`s:${s.id}`}>Session: {s.title}, {fmt(s.held_on)}</option>)}
                {data.modules.map((m) => <option key={m.id} value={`m:${m.id}`}>Module: {m.title}</option>)}
              </select></label>
            <label className="field" htmlFor="ex-payee">Supplier / payee (optional)<input id="ex-payee" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} /></label>
            <label className="field" htmlFor="ex-ref">Payment reference (optional)<input id="ex-ref" value={form.payment_ref} onChange={(e) => setForm({ ...form, payment_ref: e.target.value })} /></label>
          </div>
          <div className="spread" style={{ alignItems: 'center' }}>
            <div><b className="small">Supporting document</b><p className="small muted">Invoice, receipt or payment voucher (S 8.3). PDF, JPG or PNG, up to {EVIDENCE_MB} MB.</p></div>
            <div className="row">
              <span className="small">{form.file ? form.file.name : form.doc_name ?? 'None attached'}</span>
              <AddFiles label={form.file || form.doc_name ? 'Replace' : '+ Attach'} exts={EVIDENCE_EXT} maxMb={EVIDENCE_MB} multiple={false} onFiles={(fs) => setForm({ ...form, file: fs[0] })} />
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={saveExpense}>{busy ? 'Saving…' : 'Save expense'}</button></div>
        </section>
      )}

      <section className="panel">
        <div className="pad spread" style={{ paddingBottom: 10 }}><h2>Expenditure</h2>
          {locked ? <span className="small muted">Locked after submission</span> : !form && <button type="button" className="btn" onClick={() => setForm(blank())}>+ Add expense</button>}</div>
        <div className="tablebox"><table>
          <thead><tr><th>Date</th><th>Description</th><th>Linked training</th><th>Document</th><th className="num">Amount (RM)</th>{!locked && <th />}</tr></thead>
          <tbody>
            {CATS.map((c) => {
              const rows = d.expenses.filter((e) => e.category === c.key);
              return (
                <Fragment key={c.key}>
                  {c.key === 'b_i' && <tr className="cat"><td colSpan={4}>(b) In-house training</td><td className="num">{money(t.b)}</td>{!locked && <td />}</tr>}
                  {c.key === 'a' ? <tr className="cat"><td colSpan={4}>{c.code} {c.label}</td><td className="num">{money(t.a)}</td>{!locked && <td />}</tr>
                    : <tr className="sub"><td colSpan={4} className="small muted" style={{ paddingBottom: rows.length ? 2 : undefined }}>{c.code.replace('(b)', '')} {c.label}{rows.length ? '' : ' · nothing recorded'}</td><td className="num small muted">{rows.length ? '' : '0.00'}</td>{!locked && <td />}</tr>}
                  {rows.map((e) => (
                    <tr key={e.id} className="sub">
                      <td style={{ whiteSpace: 'nowrap' }}>{fmt(e.spent_on)}</td>
                      <td>{e.description}{(e.payee || e.payment_ref) && <div className="small muted">{[e.payee, e.payment_ref].filter(Boolean).join(' · ')}</div>}</td>
                      <td className="small">{linkLabel(e)}</td>
                      <td>{e.doc_path ? <button type="button" className="link small" onClick={() => viewFile('ste-docs', e.doc_path!).catch((x) => toast(errText(x), true))}>{e.doc_name ?? 'View'}</button> : e.trainer_id ? <Link className="link small" to={`/admin/ste/${y.id}/trainer`}>Worksheet</Link> : <span className="small" style={{ color: 'var(--warn-ink)' }}>None</span>}</td>
                      <td className="num">{money(e.amount)}</td>
                      {!locked && <td style={{ whiteSpace: 'nowrap' }}>{e.trainer_id ? <Link className="link small" to={`/admin/ste/${y.id}/trainer`}>Edit</Link>
                        : <span className="row small" style={{ gap: 10 }}><button type="button" className="link" onClick={() => openEdit(e)}>Edit</button><button type="button" className="link" style={{ color: 'var(--bad-ink)' }} onClick={() => removeExpense(e)}>Remove</button></span>}</td>}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            <tr><td colSpan={4}><b>Total STE incurred (C)</b></td><td className="num"><b>{money(t.spent)}</b></td>{!locked && <td />}</tr>
          </tbody>
        </table></div>
      </section>
      {d.expenses.some((e) => !e.doc_path && !e.trainer_id) && <p className="small" style={{ color: 'var(--warn-ink)' }}>Some expenses have no supporting document. BNM expects documents to be kept for every amount reported (S 8.3).</p>}

      <section className="panel pad stack">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 340px' }}><h2>Breakdown of training participation</h2>
            <p className="small muted" style={{ marginTop: 4 }}>Number of staff sent for training, by level and type, as on the BNM return. Enter the numbers for now; a later update will count them from the training records.</p></div>
          {!locked && (part ? <div className="row"><button type="button" className="btn" onClick={() => setPart(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={savePart}>Save</button></div>
            : <button type="button" className="btn slim" onClick={() => setPart(JSON.parse(JSON.stringify(y.participation ?? {})))}>Edit</button>)}
        </div>
        <div className="tablebox"><table>
          <thead><tr><th>Level</th><th className="num">Soft skills</th><th className="num">Technical</th><th className="num">Leadership</th></tr></thead>
          <tbody>{BNM_LEVELS.map(([l, label, eg]) => (
            <tr key={l}><td>{label}<div className="small muted">{eg}</div></td>
              {(['soft', 'technical', 'leadership'] as const).map((k) => (
                <td key={k} className="num">{part ? <input aria-label={`${label} ${k}`} inputMode="numeric" style={{ width: 70, textAlign: 'right' }} value={String(pv(l, k))}
                  onChange={(e) => { const v = e.target.value === '' ? undefined : Math.max(0, Math.round(num(e.target.value))); setPart({ ...P, [l]: { ...(P[l] ?? {}), [k]: v } }); }} /> : (pv(l, k) === '' ? '–' : pv(l, k))}</td>
              ))}
            </tr>
          ))}</tbody>
        </table></div>
      </section>

      {submit && (
        <section className="panel pad stack" style={{ borderColor: 'var(--accent)' }}>
          <h2>Mark {fyLabel(y.fy_end)} as submitted</h2>
          <p className="small muted">Record when the report was submitted to BNM through FIBox. The year is then locked; it can be reopened later with a reason, which is kept in its history.</p>
          <div className="grid-fields">
            <label className="field" htmlFor="sb-on">Date submitted<input id="sb-on" type="date" max={todayMY()} value={submit.on} onChange={(e) => setSubmit({ ...submit, on: e.target.value })} /></label>
            <label className="field" htmlFor="sb-ref">FIBox reference (optional)<input id="sb-ref" value={submit.ref} onChange={(e) => setSubmit({ ...submit, ref: e.target.value })} /></label>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setSubmit(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={doSubmit}>Mark as submitted</button></div>
        </section>
      )}
      {reopen !== null && (
        <section className="panel pad stack" style={{ borderColor: 'var(--warn-ink)' }}>
          <h2>Reopen {fyLabel(y.fy_end)}</h2>
          <label className="field" htmlFor="ro-why">Reason (kept in the year’s history)<input id="ro-why" value={reopen} onChange={(e) => setReopen(e.target.value)} placeholder="e.g. Correcting the seminar fee to match the receipt" /></label>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setReopen(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy || !reopen.trim()} onClick={doReopen}>Reopen</button></div>
        </section>
      )}

      <div className="row">
        {locked ? <button type="button" className="btn" onClick={() => setReopen('')}>Reopen to make changes</button>
          : <>
            <button type="button" className="btn primary" onClick={() => setSubmit({ on: y.submitted_on ?? todayMY(), ref: y.fibox_ref ?? '' })}>Mark as submitted…</button>
            <button type="button" className="btn danger" disabled={busy} onClick={deleteYear}>Delete year</button>
          </>}
      </div>

      {d.log.length > 0 && (
        <section className="panel pad stack" style={{ gap: 8 }}><h2>History</h2>
          {d.log.map((l) => <div key={l.id} className="small"><b>{fmt(l.at.slice(0, 10))}</b> · {l.action === 'submitted' ? 'Marked as submitted' : l.action === 'reopened' ? 'Reopened' : l.action}{l.note ? `: ${l.note}` : ''} · {nameOf(l.by_user)}</div>)}
        </section>
      )}
    </>
  );
}
