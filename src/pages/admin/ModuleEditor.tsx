import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAdmin } from '../../lib/data';
import { downloadText, parseCSV } from '../../lib/logic';
import { errText, rpc, signedUrl, supabase } from '../../lib/supabase';
import { countPages } from '../../lib/pdf';
import type { Cycle, Question } from '../../lib/types';
import { PdfViewer } from '../../components/PdfViewer';
import { useToast } from '../../components/Toast';
import { QuestionView } from './ModuleDetail';

const L = 'ABCD';
const CSV_HEADER = 'question,option_a,option_b,option_c,option_d,correct,source_page';

interface Draft {
  title: string; label: string; cycle: Cycle; refresher_months: number; duration_hours: string; due_days: number;
  per_attempt: number; pass_mark: number; max_attempts: number; require_read: boolean;
  file_path: string | null; file_name: string | null; page_count: number | null; orig_pages: number | null;
  questions: Question[]; assign: string[]; change: 'correction' | 'version'; note: string; retake: boolean;
}

const blank = (staffIds: string[]): Draft => ({
  title: '', label: 'v1.0', cycle: 'fixed', refresher_months: 12, duration_hours: '2', due_days: 14, per_attempt: 5, pass_mark: 80, max_attempts: 3,
  require_read: true, file_path: null, file_name: null, page_count: null, orig_pages: null, questions: [], assign: staffIds, change: 'correction', note: '', retake: true,
});

function nextLabel(p: string) {
  const m = p.match(/^v?(\d+)(?:\.(\d+))?$/);
  return m ? `v${m[1]}.${Number(m[2] ?? 0) + 1}` : `${p}-r2`;
}

function QuestionForm({ q, i, onSave, onCancel }: { q: Question; i: number; onSave: (q: Question) => void; onCancel: () => void }) {
  const [f, setF] = useState<Question>({ ...q, options: q.options.slice() });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="q editing">
      <h3>Question {i + 1}</h3>
      <label className="field" htmlFor={`qe-q-${i}`}>Question<textarea id={`qe-q-${i}`} value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} /></label>
      <div className="grid-fields">
        {f.options.map((o, k) => (
          <label key={k} className="field" htmlFor={`qe-o${k}-${i}`}>Option {L[k]}
            <input id={`qe-o${k}-${i}`} value={o} onChange={(e) => { const opts = f.options.slice(); opts[k] = e.target.value; setF({ ...f, options: opts }); }} />
          </label>
        ))}
      </div>
      <div className="grid-fields">
        <label className="field" htmlFor={`qe-a-${i}`}>Correct answer
          <select id={`qe-a-${i}`} value={f.correct} onChange={(e) => setF({ ...f, correct: Number(e.target.value) })}>{[0, 1, 2, 3].map((k) => <option key={k} value={k}>{L[k]}</option>)}</select>
        </label>
        <label className="field" htmlFor={`qe-p-${i}`}>Source page
          <input id={`qe-p-${i}`} type="number" min={1} value={f.source_page} onChange={(e) => setF({ ...f, source_page: Math.max(1, Number(e.target.value) || 1) })} />
        </label>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="row">
        <button type="button" className="btn primary" onClick={() => {
          if (!f.prompt.trim() || f.options.some((o) => !o.trim())) return setErr('Fill in the question and all four options.');
          onSave({ ...f, prompt: f.prompt.trim(), options: f.options.map((o) => o.trim()), approved: true });
        }}>Save question</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function ModuleEditor() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { data, ledger, reload, currentVersion } = useAdmin();
  const nav = useNavigate();
  const toast = useToast();
  const m = editing ? data?.modules.find((x) => x.id === id) : undefined;
  const cv = m ? currentVersion(m.id) : undefined;
  const activeStaff = ledger?.staff().filter((s) => s.active) ?? [];

  const [d, setD] = useState<Draft | null>(editing ? null : blank(activeStaff.map((s) => s.id)));
  const [preview, setPreview] = useState<string | ArrayBuffer | null>(null);
  const [page, setPage] = useState(1);
  const [qEdit, setQEdit] = useState<number | null>(null);
  const [csv, setCsv] = useState('');
  const [csvErr, setCsvErr] = useState<string[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing || !m || !cv || d) return;
    (async () => {
      const { data: qs, error: e } = await supabase.from('questions').select('prompt,options,correct,source_page,approved').eq('version_id', cv.id).order('position');
      if (e) { toast(e.message, true); return; }
      setD({
        title: m.title, label: cv.label, cycle: m.cycle, refresher_months: m.refresher_months, duration_hours: String(m.duration_hours), due_days: m.due_days,
        per_attempt: m.per_attempt, pass_mark: m.pass_mark, max_attempts: m.max_attempts, require_read: m.require_read,
        file_path: cv.file_path, file_name: cv.file_name, page_count: cv.page_count, orig_pages: cv.page_count,
        questions: (qs ?? []) as Question[], assign: [], change: data?.attempts.some((a) => a.version_id === cv.id) ? 'version' : 'correction', note: '', retake: true,
      });
      if (cv.file_path) signedUrl(cv.file_path).then(setPreview).catch(() => {});
    })();
  }, [editing, m, cv, d, data, toast]);

  if (!data || !ledger) return null;
  if (editing && (!m || !cv)) return <div className="panel pad">Module not found. <Link className="link" to="/admin">Back to modules</Link></div>;
  if (!d) return <p className="muted">Loading…</p>;

  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const published = m?.status === 'published';
  const used = cv ? data.attempts.filter((a) => a.version_id === cv.id).length : 0;
  const pending = d.questions.filter((q) => !q.approved).length;
  const approved = d.questions.length - pending;
  const badPages = d.page_count ? d.questions.filter((q) => q.source_page > (d.page_count as number)).length : 0;
  const needsAll = (publish: boolean) => publish || published;
  const blocker = (publish: boolean) =>
    !d.title.trim() ? 'Add a title' : uploading ? 'Wait for the upload' : !d.file_path ? 'Upload the PDF' : qEdit !== null ? 'Finish editing the question'
      : needsAll(publish) && pending ? `${pending} to review` : needsAll(publish) && approved < d.per_attempt ? `Need ${d.per_attempt} approved questions` : null;

  const onFile = async (file: File) => {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { toast('Upload a PDF. In PowerPoint, use File → Save As → PDF.', true); return; }
    if (file.size > 50 * 1024 * 1024) { toast('That file is larger than 50 MB.', true); return; }
    setUploading('Reading the PDF…');
    try {
      const buf = await file.arrayBuffer();
      const pages = await countPages(file);
      setUploading(`Uploading ${pages} pages…`);
      const path = `${m?.id ?? 'new'}/${crypto.randomUUID()}.pdf`;
      const { error: e } = await supabase.storage.from('materials').upload(path, file, { contentType: 'application/pdf', upsert: false });
      if (e) throw e;
      setD((prev) => prev && ({ ...prev, file_path: path, file_name: file.name, page_count: pages, title: prev.title || file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ') }));
      setPreview(buf); setPage(1);
    } catch (e) { toast(errText(e), true); }
    finally { setUploading(null); }
  };

  const importCsv = () => {
    const rows = parseCSV(csv); const errs: string[] = []; const out: Question[] = [];
    rows.forEach((r, k) => {
      if (k === 0 && r[0].trim().toLowerCase() === 'question') return;
      if (r.length < 7) { errs.push(`Row ${k + 1}: expected 7 columns, found ${r.length}.`); return; }
      const a = L.indexOf(r[5].trim().toUpperCase());
      if (a < 0) { errs.push(`Row ${k + 1}: "correct" must be A, B, C or D.`); return; }
      if (!r[0].trim() || r.slice(1, 5).some((x) => !x.trim())) { errs.push(`Row ${k + 1}: the question or an option is empty.`); return; }
      out.push({ prompt: r[0].trim(), options: r.slice(1, 5).map((x) => x.trim()), correct: a, source_page: Math.max(1, parseInt(r[6]) || 1), approved: false });
    });
    if (!rows.length) errs.push('Paste at least one question row first.');
    setCsvErr(errs);
    if (out.length) { set({ questions: d.questions.concat(out) }); setCsv(''); toast(`${out.length} questions imported. Review each before saving.`); }
  };

  const save = async (publish: boolean) => {
    setSaving(true); setError(null);
    try {
      const mid = await rpc<string>('save_module', {
        p: {
          module_id: m?.id ?? null, publish, change: published ? d.change : 'correction', note: d.note, retake: d.retake, assign: publish && !editing ? d.assign : [],
          module: { title: d.title.trim(), cycle: d.cycle, refresher_months: d.refresher_months, duration_hours: Number(d.duration_hours) || 0, due_days: d.due_days,
            per_attempt: d.per_attempt, pass_mark: d.pass_mark, max_attempts: d.max_attempts, require_read: d.require_read },
          version: { label: d.label, file_path: d.file_path, file_name: d.file_name, page_count: d.page_count },
          questions: d.questions,
        },
      });
      await reload();
      toast(publish ? 'Module published' : published ? (d.change === 'version' ? `Published ${nextLabel(cv!.label)}` : 'Correction saved') : 'Draft saved');
      nav(`/admin/modules/${mid}`);
    } catch (e) { setError(errText(e)); }
    finally { setSaving(false); }
  };

  const num = (v: string, lo: number, hi: number, dflt: number) => Math.max(lo, Math.min(hi, Number(v) || dflt));
  const roles = [...new Set(activeStaff.map((s) => s.job_role))];

  return (
    <>
      <div><Link className="link small" to={m ? `/admin/modules/${m.id}` : '/admin'}>← {m ? m.title : 'Modules'}</Link></div>
      <div><h1>{editing ? 'Edit module' : 'New module'}</h1>
        <p className="muted small" style={{ marginTop: 4 }}>{editing ? 'Fix the details, replace the PDF or change questions. Nothing changes for staff until you save.' : 'Upload the PDF, add the questions you wrote elsewhere, review them, then publish.'}</p></div>

      <section className="panel pad stack"><h2><span className="step">1</span>Details</h2>
        <div className="grid-fields">
          <label className="field" style={{ gridColumn: '1/-1' }} htmlFor="d-title">Module title
            <input id="d-title" value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Sanctions Screening" /></label>
          {editing ? <div className="field">Version<span className="mono" style={{ fontWeight: 400, fontSize: 15, padding: '10px 0' }}>{d.label}</span></div>
            : <label className="field" htmlFor="d-label">Version<input id="d-label" value={d.label} onChange={(e) => set({ label: e.target.value })} /></label>}
          <label className="field" htmlFor="d-dur">Session duration (hours)
            <input id="d-dur" type="number" min={0} step={0.5} value={d.duration_hours} onChange={(e) => set({ duration_hours: e.target.value })} /></label>
          <label className="field" htmlFor="d-cycle">Refresher
            <select id="d-cycle" value={d.cycle} onChange={(e) => set({ cycle: e.target.value as Cycle })}>
              <option value="fixed">Yearly, fixed deadline for everyone</option>
              <option value="rolling">12 months after each person passes</option>
              <option value="none">One-off, no refresher</option>
            </select></label>
        </div>
        <p className="small muted">Session duration is entered by you and credited as training hours when someone passes.</p>
      </section>

      <section className="panel pad stack"><h2><span className="step">2</span>Training material (PDF)</h2>
        {uploading ? <div className="note">{uploading}</div> : d.file_path ? (
          <div className="filecard">
            <div className="ico">PDF</div>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}><b style={{ overflowWrap: 'anywhere' }}>{d.file_name}</b><div className="small muted">{d.page_count} pages</div></div>
            <label className="btn" htmlFor="d-file2">Replace file<input id="d-file2" type="file" accept="application/pdf,.pdf" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
          </div>
        ) : (
          <div className="dropzone">
            <b>Upload a PDF</b>
            <span className="small muted">From PowerPoint, use File → Save As → PDF. Staff see every page exactly as it looks in the file. Up to 50 MB.</span>
            <label className="btn" htmlFor="d-file">Choose PDF<input id="d-file" type="file" accept="application/pdf,.pdf" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
          </div>
        )}
        {editing && d.orig_pages && d.page_count && d.page_count !== d.orig_pages && (
          <div className="warnbox">The new file has {d.page_count} pages; the old one had {d.orig_pages}. Check that each question’s source page still points to the right page.</div>
        )}
        {preview && d.file_path && !uploading && (
          <details>
            <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Preview pages</summary>
            <div className="stack" style={{ marginTop: 12 }}>
              <PdfViewer src={preview} page={page} />
              <div className="row">
                <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <button type="button" className="btn" disabled={page >= (d.page_count ?? 1)} onClick={() => setPage(page + 1)}>Next</button>
                <span className="mono small muted">Page {page} / {d.page_count}</span>
              </div>
            </div>
          </details>
        )}
      </section>

      <section className="panel pad stack"><h2><span className="step">3</span>Question bank</h2>
        <p className="small muted">Write questions anywhere, for example in a chat with Claude, using this column order: <span className="mono">{CSV_HEADER}</span>. “correct” is A, B, C or D. Or add and edit them one at a time below.</p>
        <label className="field" htmlFor="d-csv">Paste CSV
          <textarea id="d-csv" className="code" spellCheck={false} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={CSV_HEADER} /></label>
        <div className="row">
          <button type="button" className="btn primary" onClick={importCsv}>Import questions</button>
          <button type="button" className="btn" onClick={() => downloadText('question-template.csv', CSV_HEADER + '\nWhat must you do before completing a transaction?,Nothing,Customer due diligence,Ask a colleague,Call the bank,B,1\n')}>Download CSV template</button>
          <button type="button" className="btn" disabled={qEdit !== null} onClick={() => { set({ questions: d.questions.concat({ prompt: '', options: ['', '', '', ''], correct: 0, source_page: 1, approved: false }) }); setQEdit(d.questions.length); }}>+ Add a question</button>
        </div>
        {csvErr.length > 0 && <div className="err">{csvErr.map((e) => <div key={e}>{e}</div>)}</div>}
        {badPages > 0 && <div className="warnbox">{badPages} question{badPages === 1 ? ' cites' : 's cite'} a page beyond the last page of the PDF.</div>}
        {d.questions.length > 0 && (
          <div className="row small"><b>{d.questions.length} in the bank</b><span className="pill ok">{approved} approved</span>{pending > 0 && <span className="pill warn">{pending} to review</span>}
            {pending > 1 && <button type="button" className="link small" onClick={() => set({ questions: d.questions.map((q) => ({ ...q, approved: true })) })}>Approve all {pending} after reviewing</button>}
          </div>
        )}
        {d.questions.map((q, i) => qEdit === i ? (
          <QuestionForm key={i} q={q} i={i}
            onSave={(nq) => { const qs = d.questions.slice(); qs[i] = nq; set({ questions: qs }); setQEdit(null); }}
            onCancel={() => { if (!q.prompt) set({ questions: d.questions.filter((_, k) => k !== i) }); setQEdit(null); }} />
        ) : (
          <QuestionView key={i} q={q} i={i} actions={
            <div className="row">
              {!q.approved && <button type="button" className="btn primary" onClick={() => { const qs = d.questions.slice(); qs[i] = { ...q, approved: true }; set({ questions: qs }); }}>Approve</button>}
              <button type="button" className="btn" disabled={qEdit !== null} onClick={() => setQEdit(i)}>Edit</button>
              <button type="button" className="btn danger" onClick={() => set({ questions: d.questions.filter((_, k) => k !== i) })}>Remove</button>
            </div>
          } />
        ))}
      </section>

      <section className="panel pad stack"><h2><span className="step">4</span>Assessment rules</h2>
        <div className="grid-fields">
          <label className="field" htmlFor="d-per">Questions per attempt<input id="d-per" type="number" min={1} max={100} value={d.per_attempt} onChange={(e) => set({ per_attempt: num(e.target.value, 1, 100, 5) })} /></label>
          <label className="field" htmlFor="d-pass">Pass mark (%)<input id="d-pass" type="number" min={1} max={100} value={d.pass_mark} onChange={(e) => set({ pass_mark: num(e.target.value, 1, 100, 80) })} /></label>
          <label className="field" htmlFor="d-max">Attempts allowed<input id="d-max" type="number" min={1} max={20} value={d.max_attempts} onChange={(e) => set({ max_attempts: num(e.target.value, 1, 20, 3) })} /></label>
          <label className="field" htmlFor="d-due">Complete within (days)<input id="d-due" type="number" min={1} max={365} value={d.due_days} onChange={(e) => set({ due_days: num(e.target.value, 1, 365, 14) })} /></label>
        </div>
        <label className="check" htmlFor="d-read"><input id="d-read" type="checkbox" checked={d.require_read} onChange={(e) => set({ require_read: e.target.checked })} /> Staff must reach the last page before starting the assessment</label>
      </section>

      {editing && published && (
        <section className="panel pad stack"><h2><span className="step">5</span>What kind of change is this?</h2>
          {used > 0 && <p className="small muted">{used} attempt{used === 1 ? '' : 's'} already recorded on {d.label}.</p>}
          <label className="check top" htmlFor="ct-c"><input type="radio" id="ct-c" name="ct" checked={d.change === 'correction'} onChange={() => set({ change: 'correction' })} />
            <span><b>Correction</b>, keeps {d.label}. For typos, a wrong file uploaded, or a wrong answer key. The fix is logged in Versions.</span></label>
          <label className="check top" htmlFor="ct-v"><input type="radio" id="ct-v" name="ct" checked={d.change === 'version'} onChange={() => set({ change: 'version' })} />
            <span><b>New version</b>, becomes {nextLabel(d.label)}. For changed content, such as a policy update. Past results stay linked to {d.label}.</span></label>
          {d.change === 'correction'
            ? <label className="field" htmlFor="d-note">What did you fix?<input id="d-note" value={d.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. Replaced a file uploaded in error" /></label>
            : <>
                <label className="field" htmlFor="d-note2">What changed? (optional)<input id="d-note2" value={d.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. Updated for the new AML/CFT policy" /></label>
                <label className="check" htmlFor="d-retake"><input type="checkbox" id="d-retake" checked={d.retake} onChange={(e) => set({ retake: e.target.checked })} /> Ask everyone assigned to retake {nextLabel(d.label)} within {d.due_days} days</label>
              </>}
        </section>
      )}

      {!editing && (
        <section className="panel pad stack"><h2><span className="step">5</span>Assign to staff when published</h2>
          {activeStaff.length === 0 ? <p className="small muted">No staff accounts yet. You can assign the module later from its Assigned tab.</p> : <>
            <div className="row"><span className="small muted">Quick select:</span>
              <button type="button" className="btn" onClick={() => set({ assign: activeStaff.map((s) => s.id) })}>All staff</button>
              {roles.map((r) => <button key={r} type="button" className="btn" onClick={() => set({ assign: activeStaff.filter((s) => s.job_role === r).map((s) => s.id) })}>{r}</button>)}
              <button type="button" className="btn" onClick={() => set({ assign: [] })}>Clear</button>
            </div>
            <div className="stack" style={{ gap: 0 }}>
              {activeStaff.map((s) => (
                <label key={s.id} className="check" htmlFor={`da-${s.id}`}>
                  <input type="checkbox" id={`da-${s.id}`} checked={d.assign.includes(s.id)} onChange={(e) => set({ assign: e.target.checked ? d.assign.concat(s.id) : d.assign.filter((x) => x !== s.id) })} />
                  <span>{s.full_name} <span className="small muted">· {s.job_role}</span></span>
                </label>
              ))}
            </div>
          </>}
        </section>
      )}

      {error && <div className="err" role="alert">{error}</div>}
      <div className="spread" style={{ alignItems: 'center' }}>
        <span className="small muted">{published ? 'Saving records you as the person who made the change, with the date.' : 'Publishing records you as reviewer, with the date and version.'}</span>
        <div className="row">
          <Link className="btn" to={m ? `/admin/modules/${m.id}` : '/admin'}>Cancel</Link>
          {published ? (
            <button type="button" className="btn primary" disabled={saving || !!blocker(false)} onClick={() => save(false)}>{saving ? 'Saving…' : blocker(false) ? `Save · ${blocker(false)}` : 'Save changes'}</button>
          ) : (
            <>
              <button type="button" className="btn" disabled={saving || !!blocker(false)} onClick={() => save(false)}>{saving ? 'Saving…' : 'Save draft'}</button>
              <button type="button" className="btn primary" disabled={saving || !!blocker(true)} onClick={() => save(true)}>{blocker(true) ? `Publish · ${blocker(true)}` : editing ? 'Save and publish' : `Publish${d.assign.length ? ` and assign ${d.assign.length}` : ''}`}</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
