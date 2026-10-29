import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../lib/auth';
import { useCompany } from '../../../lib/company';
import { fmt, todayMY } from '../../../lib/logic';
import { dueDate, fyLabel, fyStart, money, pct, statusOf, totals } from '../../../lib/ste';
import { errText, supabase } from '../../../lib/supabase';
import type { SteExpense, SteYear } from '../../../lib/types';
import { useToast } from '../../../components/Toast';

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;
const NEEDS_DB = 'Training expenditure needs the latest database update (0005). See the README.';

/** All financial years, newest first, with requirement, spending and report status. */
export default function SteYears() {
  const { profile } = useAuth();
  const { company } = useCompany();
  const toast = useToast();
  const nav = useNavigate();
  const [years, setYears] = useState<SteYear[] | null>(null);
  const [ex, setEx] = useState<SteExpense[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ fy_end: '', gross: '', carry: '0', carry_ref: '' });

  useEffect(() => {
    (async () => {
      const [{ data: ys, error }, { data: es }] = await Promise.all([
        supabase.from('ste_years').select('*').order('fy_end', { ascending: false }),
        supabase.from('ste_expenses').select('id,year_id,category,amount'),
      ]);
      if (error) { setErr(error.message.includes('ste_years') ? NEEDS_DB : error.message); setYears([]); return; }
      setYears(ys as SteYear[]); setEx((es as SteExpense[] | null) ?? []);
    })();
  }, []);

  const startAdd = () => {
    const have = new Set((years ?? []).map((y) => y.fy_end));
    let y = Number(todayMY().slice(0, 4)); while (have.has(`${y}-12-31`) && y > 2000) y--;
    if (have.has(`${y}-12-31`)) y = Number(todayMY().slice(0, 4)) + 1;
    setF({ fy_end: `${y}-12-31`, gross: '', carry: '0', carry_ref: '' }); setAdding(true);
  };
  const create = async () => {
    if (!f.fy_end) { toast('Choose the financial year end', true); return; }
    if (!num(f.gross)) { toast('Enter the total gross wages of the previous financial year', true); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.from('ste_years').insert({
        fy_end: f.fy_end, gross_wages_prev: num(f.gross), carry_forward: num(f.carry), carry_forward_ref: f.carry_ref.trim() || null,
        historical: dueDate(f.fy_end) < todayMY(),
        prepared_name: company.signatory_name, prepared_title: company.signatory_title, prepared_contact: company.email,
        created_by: profile?.id,
      }).select('id').single();
      if (error) throw new Error(error.message.includes('duplicate') ? `${fyLabel(f.fy_end)} already exists` : error.message);
      nav(`/admin/ste/${data.id}`);
    } catch (e) { toast(errText(e), true); }
    finally { setBusy(false); }
  };

  const next = (years ?? []).filter((y) => y.status !== 'submitted').sort((a, b) => (a.fy_end < b.fy_end ? -1 : 1))[0];
  const nt = next ? totals(next, ex.filter((e) => e.year_id === next.id)) : null;

  return (
    <>
      <div className="spread">
        <div><h1>Training expenditure (STE)</h1>
          <p className="muted small" style={{ marginTop: 4, maxWidth: 760 }}>BNM Policy Document on Staff Training Expenditure for Money Services Business (BNM/RH/PD 031-6). Set aside 2% of the previous financial year’s gross wages for staff training, keep supporting documents, and report to BNM through FIBox within one month after the financial year end. Only admins can see this section.</p></div>
        {!adding && !err && <button type="button" className="btn primary" onClick={startAdd}>+ Add financial year</button>}
      </div>
      {err && <div className="err">{err}</div>}

      {adding && (
        <section className="panel pad stack" style={{ borderColor: 'var(--accent)' }}>
          <div className="spread" style={{ alignItems: 'flex-start' }}><div><h2>Add financial year</h2>
            <p className="small muted" style={{ marginTop: 4 }}>For a past year, enter the figures from the report you submitted. It will be marked as a historical record.</p></div>
            <button type="button" className="btn slim" onClick={() => setAdding(false)}>Close</button></div>
          <div className="grid-fields">
            <label className="field" htmlFor="sy-end">Financial year ends on<input id="sy-end" type="date" value={f.fy_end} onChange={(e) => setF({ ...f, fy_end: e.target.value })} />
              {f.fy_end && <span className="small muted" style={{ fontWeight: 400 }}>{fyLabel(f.fy_end)}: {fmt(fyStart(f.fy_end))} to {fmt(f.fy_end)} · report due {fmt(dueDate(f.fy_end))}</span>}</label>
            <label className="field" htmlFor="sy-gross">A · Total gross wages of the previous year (RM)<input id="sy-gross" inputMode="decimal" value={f.gross} onChange={(e) => setF({ ...f, gross: e.target.value })} placeholder="e.g. 72000" />
              <span className="small muted" style={{ fontWeight: 400 }}>Basic salary and fixed allowances of all staff. Excludes EPF, travel allowances, bonus and commission.</span></label>
            <label className="field" htmlFor="sy-carry">Carried forward with BNM approval (RM)<input id="sy-carry" inputMode="decimal" value={f.carry} onChange={(e) => setF({ ...f, carry: e.target.value })} /></label>
            {num(f.carry) > 0 && <label className="field" htmlFor="sy-cref">BNM approval reference<input id="sy-cref" value={f.carry_ref} onChange={(e) => setF({ ...f, carry_ref: e.target.value })} /></label>}
          </div>
          {num(f.gross) > 0 && <div className="note">Requirement (B) = 2% × RM{money(num(f.gross))} = <b>RM{money(num(f.gross) * 0.02)}</b></div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="btn primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create year'}</button>
          </div>
        </section>
      )}

      {years === null ? <p className="muted">Loading…</p> : !err && (
        <section className="panel tablebox">
          <table>
            <thead><tr><th>Financial year</th><th className="num">Gross wages (prev. year)</th><th className="num">Requirement (2%)</th><th className="num">Spent</th><th>Used</th><th>Report due</th><th>Status</th></tr></thead>
            <tbody>
              {!years.length && <tr><td colSpan={7} className="muted">No financial years yet. Add one to start, including past years you have already reported.</td></tr>}
              {years.map((y) => {
                const t = totals(y, ex.filter((e) => e.year_id === y.id)); const st = statusOf(y);
                return (
                  <tr key={y.id}>
                    <td><Link className="link" to={`/admin/ste/${y.id}`}>{fyLabel(y.fy_end)}</Link><div className="small muted">{fmt(fyStart(y.fy_end))} – {fmt(y.fy_end)}{y.historical ? ' · historical record' : ''}</div></td>
                    <td className="num">{money(y.gross_wages_prev)}</td><td className="num">{money(t.req)}</td><td className="num">{money(t.spent)}</td>
                    <td style={{ minWidth: 110 }}><div className="meter"><i style={{ width: `${Math.min(100, t.util * 100)}%`, background: t.util >= 1 ? 'var(--ok-ink)' : 'var(--warn-ink)' }} /></div><span className="small">{pct(t.util)}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(dueDate(y.fy_end))}</td>
                    <td><span className={`pill ${st.cls}`}>{st.label}</span>{y.status === 'submitted' && y.submitted_on && <div className="small muted">{fmt(y.submitted_on)}</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {next && nt && nt.unused > 0 && (
        <div className="note"><b>{fyLabel(next.fy_end)}:</b> RM{money(nt.unused)} of the allocation is not used yet. Unused STE can only be carried forward to the next year with BNM’s written approval (S 7.4).</div>
      )}
    </>
  );
}
