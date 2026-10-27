import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fmtH } from '../../lib/logic';
import { errText, rpc, signedUrl } from '../../lib/supabase';
import { PdfViewer } from '../../components/PdfViewer';
import { useToast } from '../../components/Toast';
import { useStaffData } from './Home';

export default function Learn() {
  const { id } = useParams();
  const { d, err } = useStaffData();
  const nav = useNavigate();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [url, setUrl] = useState<string | null>(null);
  const [maxPage, setMaxPage] = useState(0);

  const m = d?.modules.find((x) => x.id === id);
  const cv = d?.versions.find((v) => v.module_id === id);
  const a = d && m ? d.ledger.asg(d.me.id, m.id) : undefined;

  useEffect(() => {
    if (!d || !a) return;
    setMaxPage(d.progress.find((p) => p.assignment_id === a.id)?.max_page ?? 0);
  }, [d, a]);
  useEffect(() => {
    if (cv?.file_path) signedUrl(cv.file_path).then(setUrl).catch((e) => toast(errText(e), true));
  }, [cv?.file_path, toast]);
  useEffect(() => {
    if (!m || !a || page <= maxPage) return;
    rpc<number>('record_progress', { p_module: m.id, p_page: page }).then((n) => setMaxPage(n)).catch(() => {});
  }, [page, m, a, maxPage]);

  if (err) return <div className="err">{err}</div>;
  if (!d) return <p className="muted">Loading…</p>;
  if (!m || !cv || !a) return <div className="panel pad">This module is not assigned to you. <Link className="link" to="/">Back to my training</Link></div>;

  const pages = cv.page_count ?? 1;
  const done = d.ledger.done(d.me.id, m);
  const fails = d.ledger.failsNow(d.me.id, m);
  const readEnough = !m.require_read || Math.max(maxPage, page) >= pages;
  const canStart = readEnough && !done && fails < m.max_attempts;

  return (
    <>
      <div><Link className="link small" to="/">← My training</Link></div>
      <div><h1>{m.title}</h1><p className="small muted" style={{ marginTop: 2 }}><span className="mono">{cv.label}</span> · {fmtH(m.duration_hours)} session</p></div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <div className="progress"><i style={{ width: `${(page / pages) * 100}%` }} /></div>
        <span className="mono small muted">{page} / {pages}</span>
      </div>
      <PdfViewer src={url} page={page} />
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <button type="button" className="btn block" disabled={page <= 1} onClick={() => { setPage(page - 1); window.scrollTo({ top: 0 }); }}>Previous</button>
        <button type="button" className="btn block" disabled={page >= pages} onClick={() => { setPage(page + 1); window.scrollTo({ top: 0 }); }}>Next page</button>
      </div>
      <div className="panel pad stack" style={{ gap: 8 }}>
        <button type="button" className="btn primary block" disabled={!canStart} onClick={() => nav(`/learn/${m.id}/quiz`)}>{done ? 'Already passed' : 'Start assessment'}</button>
        <p className="small muted" style={{ textAlign: 'center' }}>
          {done ? 'You can still read the material any time.'
            : fails >= m.max_attempts ? `Locked after ${m.max_attempts} failed attempts. Please see the compliance officer.`
            : readEnough ? `${m.per_attempt} questions · pass mark ${m.pass_mark}% · attempt ${fails + 1} of ${m.max_attempts}`
            : 'Unlocks after you reach the last page'}
        </p>
      </div>
    </>
  );
}
