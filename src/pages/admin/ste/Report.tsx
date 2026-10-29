import { Link, useParams } from 'react-router-dom';
import { useCompany } from '../../../lib/company';
import { fmt, todayMY } from '../../../lib/logic';
import { CATS, actHours, catOf, fyLabel, hourlyRate, mmyyyy, money, monthlyCost, pct, saveBlob, totalHours, totals, xlsx } from '../../../lib/ste';
import type { BnmLevel, Participation, SteYear } from '../../../lib/types';
import { BNM_LEVELS } from '../JobRoles';
import { useSte } from './useSte';

const cnt = (p: Participation, l: BnmLevel, k: 'soft' | 'technical' | 'leadership') => p?.[l]?.[k];
const dash = (n: number) => (n ? money(n) : '–');

/** The BNM STE return (attachment layout) with the supporting schedule, for print/PDF or Excel. */
export default function SteReport() {
  const { id } = useParams();
  const { d, err } = useSte(id);
  const { company } = useCompany();
  if (err) return <div className="panel pad stack"><div className="err">{err}</div><Link className="link" to="/admin/ste">← Training expenditure</Link></div>;
  if (!d) return <p className="muted">Loading…</p>;
  const y = d.year; const t = totals(y, d.expenses);
  const licensee = company.name.toUpperCase();
  const reportDate = y.report_date || y.submitted_on || todayMY();
  const iv = t.by.b_iv + t.by.b_v;

  const excel = () => {
    const P = y.participation ?? {};
    const c = (l: BnmLevel, k: 'soft' | 'technical' | 'leadership') => { const v = cnt(P, l, k); return v === undefined || v === null ? null : v; };
    const cells: Record<string, string | number | null | { v: string | number; s?: number }> = {
      D1: { v: 'STE Report', s: 1 }, H1: { v: 'Attachment', s: 1 },
      B3: 'For financial year ending (MM/YYYY): ', C3: mmyyyy(y.fy_end), B4: 'Name of licensee:', C4: licensee,
      B6: { v: 'A', s: 1 }, C6: { v: 'B', s: 1 }, D6: { v: 'C', s: 1 }, H6: { v: 'D', s: 1 },
      B7: { v: 'Total gross salary of previous year ', s: 6 }, C7: { v: 'STE requirement\n[2% of A]', s: 6 }, D7: { v: 'STE incurred for the year', s: 6 }, H7: { v: 'STE Utilisation\n[(C/B) x 100%]', s: 6 },
      B9: '(RM)', H9: '%',
      B10: { v: Number(y.gross_wages_prev) || 0, s: 2 }, C10: { v: t.req, s: 2 }, D10: 'a)', E10: { v: catOf('a').short, s: 4 }, G10: { v: t.a, s: 2 }, H10: { v: t.util, s: 3 },
      D11: 'b)', E11: { v: 'Costs and expenditures incurred for in-house training, including:', s: 4 }, G11: { v: t.b, s: 2 },
      E12: '(i)', F12: { v: 'Rental / equivalent rental cost of training premise', s: 4 }, G12: { v: t.by.b_i, s: 2 },
      E13: '(ii)', F13: { v: 'Rental of training equipment', s: 4 }, G13: { v: t.by.b_ii, s: 2 },
      E14: '(iii)', F14: { v: 'Depreciation cost of assets purchased and used for training', s: 4 }, G14: { v: t.by.b_iii, s: 2 },
      E15: '(iv)', F15: { v: 'Expenditures for engaging external trainers / salaries of \nin-house trainers', s: 4 }, G15: { v: iv, s: 2 },
      D16: { v: 'Total STE incurred \nfor the year \n[(a)+(b)]', s: 6 }, G16: { v: t.spent, s: 5 },
      B19: { v: 'Breakdown of training participation', s: 1 }, B20: { v: 'Level', s: 1 }, D20: { v: 'Type of training ', s: 1 },
      D21: { v: 'Soft skills', s: 1 }, G21: { v: 'Technical', s: 1 }, H21: { v: 'Leadership', s: 1 }, D22: 'No. of staff sent for training',
      B23: { v: 'Director and Senior Management\n(e.g. CEO)', s: 4 }, D23: c('senior', 'soft'), G23: c('senior', 'technical'), H23: c('senior', 'leadership'),
      B26: { v: 'Middle Management \n(e.g. Manager, Compliance Officer)', s: 4 }, D26: c('middle', 'soft'), G26: c('middle', 'technical'), H26: c('middle', 'leadership'),
      B29: { v: 'Support staff \n(e.g. Front line officer)', s: 4 }, D29: c('support', 'soft'), G29: c('support', 'technical'), H29: c('support', 'leadership'),
      B33: 'Prepared by: ', B35: 'Name: ', C35: (y.prepared_name ?? '').toUpperCase(), B37: 'Designation', C37: y.prepared_title ?? '',
      B39: 'Tel. no. / Email: ', C39: y.prepared_contact ?? '', B41: 'Date:', C41: fmt(reportDate),
    };
    saveBlob(`STE_Report-${y.fy_end.slice(0, 4)}-${licensee.replace(/[^A-Z0-9]+/g, '').slice(0, 12)}.xlsx`, xlsx('STE Report', cells, [3, 30, 18, 10, 8, 40, 14, 18], ['B23:C25', 'B26:C28', 'B29:C31', 'E10:F10', 'E11:F11']));
  };

  return (
    <div className="stack">
      <div className="row noprint">
        <Link className="link small" to={`/admin/ste/${y.id}`}>← {fyLabel(y.fy_end)}</Link><span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={excel}>Download Excel</button>
        <button type="button" className="btn primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      {y.status !== 'submitted' && <p className="small muted noprint">Draft. When you have submitted it through FIBox, go back to the year and click “Mark as submitted”.</p>}
      <div className="desk"><div className="sheet">
        <ReturnSheet y={y} t={t} licensee={licensee} reportDate={reportDate} />
        <div className="pagebreak">
          <p style={{ margin: '0 0 6px' }}><b>Supporting schedule · {fyLabel(y.fy_end)}</b> <span className="small" style={{ color: '#555' }}>(year ended {fmt(y.fy_end)} · {licensee})</span></p>
          <table className="ret"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Supporting document</th><th>RM</th></tr></thead>
            <tbody>
              {d.expenses.length === 0 && <tr><td colSpan={5}>No expenditure recorded.</td></tr>}
              {CATS.flatMap((c) => d.expenses.filter((e) => e.category === c.key)).map((e) => (
                <tr key={e.id}><td style={{ whiteSpace: 'nowrap' }}>{e.trainer_id ? 'Full year' : fmt(e.spent_on)}</td><td>{catOf(e.category).code}</td>
                  <td>{e.description}{e.payee ? ` · ${e.payee}` : ''}{e.payment_ref ? ` · ${e.payment_ref}` : ''}</td>
                  <td>{e.trainer_id ? 'Trainer worksheet (below)' : e.doc_name ?? '—'}</td><td className="r">{money(e.amount)}</td></tr>
              ))}
              <tr><td colSpan={4}><b>Total</b></td><td className="r"><b>{money(t.spent)}</b></td></tr>
            </tbody></table>
          {d.trainers.map((tr) => (
            <div key={tr.id} style={{ marginTop: 16 }}>
              <p style={{ margin: '0 0 4px', fontSize: 12 }}><b>In-house trainer: {tr.trainer_name}{tr.trainer_role ? `, ${tr.trainer_role}` : ''}</b> · monthly cost RM{money(monthlyCost(tr))} (basic RM{money(tr.monthly_salary)} + fixed allowances RM{money(tr.monthly_allowances)} + employer EPF RM{money(tr.monthly_epf)}) ÷ {tr.hours_per_month} h = RM{money(hourlyRate(tr))} per hour</p>
              <table className="ret"><thead><tr><th>Activity</th><th>Frequency</th><th>Times</th><th>Hours each</th><th>Annual hours</th><th>Justification</th></tr></thead>
                <tbody>{tr.activities.map((a, i) => <tr key={i}><td>{i + 1}. {a.name}</td><td>{a.frequency}</td><td className="r">{a.sessions}</td><td className="r">{a.hours}</td><td className="r">{actHours(a).toFixed(1)}</td><td>{a.justification}</td></tr>)}
                  <tr><td colSpan={4}><b>Total</b></td><td className="r"><b>{totalHours(tr).toFixed(1)}</b></td><td>{totalHours(tr).toFixed(1)} h × RM{money(hourlyRate(tr))} = <b>RM{money(Math.round(totalHours(tr) * hourlyRate(tr) * 100) / 100)}</b> · {tr.session_ids.length} session{tr.session_ids.length === 1 ? '' : 's'} delivered, recorded in the training system</td></tr>
                </tbody></table>
            </div>
          ))}
          <p style={{ margin: '16px 0 0', fontSize: 12 }}><b>Declaration.</b> I hereby declare that the information provided in this report is accurate, complete and prepared in accordance with the Policy Document on Staff Training Expenditure for Money Services Business issued by Bank Negara Malaysia.</p>
          <p style={{ margin: '28px 0 0', fontSize: 12 }}>______________________________<br />{y.prepared_name ?? 'Name'}{y.prepared_title ? `, ${y.prepared_title}` : ''}<br />Date: {fmt(reportDate)}</p>
        </div>
      </div></div>
    </div>
  );
}

function ReturnSheet({ y, t, licensee, reportDate }: { y: SteYear; t: ReturnType<typeof totals>; licensee: string; reportDate: string }) {
  const P = y.participation ?? {};
  const v = (l: BnmLevel, k: 'soft' | 'technical' | 'leadership') => { const n = cnt(P, l, k); return n === undefined || n === null ? '–' : n; };
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><b style={{ fontSize: 15 }}>STE Report</b><i>Attachment</i></div>
      <p style={{ margin: '10px 0 2px' }}>For financial year ending (MM/YYYY): <b>{mmyyyy(y.fy_end)}</b></p>
      <p style={{ margin: '0 0 12px' }}>Name of licensee: <b>{licensee}</b></p>
      <table className="ret">
        <thead><tr><th>A<br />Total gross salary of previous year (RM)</th><th>B<br />STE requirement [2% of A]</th><th colSpan={3}>C<br />STE incurred for the year (RM)</th><th>D<br />STE utilisation [(C/B) × 100%]</th></tr></thead>
        <tbody>
          <tr><td className="r" rowSpan={7}>{money(y.gross_wages_prev)}</td><td className="r" rowSpan={7}>{money(t.req)}</td><td>a)</td><td>Seminar and course fees, scholarships as well as other incidental costs and expenditures</td><td className="r">{dash(t.a)}</td><td className="r" rowSpan={7}>{pct(t.util)}</td></tr>
          <tr><td>b)</td><td>Costs and expenditures incurred for in-house training, including:</td><td className="r">{dash(t.b)}</td></tr>
          <tr><td /><td>(i) Rental / equivalent rental cost of training premise</td><td className="r">{dash(t.by.b_i)}</td></tr>
          <tr><td /><td>(ii) Rental of training equipment</td><td className="r">{dash(t.by.b_ii)}</td></tr>
          <tr><td /><td>(iii) Depreciation cost of assets purchased and used for training</td><td className="r">{dash(t.by.b_iii)}</td></tr>
          <tr><td /><td>(iv) Expenditures for engaging external trainers / salaries of in-house trainers</td><td className="r">{dash(t.by.b_iv + t.by.b_v)}</td></tr>
          <tr><td colSpan={2}><b>Total STE incurred for the year [(a)+(b)]</b></td><td className="r"><b>{money(t.spent)}</b></td></tr>
        </tbody>
      </table>
      {Number(y.carry_forward) > 0 && <p style={{ margin: '6px 0 0', fontSize: 11 }}>Note: RM{money(y.carry_forward)} carried forward from the previous year with BNM approval{y.carry_forward_ref ? ` (${y.carry_forward_ref})` : ''}.</p>}
      <p style={{ margin: '18px 0 6px' }}><b>Breakdown of training participation</b></p>
      <table className="ret">
        <thead><tr><th rowSpan={2}>Level</th><th colSpan={3}>Type of training · No. of staff sent for training</th></tr><tr><th>Soft skills</th><th>Technical</th><th>Leadership</th></tr></thead>
        <tbody>{BNM_LEVELS.map(([l, label, eg]) => <tr key={l}><td>{label} ({eg})</td><td className="r">{v(l, 'soft')}</td><td className="r">{v(l, 'technical')}</td><td className="r">{v(l, 'leadership')}</td></tr>)}</tbody>
      </table>
      <div style={{ marginTop: 22, fontSize: 12, lineHeight: 1.9 }}>Prepared by:<br />Name: <b>{(y.prepared_name ?? '').toUpperCase() || '______________________'}</b><br />Designation: <b>{y.prepared_title || '______________________'}</b><br />Tel. no. / Email: {y.prepared_contact || '______________________'}<br />Date: {fmt(reportDate)}</div>
    </>
  );
}
