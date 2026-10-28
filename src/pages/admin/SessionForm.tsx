import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdmin } from '../../lib/data';
import { downloadText, fmtH, parseCSV, todayMY } from '../../lib/logic';
import { errText, rpc, supabase } from '../../lib/supabase';
import { useToast } from '../../components/Toast';
import { AddFiles, EVIDENCE_EXT, EVIDENCE_MB, PendingFiles, READING_EXT, READING_MB, checkFile, uploadFile, type Uploaded } from '../../components/Files';

type Result = 'completed' | 'pass' | 'fail';
interface Att { key: string; staff_id: string; result: Result; score: string; paper: File | null }
const CSV_HEAD = 'username,result,score';
let seq = 0;
const newAtt = (staff_id = '', assessed = false): Att => ({ key: `a${++seq}`, staff_id, result: assessed ? 'pass' : 'completed', score: '', paper: null });

/** Record a training session held before or outside the system, with its materials, evidence and each attendee's result. */
export default function SessionForm() {
  const { data, ledger, reload } = useAdmin();
  const toast = useToast();
  const nav = useNavigate();
  const today = todayMY();
  const [title, setTitle] = useState('');
  const [heldOn, setHeldOn] = useState('');
  const [hours, setHours] = useState('2');
  const [by, setBy] = useState('');
  const [assessed, setAssessed] = useState(false);
  const [passMark, setPassMark] = useState('70');
  const [notes, setNotes] = useState('');
  const [materials, setMaterials] = useState<File[]>([]);
  const [evidence, setEvidence] = useState<File[]>([]);
  const [atts, setAtts] = useState<Att[]>([newAtt()]);
  const [mode, setMode] = useState<'pick' | 'csv'>('pick');
  const [csv, setCsv] = useState('');
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  if (!data || !ledger) return null;

  const staff = ledger.staff();
  const active = staff.filter((s) => s.active);
  const pm = Number(passMark);
  const hasPm = assessed && passMark.trim() !== '' && pm >= 0 && pm <= 100;
  const setAtt = (key: string, patch: Partial<Att>) => setAtts(atts.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  const autoResult = (score: string, cur: Result): Result => (hasPm && score.trim() !== '' ? (Number(score) >= pm ? 'pass' : 'fail') : cur);
  const filled = atts.filter((a) => a.staff_id);
  const nPass = filled.filter((a) => a.result === 'pass').length;
  const nFail = filled.filter((a) => a.result === 'fail').length;

  const switchAssessed = (v: boolean) => {
    setAssessed(v);
    setAtts(atts.map((a) => ({ ...a, result: v ? (a.result === 'completed' ? 'pass' : a.result) : 'completed', score: v ? a.score : '', paper: v ? a.paper : null })));
  };
  const addAll = () => {
    const have = new Set(atts.map((a) => a.staff_id));
    const extra = active.filter((s) => !have.has(s.id)).map((s) => newAtt(s.id, assessed));
    setAtts([...atts.filter((a) => a.staff_id), ...extra]);
    if (!extra.length) toast('Everyone active is already listed');
  };

  const importCsv = () => {
    const rows = parseCSV(csv); const problems: string[] = []; const out: Att[] = [];
    rows.forEach((r, k) => {
      if (k === 0 && (r[0] || '').trim().toLowerCase() === 'username') return;
      const n = k + 1; const u = (r[0] || '').trim().toLowerCase();
      if (!u) return;
      const who = staff.find((s) => s.username === u);
      if (!who) { problems.push(`Row ${n}: no staff with username "${u}".`); return; }
      const raw = (r[1] || '').trim().toLowerCase();
      const score = (r[2] || '').trim();
      if (score && (isNaN(Number(score)) || Number(score) < 0 || Number(score) > 100)) { problems.push(`Row ${n}: score must be a number from 0 to 100.`); return; }
      let res: Result;
      if (!assessed) res = 'completed';
      else if (raw === 'pass' || raw === 'fail') res = raw;
      else if (!raw && hasPm && score) res = Number(score) >= pm ? 'pass' : 'fail';
      else { problems.push(`Row ${n}: result must be pass or fail${hasPm ? ' (or leave it empty and give a score)' : ''}.`); return; }
      out.push({ ...newAtt(who.id, assessed), result: res, score: assessed ? score : '' });
    });
    if (!out.length && !problems.length) problems.push('Paste at least one row first.');
    setErrs(problems);
    if (problems.length) return;
    const ids = new Set(out.map((a) => a.staff_id));
    setAtts([...atts.filter((a) => a.staff_id && !ids.has(a.staff_id)), ...out]);
    setCsv(''); setMode('pick');
    toast(`${out.length} attendee${out.length === 1 ? '' : 's'} added from the spreadsheet`);
  };

  const save = async () => {
    const problems: string[] = [];
    if (!title.trim()) problems.push('Enter the name of the training.');
    if (!heldOn) problems.push('Enter the date the session was held.');
    else if (heldOn > today) problems.push('The session date cannot be in the future.');
    if (!(Number(hours) >= 0)) problems.push('Hours must be a number.');
    if (!filled.length) problems.push('Add at least one attendee.');
    const ids = filled.map((a) => a.staff_id);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    if (dup.length) problems.push(`${[...new Set(dup)].map((x) => staff.find((s) => s.id === x)?.full_name).join(', ')} ${new Set(dup).size === 1 ? 'is' : 'are'} listed twice.`);
    if (assessed) filled.forEach((a) => { if (a.score && (Number(a.score) < 0 || Number(a.score) > 100)) problems.push(`${staff.find((s) => s.id === a.staff_id)?.full_name}: score must be 0 to 100.`); });
    setErrs(problems);
    if (problems.length) { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); return; }

    const uploaded: { bucket: 'readings' | 'evidence'; path: string }[] = [];
    try {
      const folder = `sessions/${crypto.randomUUID()}`;
      const files: (Uploaded & { kind: 'material' | 'evidence' })[] = [];
      let i = 0; const total = materials.length + evidence.length + filled.filter((a) => a.paper).length;
      const step = () => setBusy(`Uploading files (${++i} of ${total})…`);
      for (const f of materials) { step(); const u = await uploadFile('readings', folder, f); uploaded.push({ bucket: 'readings', path: u.file_path }); files.push({ ...u, kind: 'material' }); }
      for (const f of evidence) { step(); const u = await uploadFile('evidence', folder, f); uploaded.push({ bucket: 'evidence', path: u.file_path }); files.push({ ...u, kind: 'evidence' }); }
      const attendees: { staff_id: string; result: Result; score: string; paper_path: string; paper_name: string }[] = [];
      for (const a of filled) {
        let paper: Uploaded | null = null;
        if (a.paper) { step(); paper = await uploadFile('evidence', `${folder}/papers`, a.paper); uploaded.push({ bucket: 'evidence', path: paper.file_path }); }
        attendees.push({ staff_id: a.staff_id, result: a.result, score: assessed ? a.score.trim() : '', paper_path: paper?.file_path ?? '', paper_name: paper?.file_name ?? '' });
      }
      setBusy('Saving…');
      const id = await rpc<string>('save_session', { p: {
        title: title.trim(), held_on: heldOn, hours: Number(hours) || 0, delivered_by: by.trim(), assessed,
        pass_mark: hasPm ? Math.round(pm) : null, notes: notes.trim(), files, attendees,
      } });
      await reload();
      toast(`Session saved: ${attendees.length} training record${attendees.length === 1 ? '' : 's'} added`);
      nav(`/admin/sessions/${id}`);
    } catch (e) {
      // Nothing was saved, so tidy up any files that did upload.
      for (const b of ['readings', 'evidence'] as const) {
        const ps = uploaded.filter((u) => u.bucket === b).map((u) => u.path);
        if (ps.length) await supabase.storage.from(b).remove(ps);
      }
      const msg = errText(e);
      setErrs([msg.includes('save_session') ? 'This needs the latest database update (0004). See the README.' : msg]);
    } finally { setBusy(''); }
  };

  const titles = [...new Set(data.modules.map((m) => m.title).concat(data.past.map((p) => p.title)))];

  return (
    <>
      <div><Link className="link small" to="/admin/sessions">← Past sessions</Link></div>
      <div>
        <h1>Record a past training session</h1>
        <p className="muted small" style={{ marginTop: 4, maxWidth: 760 }}>For a classroom session or briefing held before this system, or outside it. Enter what actually happened, on the date it happened. Each attendee gets a training record marked “Recorded” with your name and today’s date. A saved session can’t be edited; if something is wrong, remove it and record it again.</p>
      </div>

      <section className="panel pad stack">
        <h2 className="row" style={{ gap: 0 }}><span className="sectionnum">1</span>Session details</h2>
        <div className="grid-fields">
          <label className="field" htmlFor="ss-title" style={{ gridColumn: 'span 2' }}>Training
            <input id="ss-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. AML/CFT annual briefing 2024" list="ss-titles" />
            <datalist id="ss-titles">{titles.map((t) => <option key={t} value={t} />)}</datalist></label>
          <label className="field" htmlFor="ss-date">Date held<input id="ss-date" type="date" max={today} value={heldOn} onChange={(e) => setHeldOn(e.target.value)} /></label>
          <label className="field" htmlFor="ss-hours">Hours<input id="ss-hours" type="number" min={0} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} /></label>
          <label className="field" htmlFor="ss-by">Delivered by<input id="ss-by" value={by} onChange={(e) => setBy(e.target.value)} placeholder="e.g. Compliance Officer, external trainer" /></label>
          <label className="field" htmlFor="ss-assess">Was there an assessment?
            <select id="ss-assess" value={assessed ? 'yes' : 'no'} onChange={(e) => switchAssessed(e.target.value === 'yes')}>
              <option value="no">No, attendance only</option><option value="yes">Yes, a quiz or test</option>
            </select></label>
          {assessed && <label className="field" htmlFor="ss-pm">Pass mark used (%)<input id="ss-pm" type="number" min={0} max={100} value={passMark} onChange={(e) => setPassMark(e.target.value)} /></label>}
          <label className="field" htmlFor="ss-notes" style={{ gridColumn: '1 / -1' }}>Notes (optional)<input id="ss-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Held at HQ meeting room. Original attendance sheet in compliance file 2024." /></label>
        </div>
        {assessed && <p className="small muted">The pass mark is stored with the session, so the record shows the standard that applied at the time.</p>}
      </section>

      <section className="panel pad stack">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 320px' }}>
            <h2 className="row" style={{ gap: 0 }}><span className="sectionnum">2</span>Slides and training materials used</h2>
            <p className="small muted" style={{ marginTop: 4 }}>The slides, handouts or notes from the session. Attendees can download them from My records. PDF, Word, Excel or PowerPoint, up to {READING_MB} MB each.</p>
          </div>
          <AddFiles label="+ Add materials" exts={READING_EXT} maxMb={READING_MB} onFiles={(f) => setMaterials([...materials, ...f])} disabled={!!busy} />
        </div>
        <PendingFiles files={materials} onRemove={(i) => setMaterials(materials.filter((_, k) => k !== i))} />
      </section>

      <section className="panel pad stack">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 320px' }}>
            <h2 className="row" style={{ gap: 0 }}><span className="sectionnum">3</span>Evidence <span className="pill plain" style={{ marginLeft: 8 }}>Admins only</span></h2>
            <p className="small muted" style={{ marginTop: 4 }}>The signed attendance sheet, and if there was a quiz, the question paper and answer key. Staff never see these. PDF, JPG or PNG, up to {EVIDENCE_MB} MB each.</p>
          </div>
          <AddFiles label="+ Add evidence" exts={EVIDENCE_EXT} maxMb={EVIDENCE_MB} onFiles={(f) => setEvidence([...evidence, ...f])} disabled={!!busy} />
        </div>
        <PendingFiles files={evidence} onRemove={(i) => setEvidence(evidence.filter((_, k) => k !== i))} />
      </section>

      <section className="panel stack" style={{ gap: 0 }}>
        <div className="pad stack" style={{ paddingBottom: 12 }}>
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 320px' }}>
              <h2 className="row" style={{ gap: 0 }}><span className="sectionnum">4</span>Attendees and results</h2>
              <p className="small muted" style={{ marginTop: 4 }}>{assessed ? `Enter each person’s actual result. Typing a score sets Pass or Fail from the pass mark; you can change it. A marked paper is optional and admins only.` : 'Everyone listed is recorded as Attended. Only list people who were actually there.'}</p>
            </div>
          </div>
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'pick'} onClick={() => { setMode('pick'); setErrs([]); }}>Choose staff</button>
            <button type="button" role="tab" aria-selected={mode === 'csv'} onClick={() => { setMode('csv'); setErrs([]); }}>Paste from spreadsheet</button>
          </div>
        </div>

        {mode === 'pick' ? (
          <>
            <div className="tablebox" style={{ borderTop: '1px solid var(--line)' }}>
              <table className="attendees">
                <thead><tr><th style={{ minWidth: 220 }}>Staff</th><th style={{ width: 150 }}>Result</th>{assessed && <th style={{ width: 110 }}>Score %</th>}{assessed && <th>Marked paper (optional)</th>}<th style={{ width: 90 }} /></tr></thead>
                <tbody>
                  {atts.map((a) => (
                    <tr key={a.key}>
                      <td><select aria-label="Staff member" value={a.staff_id} onChange={(e) => setAtt(a.key, { staff_id: e.target.value })} style={{ width: '100%' }}>
                        <option value="">Choose…</option>
                        {staff.map((s) => <option key={s.id} value={s.id} disabled={s.id !== a.staff_id && atts.some((x) => x.staff_id === s.id)}>{s.full_name} · {s.job_role}{s.active ? '' : ' (deactivated)'}</option>)}
                      </select></td>
                      <td>{assessed ? (
                        <select aria-label="Result" value={a.result} onChange={(e) => setAtt(a.key, { result: e.target.value as Result })}>
                          <option value="pass">Pass</option><option value="fail">Fail</option>
                        </select>) : <span className="pill ok">Attended</span>}</td>
                      {assessed && <td><input aria-label="Score" type="number" min={0} max={100} value={a.score} style={{ width: 90 }}
                        onChange={(e) => setAtt(a.key, { score: e.target.value, result: autoResult(e.target.value, a.result) })} /></td>}
                      {assessed && <td>{a.paper ? <span className="row small" style={{ gap: 8 }}><span style={{ overflowWrap: 'anywhere' }}>{a.paper.name}</span><button type="button" className="link" onClick={() => setAtt(a.key, { paper: null })}>Remove</button></span>
                        : <input type="file" aria-label="Marked paper" accept={EVIDENCE_EXT.map((x) => `.${x}`).join(',')} style={{ minHeight: 0, padding: 4, maxWidth: 220 }}
                            onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const bad = checkFile(f, EVIDENCE_EXT, EVIDENCE_MB); if (bad) { toast(bad, true); e.target.value = ''; return; } setAtt(a.key, { paper: f }); }} />}</td>}
                      <td><button type="button" className="link" style={{ color: 'var(--bad-ink)' }} onClick={() => setAtts(atts.length > 1 ? atts.filter((x) => x.key !== a.key) : [newAtt('', assessed)])}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pad row" style={{ paddingTop: 12 }}>
              <button type="button" className="btn" onClick={() => setAtts([...atts, newAtt('', assessed)])}>+ Add attendee</button>
              <button type="button" className="btn" onClick={addAll}>Add all active staff ({active.length})</button>
            </div>
          </>
        ) : (
          <div className="pad stack" style={{ borderTop: '1px solid var(--line)' }}>
            <p className="small muted">One row per person, in this column order: <span className="mono">{CSV_HEAD}</span>. {assessed ? `Result is pass or fail${hasPm ? '; leave it empty to work it out from the score and the pass mark' : ''}.` : 'This session has no assessment, so result and score are ignored and everyone is recorded as Attended.'} Usernames are on the Staff page. Rows are added to the list, where you can check them before saving.</p>
            <label className="field" htmlFor="ss-csv">Paste CSV<textarea id="ss-csv" className="code" spellCheck={false} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={CSV_HEAD} /></label>
            <div className="row">
              <button type="button" className="btn primary" onClick={importCsv}>Add to the list</button>
              <button type="button" className="btn" onClick={() => downloadText('session-attendees-template.csv', `${CSV_HEAD}\n${active.slice(0, 3).map((s, i) => `${s.username},${assessed ? (i === 2 ? 'fail' : 'pass') : ''},${assessed ? (i === 2 ? 55 : 85) : ''}`).join('\n') || 'jna.chew,pass,85'}\n`)}>Download template</button>
            </div>
          </div>
        )}

        {errs.length > 0 && <div className="pad" style={{ paddingTop: 0 }}><div className="err">{errs.map((x) => <div key={x}>{x}</div>)}</div></div>}
        <div className="formfoot">
          <span className="small muted">{filled.length} attendee{filled.length === 1 ? '' : 's'}{assessed ? ` · ${nPass} pass · ${nFail} fail` : ''} · {fmtH(Number(hours) || 0)} each · {materials.length} material{materials.length === 1 ? '' : 's'} · {evidence.length} evidence file{evidence.length === 1 ? '' : 's'}</span>
          <div className="row">
            <Link className="btn" to="/admin/sessions">Cancel</Link>
            <button type="button" className="btn primary" disabled={!!busy} onClick={save}>{busy || `Save session (${filled.length} record${filled.length === 1 ? '' : 's'})`}</button>
          </div>
        </div>
      </section>
    </>
  );
}
