import { useState } from 'react';
import { useAdmin } from '../../lib/data';
import { downloadText, parseCSV, todayMY } from '../../lib/logic';
import { errText, supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../components/Toast';

const CSV_HEADER = 'username,training,date,hours,result,score,delivered_by,notes';

interface Entry { staff_id: string; title: string; completed_on: string; hours: string; result: 'completed' | 'pass' | 'fail'; score: string; delivered_by: string; notes: string }
const blank = (staff = ''): Entry => ({ staff_id: staff, title: '', completed_on: '', hours: '1', result: 'completed', score: '', delivered_by: '', notes: '' });

/** Accepts 2024-05-10, 10/05/2024 or 10-05-2024 (day first). */
function toIso(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const validDate = (iso: string) => { const d = new Date(iso + 'T12:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso; };

export default function PastTrainingForm({ onClose }: { onClose: () => void }) {
  const { data, ledger, reload } = useAdmin();
  const { profile } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<'one' | 'csv'>('one');
  const [e, setE] = useState<Entry>(blank());
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState('');
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (!data || !ledger || !profile) return null;
  const staff = ledger.staff();
  const today = todayMY();

  const row = (x: Entry) => ({
    staff_id: x.staff_id, title: x.title.trim(), completed_on: x.completed_on, hours: Number(x.hours) || 0, result: x.result,
    score: x.score.trim() === '' ? null : Math.max(0, Math.min(100, Math.round(Number(x.score)))),
    delivered_by: x.delivered_by.trim() || null, notes: x.notes.trim() || null, entered_by: profile.id,
  });

  const saveOne = async () => {
    const problems: string[] = [];
    if (!e.staff_id) problems.push('Choose the staff member.');
    if (!e.title.trim()) problems.push('Enter the name of the training.');
    if (!e.completed_on || !validDate(e.completed_on)) problems.push('Enter the date the training took place.');
    else if (e.completed_on > today) problems.push('The date cannot be in the future.');
    setErrs(problems);
    if (problems.length) return;
    setBusy(true);
    try {
      let evidence_path: string | null = null, evidence_name: string | null = null;
      if (file) {
        if (file.size > 10 * 1024 * 1024) throw new Error('The evidence file is larger than 10 MB.');
        const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
        evidence_path = `${e.staff_id}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from('evidence').upload(evidence_path, file, { contentType: file.type || undefined });
        if (error) throw error;
        evidence_name = file.name;
      }
      const { error } = await supabase.from('past_training').insert({ ...row(e), evidence_path, evidence_name });
      if (error) throw error;
      toast('Past training recorded');
      setE(blank(e.staff_id)); setFile(null);
      await reload();
    } catch (err) { setErrs([errText(err)]); }
    finally { setBusy(false); }
  };

  const importCsv = async () => {
    const rows = parseCSV(csv); const problems: string[] = []; const out: ReturnType<typeof row>[] = [];
    rows.forEach((r, k) => {
      if (k === 0 && r[0].trim().toLowerCase() === 'username') return;
      const n = k + 1;
      const who = staff.find((s) => s.username === (r[0] || '').trim().toLowerCase());
      if (!who) { problems.push(`Row ${n}: no staff with username "${(r[0] || '').trim()}".`); return; }
      if (!(r[1] || '').trim()) { problems.push(`Row ${n}: the training name is empty.`); return; }
      const iso = toIso(r[2] || '');
      if (!iso || !validDate(iso)) { problems.push(`Row ${n}: "${r[2] || ''}" is not a date. Use 2024-05-10 or 10/05/2024.`); return; }
      if (iso > today) { problems.push(`Row ${n}: the date is in the future.`); return; }
      const result = ((r[4] || 'completed').trim().toLowerCase() || 'completed') as Entry['result'];
      if (!['completed', 'pass', 'fail'].includes(result)) { problems.push(`Row ${n}: result must be completed, pass or fail.`); return; }
      out.push(row({ staff_id: who.id, title: r[1], completed_on: iso, hours: r[3] || '0', result, score: r[5] || '', delivered_by: r[6] || '', notes: r[7] || '' }));
    });
    if (!rows.length) problems.push('Paste at least one row first.');
    setErrs(problems);
    if (problems.length || !out.length) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('past_training').insert(out);
      if (error) throw error;
      toast(`${out.length} past training record${out.length === 1 ? '' : 's'} added`);
      setCsv('');
      await reload();
    } catch (err) { setErrs([errText(err)]); }
    finally { setBusy(false); }
  };

  return (
    <section className="panel pad stack" aria-label="Record past training">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px' }}>
          <h2>Record past training</h2>
          <p className="small muted" style={{ marginTop: 4 }}>For training that took place before this system, or outside it, such as a classroom briefing or an external course. Enter the date it actually happened. Each entry is marked “Recorded” with your name and today’s date, and cannot be edited afterwards.</p>
        </div>
        <button type="button" className="btn slim" onClick={onClose}>Close</button>
      </div>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'one'} onClick={() => { setMode('one'); setErrs([]); }}>One record</button>
        <button type="button" role="tab" aria-selected={mode === 'csv'} onClick={() => { setMode('csv'); setErrs([]); }}>Import from spreadsheet</button>
      </div>

      {mode === 'one' ? (
        <>
          <div className="grid-fields">
            <label className="field" htmlFor="pt-staff">Staff member
              <select id="pt-staff" value={e.staff_id} onChange={(x) => setE({ ...e, staff_id: x.target.value })}>
                <option value="">Choose…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.active ? '' : ' (deactivated)'}</option>)}
              </select></label>
            <label className="field" htmlFor="pt-title" style={{ gridColumn: 'span 2' }}>Training
              <input id="pt-title" value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} placeholder="e.g. AML/CFT annual briefing" list="pt-titles" />
              <datalist id="pt-titles">{[...new Set(data.modules.map((m) => m.title).concat(data.past.map((p) => p.title)))].map((t) => <option key={t} value={t} />)}</datalist></label>
            <label className="field" htmlFor="pt-date">Date it took place<input id="pt-date" type="date" max={today} value={e.completed_on} onChange={(x) => setE({ ...e, completed_on: x.target.value })} /></label>
            <label className="field" htmlFor="pt-hours">Hours<input id="pt-hours" type="number" min={0} step={0.5} value={e.hours} onChange={(x) => setE({ ...e, hours: x.target.value })} /></label>
            <label className="field" htmlFor="pt-result">Result
              <select id="pt-result" value={e.result} onChange={(x) => setE({ ...e, result: x.target.value as Entry['result'] })}>
                <option value="completed">Attended / completed</option><option value="pass">Assessed: pass</option><option value="fail">Assessed: fail</option>
              </select></label>
            {e.result !== 'completed' && <label className="field" htmlFor="pt-score">Score % (optional)<input id="pt-score" type="number" min={0} max={100} value={e.score} onChange={(x) => setE({ ...e, score: x.target.value })} /></label>}
            <label className="field" htmlFor="pt-by">Delivered by (optional)<input id="pt-by" value={e.delivered_by} onChange={(x) => setE({ ...e, delivered_by: x.target.value })} placeholder="e.g. Compliance Officer, MAMSB" /></label>
            <label className="field" htmlFor="pt-notes" style={{ gridColumn: '1 / -1' }}>Notes (optional)<input id="pt-notes" value={e.notes} onChange={(x) => setE({ ...e, notes: x.target.value })} placeholder="e.g. Attendance sheet kept in compliance file 2024" /></label>
          </div>
          <label className="field" htmlFor="pt-file">Evidence (optional): attendance sheet, certificate or quiz paper. PDF, JPG or PNG, up to 10 MB.
            <input id="pt-file" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(x) => setFile(x.target.files?.[0] ?? null)} style={{ minHeight: 0, padding: 8 }} /></label>
          {errs.length > 0 && <div className="err">{errs.map((x) => <div key={x}>{x}</div>)}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn primary" disabled={busy} onClick={saveOne}>{busy ? 'Saving…' : 'Save record'}</button>
          </div>
        </>
      ) : (
        <>
          <p className="small muted">One row per person per training, in this column order: <span className="mono">{CSV_HEADER}</span>. Dates as 2024-05-10 or 10/05/2024 (day first). Result is completed, pass or fail; score, delivered_by and notes may be left empty. Usernames are shown on the Staff page.</p>
          <label className="field" htmlFor="pt-csv">Paste CSV<textarea id="pt-csv" className="code" spellCheck={false} value={csv} onChange={(x) => setCsv(x.target.value)} placeholder={CSV_HEADER} /></label>
          {errs.length > 0 && <div className="err">{errs.map((x) => <div key={x}>{x}</div>)}</div>}
          <div className="row">
            <button type="button" className="btn primary" disabled={busy} onClick={importCsv}>{busy ? 'Importing…' : 'Import records'}</button>
            <button type="button" className="btn" onClick={() => downloadText('past-training-template.csv', `${CSV_HEADER}\n${staff[0]?.username ?? 'jna.chew'},AML/CFT annual briefing,15/03/2024,2,completed,,Compliance Officer,Attendance sheet in 2024 file\n`)}>Download template</button>
          </div>
          <p className="small muted">Evidence files can be attached when recording one at a time.</p>
        </>
      )}
    </section>
  );
}
