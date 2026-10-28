import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fmt, fmtH } from '../../lib/logic';
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

  const reached = Math.max(maxPage, page);
  const go = (p: number) => setPage(Math.min(Math.max(p, 1), pages));

  return (
    <>
      <div><Link className="link small" to="/">← My training</Link></div>
      <div className="spread">
        <div><h1>{m.title}</h1><p className="small muted" style={{ marginTop: 2 }}><span className="mono">{cv.label}</span> · {fmtH(m.duration_hours)} session · {pages} pages</p></div>
      </div>
      <div className="viewer">
        <div className="pagelist" aria-label="Pages">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} type="button" aria-current={page === i + 1} disabled={i + 1 > reached + 1}
              title={i + 1 > reached + 1 ? 'Read the pages in order' : undefined} onClick={() => go(i + 1)}>{i + 1}</button>
          ))}
        </div>
        <div className="stage">
          <PdfViewer src={url} page={page} />
          <div className="spread" style={{ alignItems: 'center' }}>
            <div className="row">
              <button type="button" className="btn" disabled={page <= 1} onClick={() => go(page - 1)}>Previous</button>
              <button type="button" className="btn primary" disabled={page >= pages} onClick={() => go(page + 1)}>Next page</button>
            </div>
            <span className="mono small muted">Page {page} / {pages}</span>
          </div>
        </div>
        <aside className="sidepanel">
          <div className="panel pad stack" style={{ gap: 10 }}>
            <h3>Your progress</h3>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <div className="progress"><i style={{ width: `${(Math.min(reached, pages) / pages) * 100}%` }} /></div>
              <span className="mono small muted">{Math.min(reached, pages)} / {pages}</span>
            </div>
            <button type="button" className="btn primary block" disabled={!canStart} onClick={() => nav(`/learn/${m.id}/quiz`)}>{done ? 'Already passed' : 'Start assessment'}</button>
            <p className="small muted">
              {done ? 'You can still read the material any time.'
                : fails >= m.max_attempts ? `Locked after ${m.max_attempts} failed attempts. Please see the compliance officer.`
                : readEnough ? `${m.per_attempt} questions · pass mark ${m.pass_mark}% · attempt ${fails + 1} of ${m.max_attempts}`
                : 'Unlocks after you reach the last page.'}
            </p>
          </div>
          <div className="panel pad stack" style={{ gap: 6 }}>
            <h3>About this module</h3>
            <p className="small muted">{m.duration_hours ? `Completing it adds ${fmtH(m.duration_hours)} to your training record.` : 'Completing it is added to your training record.'}{a ? ` Due ${fmt(a.due_on)}.` : ''}</p>
          </div>
        </aside>
      </div>
    </>
  );
}
