import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCompany, type CompanyProfile } from '../../lib/company';
import { fmt, todayMY, type HistRow } from '../../lib/logic';
import { errText, rpc } from '../../lib/supabase';
import { useToast } from '../../components/Toast';
import { useStaffData } from './Home';

const long = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));

/** Company letterhead: logo, name, registration number, address and contacts. */
export function Letterhead({ company, logoUrl }: { company: CompanyProfile; logoUrl: string | null }) {
  const line1 = [company.reg_no && `Company No. ${company.reg_no}`, company.address].filter(Boolean).join(' · ');
  const line2 = [company.phone && `Tel ${company.phone}`, company.email].filter(Boolean).join(' · ');
  return (
    <div className={`lh ${logoUrl ? '' : 'nologo'}`}>
      {logoUrl && <img className="lhlogo" src={logoUrl} alt="" />}
      <div>
        <div className="co">{company.name}</div>
        {line1 && <div className="meta">{line1}</div>}
        {line2 && <div className="meta">{line2}</div>}
      </div>
    </div>
  );
}

const hh = (n: number) => (Number(n) || 0).toFixed(1);
const formatOf = (r: HistRow) => (!r.manual ? 'Online module with assessment' : r.session_id ? 'Classroom session' : 'Classroom / external training');

/** Official statement of completed training, on letterhead, for outside parties (e.g. CPD/CPE claims). */
export default function OfficialRecord() {
  const { d, err } = useStaffData();
  const { company, logoUrl } = useCompany();
  const toast = useToast();
  const [params] = useSearchParams();
  const [ref, setRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  if (err) return <div className="printpage err">{err}</div>;
  if (!d) return <div className="printpage muted">Preparing your record…</div>;

  const today = todayMY();
  const rows = d.ledger.history(d.me.id)
    .filter((r) => r.result !== 'fail' && (!from || r.taken_on >= from) && (!to || r.taken_on <= to));
  const hours = rows.reduce((t, r) => t + r.hours, 0);
  const periodText = from && to ? `${long(from)} to ${long(to)}` : from ? `From ${long(from)}` : to ? `Up to ${long(to)}` : `All training up to ${long(today)}`;

  const print = async () => {
    if (ref) { window.print(); return; }
    setBusy(true);
    try {
      const r = await rpc<string>('issue_statement', { p_from: from || null, p_to: to || null, p_records: rows.length, p_hours: hours });
      setRef(r);
      setTimeout(() => window.print(), 150);
    } catch (e) {
      const m = errText(e);
      toast(m.includes('issue_statement') ? 'Official records need the latest database update. Please tell your administrator.' : m, true);
    } finally { setBusy(false); }
  };

  return (
    <div className="printpage stack officialpage">
      <div className="row noprint">
        <Link className="btn" to="/records">← Back</Link>
        <button type="button" className="btn primary" disabled={busy || !rows.length} onClick={print}>{busy ? 'Preparing…' : 'Print or save as PDF'}</button>
        <span className="small muted">{ref ? `Reference ${ref} has been issued for this statement.` : 'A reference number is issued when you print.'} Then ask your compliance officer to sign and stamp it.</span>
      </div>
      <div className="desk"><div className="sheet">
        <Letterhead company={company} logoUrl={logoUrl} />
        <div className="doctitle">Statement of Training Record</div>
        <div className="refline"><span>Ref: {ref ?? '(issued when printed)'}</span><span>Date issued: {long(today)}</span></div>
        <div className="kv">
          <b>Name</b><span>{d.me.full_name}</span>
          <b>Position</b><span>{d.me.job_role}</span>
          <b>Date joined</b><span>{long(d.me.joined_on)}</span>
          <b>Period covered</b><span>{periodText}</span>
        </div>
        {rows.length ? (
          <table>
            <thead><tr><th>No.</th><th>Date</th><th>Training</th><th>Format</th><th>Provider</th><th>Result</th><th style={{ textAlign: 'right' }}>Hours</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td><td style={{ whiteSpace: 'nowrap' }}>{fmt(r.taken_on)}</td><td>{r.module_title}</td><td>{formatOf(r)}</td>
                  <td>{r.manual ? r.delivered_by || '—' : company.name}</td>
                  <td>{r.result === 'pass' ? `Pass${r.score != null ? ` (${r.score}%)` : ''}` : r.session_id ? 'Attended' : 'Completed'}</td>
                  <td style={{ textAlign: 'right' }}>{hh(r.hours)}</td>
                </tr>
              ))}
              <tr className="totalrow"><td colSpan={6}>Total training hours</td><td style={{ textAlign: 'right' }}>{hh(hours)}</td></tr>
            </tbody>
          </table>
        ) : <p>No completed training in this period.</p>}
        <p style={{ marginTop: 18 }}>We confirm that the above-named staff member completed the training listed, as recorded in the company’s training records.</p>
        <div className="sign">
          <div><div style={{ height: 56 }} /><div className="sigline">
            {company.signatory_name ? <b>{company.signatory_name}</b> : <span>Name: ______________________________</span>}<br />
            {company.signatory_title ? company.signatory_title : 'Designation: ________________________'}<br />
            For and on behalf of {company.name}<br />Date: ____________________
          </div></div>
          <div className="stamp">Company<br />stamp</div>
        </div>
        <div className="foot"><span>Valid only with an authorised signature and company stamp.</span><span>{ref ? `Ref ${ref}` : ''}</span></div>
      </div></div>
    </div>
  );
}
