import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fmtH } from '../../lib/logic';
import { errText, rpc } from '../../lib/supabase';

interface QQ { id: string; prompt: string; options: string[] }
interface Started { attempt_id: string; attempt_no: number; max_attempts: number; pass_mark: number; questions: QQ[] }
interface ReviewItem { question_id: string; prompt: string; options: string[]; correct: number; chosen: number; source_page: number }
interface Result { score: number; passed: boolean; correct: number; total: number; pass_mark: number; hours: number; review: ReviewItem[]; error?: string }

const shuffle = (n: number) => { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export default function Quiz() {
  const { id } = useParams();
  const nav = useNavigate();
  const [s, setS] = useState<Started | null>(null);
  const [orders, setOrders] = useState<number[][]>([]);
  const [i, setI] = useState(0);
  const [ans, setAns] = useState<Record<string, number>>({});
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    rpc<Started>('start_attempt', { p_module: id })
      .then((r) => { setS(r); setOrders(r.questions.map((q) => shuffle(q.options.length))); })
      .catch((e) => setErr(errText(e)));
  }, [id]);

  if (err) return (
    <div className="panel pad stack">
      <div className="err" role="alert">{err}</div>
      <Link className="btn" to={`/learn/${id}`}>Back to the material</Link>
    </div>
  );

  if (res) {
    const left = s ? s.max_attempts - s.attempt_no : 0;
    return (
      <>
        <div className="panel pad stack" style={{ textAlign: 'center', alignItems: 'center' }}>
          <span className={`pill ${res.passed ? 'ok' : 'bad'}`}>{res.passed ? 'Passed' : 'Not passed'}</span>
          <div className="score">{res.score}%</div>
          <p className="muted small">{res.correct} of {res.total} correct · pass mark {res.pass_mark}%</p>
          <p className="small">{res.passed ? `Your result${Number(res.hours) ? ` and ${fmtH(res.hours)} of training have` : ' has'} been added to your record.`
            : left <= 0 ? 'You have used all your attempts. Please see the compliance officer.' : `Review the material and try again. ${left} attempt${left === 1 ? '' : 's'} left.`}</p>
        </div>
        {res.review.length > 0 && (
          <div className="panel pad stack">
            <h2>Review your answers</h2>
            {res.review.map((q) => (
              <div key={q.question_id} className="review">
                <b>{q.prompt}</b>
                <span className="small">Correct answer: {q.options[q.correct]}</span>
                <span className="small muted">See page {q.source_page}</span>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          {!res.passed && left > 0 && <Link className="btn block" to={`/learn/${id}`}>Review material</Link>}
          <Link className="btn primary block" to="/">Back to my training</Link>
        </div>
      </>
    );
  }

  if (!s) return <p className="muted">Preparing your questions…</p>;
  const q = s.questions[i];
  const last = i === s.questions.length - 1;
  const submit = async () => {
    setBusy(true);
    try {
      const r = await rpc<Result>('submit_attempt', { p_attempt: s.attempt_id, p_answers: ans });
      if (r.error) { setErr(r.error); return; }
      setRes(r); window.scrollTo({ top: 0 });
    } catch (e) { setErr(errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="spread" style={{ alignItems: 'center' }}>
        <button type="button" className="link small" onClick={() => { if (window.confirm('Leave the assessment? You can come back to the same questions later.')) nav(`/learn/${id}`); }}>← Leave</button>
        <span className="small muted">Attempt {s.attempt_no} of {s.max_attempts}</span>
      </div>
      <div className="segbar" aria-hidden="true">{s.questions.map((_, k) => <i key={k} className={k <= i ? 'on' : ''} />)}</div>
      <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <legend className="mono small" style={{ color: 'var(--accent)', padding: 0, marginBottom: 6 }}>QUESTION {i + 1} OF {s.questions.length}</legend>
        <p style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.35, marginBottom: 6 }}>{q.prompt}</p>
        {orders[i]?.map((k) => (
          <label key={k} className="answer" htmlFor={`ans-${i}-${k}`}>
            <input type="radio" id={`ans-${i}-${k}`} name={`ans-${i}`} checked={ans[q.id] === k} onChange={() => setAns({ ...ans, [q.id]: k })} />
            <span>{q.options[k]}</span>
          </label>
        ))}
      </fieldset>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <button type="button" className="btn block" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
        {last
          ? <button type="button" className="btn primary block" disabled={busy || s.questions.some((x) => ans[x.id] === undefined)} onClick={submit}>{busy ? 'Submitting…' : 'Submit answers'}</button>
          : <button type="button" className="btn primary block" disabled={ans[q.id] === undefined} onClick={() => setI(i + 1)}>Next question</button>}
      </div>
    </>
  );
}
