import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAdmin } from '../../../lib/data';
import { fmt, fmtH } from '../../../lib/logic';
import { DEFAULT_ACTIVITIES, actHours, fyLabel, fyStart, hourlyRate, isDelivery, money, monthlyCost, totalHours, trainerAmount } from '../../../lib/ste';
import { errText, supabase } from '../../../lib/supabase';
import type { SteActivity, SteTrainer } from '../../../lib/types';
import { useToast } from '../../../components/Toast';
import { useSte } from './useSte';

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;
type Draft = Omit<SteTrainer, 'id'> & { id: string | null };
const r1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** In-house trainer cost, S 7.2(b)(iv): hourly rate × hours on structured training, backed by recorded sessions. */
export default function SteTrainerPage() {
  const { id } = useParams();
  const { d, err, reload } = useSte(id);
  const { data } = useAdmin();
  const toast = useToast();
  const [sel, setSel] = useState<string | null>(null);
  const [w, setW] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!d || w) return;
    const t = d.trainers.find((x) => x.id === sel) ?? d.trainers[0];
    if (t) { setSel(t.id); setW({ ...t, activities: t.activities?.length ? t.activities : DEFAULT_ACTIVITIES }); }
  }, [d, sel, w]);

  if (err) return <div className="panel pad stack"><div className="err">{err}</div><Link className="link" to="/admin/ste">← Training expenditure</Link></div>;
  if (!d || !data) return <p className="muted">Loading…</p>;
  const y = d.year; const locked = y.status === 'submitted'; const start = fyStart(y.fy_end);
  const sessions = data.sessions.filter((s) => s.held_on >= start && s.held_on <= y.fy_end).sort((a, b) => (a.held_on < b.held_on ? -1 : 1));
  const staffList = data.people.filter((p) => p.role === 'staff' || p.role === 'admin');

  const startNew = () => {
    const co = data.people.find((p) => p.active && p.job_role === 'Compliance officer');
    const guess = (name: string) => sessions.filter((s) => s.delivered_by && (s.delivered_by.toLowerCase().includes(name.toLowerCase()) || /compliance/i.test(s.delivered_by))).map((s) => s.id);
    setSel(null);
    setW({ id: null, year_id: y.id, staff_id: co?.id ?? null, trainer_name: co?.full_name ?? '', trainer_role: co?.job_role ?? 'Compliance officer', monthly_salary: 0, monthly_allowances: 0, monthly_epf: 0, hours_per_month: 176, activities: DEFAULT_ACTIVITIES, session_ids: guess(co?.full_name ?? '') });
  };
  const open = (t: SteTrainer) => { setSel(t.id); setW({ ...t, activities: t.activities?.length ? t.activities : DEFAULT_ACTIVITIES }); };

  const setAct = (i: number, patch: Partial<SteActivity>) => w && setW({ ...w, activities: w.activities.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
  const chosen = w ? sessions.filter((s) => w.session_ids.includes(s.id)) : [];
  const chosenHours = chosen.reduce((s, x) => s + (Number(x.hours) || 0), 0);
  const delivery = w ? w.activities.filter(isDelivery).reduce((s, a) => s + actHours(a), 0) : 0;

  const save = async () => {
    if (!w) return;
    if (!w.trainer_name.trim()) { toast('Enter the trainer’s name', true); return; }
    if (!(w.hours_per_month > 0)) { toast('Enter the working hours per month', true); return; }
    setBusy(true);
    try {
      const row = {
        year_id: y.id, staff_id: w.staff_id, trainer_name: w.trainer_name.trim(), trainer_role: w.trainer_role?.trim() || null,
        monthly_salary: w.monthly_salary, monthly_allowances: w.monthly_allowances, monthly_epf: w.monthly_epf, hours_per_month: w.hours_per_month,
        activities: w.activities.filter((a) => a.name.trim()), session_ids: w.session_ids, updated_at: new Date().toISOString(),
      };
      let tid = w.id;
      if (tid) { const { error } = await supabase.from('ste_trainers').update(row).eq('id', tid); if (error) throw error; }
      else { const { data: ins, error } = await supabase.from('ste_trainers').insert(row).select('id').single(); if (error) throw error; tid = ins.id; }
      const full = { ...w, ...row, id: tid! } as SteTrainer;
      const desc = `${full.trainer_name}${full.trainer_role ? `, ${full.trainer_role}` : ''}: in-house training, ${r1(totalHours(full))} h × RM${money(hourlyRate(full))}`;
      const exp = { year_id: y.id, spent_on: y.fy_end, category: 'b_iv', description: desc, amount: trainerAmount(full), trainer_id: tid };
      const { data: have } = await supabase.from('ste_expenses').select('id').eq('trainer_id', tid).maybeSingle();
      const { error: e2 } = have ? await supabase.from('ste_expenses').update(exp).eq('id', have.id) : await supabase.from('ste_expenses').insert(exp);
      if (e2) throw e2;
      toast(`Saved. RM${money(full ? trainerAmount(full) : 0)} recorded under (b)(iv).`);
      setW(null); setSel(tid); await reload();
    } catch (e) { toast(errText(e), true); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!w?.id || !window.confirm(`Remove the worksheet for ${w.trainer_name}? Its amount is removed from (b)(iv).`)) return;
    setBusy(true);
    try { const { error } = await supabase.from('ste_trainers').delete().eq('id', w.id); if (error) throw error; toast('Worksheet removed'); setW(null); setSel(null); await reload(); }
    catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };

  const ro = locked;
  return (
    <>
      <div><Link className="link small" to={`/admin/ste/${y.id}`}>← {fyLabel(y.fy_end)}</Link></div>
      <div className="spread"><div><h1>In-house trainer cost · {fyLabel(y.fy_end)}</h1>
        <p className="muted small" style={{ marginTop: 4, maxWidth: 760 }}>S 7.2(b)(iv): salaries, allowances and the employer’s EPF for staff whose functions include conducting structured training as a significant part of their responsibilities. The amount is the hourly cost × the hours spent on training work. Only admins can see these figures.</p></div>
        {!ro && <button type="button" className="btn" onClick={startNew}>+ Add trainer</button>}</div>
      {locked && <div className="note">This year has been submitted and is locked. Reopen it on the year page to make changes.</div>}

      {d.trainers.length > 1 && (
        <div className="tabs" role="tablist">{d.trainers.map((t) => <button key={t.id} type="button" role="tab" aria-selected={sel === t.id && !!w?.id} onClick={() => open(t)}>{t.trainer_name}</button>)}</div>
      )}

      {!w ? (
        <div className="panel pad stack"><p className="muted">No trainer worksheet for this year yet.</p>{!ro && <div><button type="button" className="btn primary" onClick={startNew}>+ Add trainer</button></div>}</div>
      ) : (
        <>
          <section className="panel pad stack">
            <h2>Trainer and hourly rate</h2>
            <div className="grid-fields">
              <label className="field" htmlFor="tr-who">Trainer
                <select id="tr-who" disabled={ro} value={w.staff_id ?? ''} onChange={(e) => { const p = data.people.find((x) => x.id === e.target.value); setW({ ...w, staff_id: p?.id ?? null, trainer_name: p?.full_name ?? w.trainer_name, trainer_role: p?.job_role ?? w.trainer_role }); }}>
                  <option value="">Someone not on the staff list</option>
                  {staffList.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.job_role}{p.active ? '' : ' (former staff)'}</option>)}
                </select></label>
              {!w.staff_id && <label className="field" htmlFor="tr-name">Name<input id="tr-name" disabled={ro} value={w.trainer_name} onChange={(e) => setW({ ...w, trainer_name: e.target.value })} /></label>}
              <label className="field" htmlFor="tr-role">Designation<input id="tr-role" disabled={ro} value={w.trainer_role ?? ''} onChange={(e) => setW({ ...w, trainer_role: e.target.value })} /></label>
              <label className="field" htmlFor="tr-sal">Monthly basic salary (RM)<input id="tr-sal" disabled={ro} inputMode="decimal" value={w.monthly_salary || ''} onChange={(e) => setW({ ...w, monthly_salary: num(e.target.value) })} /></label>
              <label className="field" htmlFor="tr-all">Fixed allowances / month (RM)<input id="tr-all" disabled={ro} inputMode="decimal" value={w.monthly_allowances || ''} onChange={(e) => setW({ ...w, monthly_allowances: num(e.target.value) })} /></label>
              <label className="field" htmlFor="tr-epf">Employer EPF / month (RM)<input id="tr-epf" disabled={ro} inputMode="decimal" value={w.monthly_epf || ''} onChange={(e) => setW({ ...w, monthly_epf: num(e.target.value) })} /></label>
              <label className="field" htmlFor="tr-hpm">Working hours / month<input id="tr-hpm" disabled={ro} inputMode="decimal" value={w.hours_per_month || ''} onChange={(e) => setW({ ...w, hours_per_month: num(e.target.value) })} /></label>
            </div>
            <div className="note">Monthly cost RM{money(monthlyCost(w))} ÷ {w.hours_per_month || 0} hours = <b>RM{money(hourlyRate(w as SteTrainer))} per hour</b></div>
          </section>

          <section className="panel">
            <div className="pad"><h2>Training activities</h2><p className="small muted" style={{ marginTop: 4 }}>Time spent on structured training work during the year. Annual hours = number of times × hours each time.</p></div>
            <div className="tablebox"><table className="acttable">
              <thead><tr><th style={{ minWidth: 190 }}>Activity</th><th style={{ width: 120 }}>Frequency</th><th className="num" style={{ width: 90 }}>Times / year</th><th className="num" style={{ width: 90 }}>Hours each</th><th className="num" style={{ width: 90 }}>Annual hours</th><th style={{ minWidth: 260 }}>Justification</th>{!ro && <th />}</tr></thead>
              <tbody>
                {w.activities.map((a, i) => (
                  <tr key={i}>
                    <td><input aria-label="Activity" disabled={ro} value={a.name} onChange={(e) => setAct(i, { name: e.target.value })} /></td>
                    <td><input aria-label="Frequency" disabled={ro} value={a.frequency} onChange={(e) => setAct(i, { frequency: e.target.value })} /></td>
                    <td><input aria-label="Times per year" disabled={ro} inputMode="decimal" style={{ textAlign: 'right' }} value={a.sessions || ''} onChange={(e) => setAct(i, { sessions: num(e.target.value) })} /></td>
                    <td><input aria-label="Hours each" disabled={ro} inputMode="decimal" style={{ textAlign: 'right' }} value={a.hours || ''} onChange={(e) => setAct(i, { hours: num(e.target.value) })} /></td>
                    <td className="num">{r1(actHours(a))}</td>
                    <td><textarea aria-label="Justification" disabled={ro} value={a.justification} onChange={(e) => setAct(i, { justification: e.target.value })} />
                      {isDelivery(a) && <div style={{ marginTop: 4 }}>{chosenHours >= actHours(a) - 0.001
                        ? <span className="pill ok">Matches the app: {chosen.length} session{chosen.length === 1 ? '' : 's'} recorded, {fmtH(chosenHours)}</span>
                        : <span className="pill warn">The app has {chosen.length} session{chosen.length === 1 ? '' : 's'} ({fmtH(chosenHours)}) ticked below</span>}</div>}</td>
                    {!ro && <td><button type="button" className="link small" style={{ color: 'var(--bad-ink)' }} onClick={() => setW({ ...w, activities: w.activities.filter((_, k) => k !== i) })}>Remove</button></td>}
                  </tr>
                ))}
                <tr><td colSpan={4}><b>Total hours</b></td><td className="num"><b>{r1(totalHours(w as SteTrainer))}</b></td><td colSpan={ro ? 1 : 2} /></tr>
              </tbody>
            </table></div>
            {!ro && <div className="pad" style={{ paddingTop: 12 }}><button type="button" className="btn slim" onClick={() => setW({ ...w, activities: [...w.activities, { name: '', frequency: '', sessions: 1, hours: 1, justification: '' }] })}>+ Add activity</button></div>}
          </section>

          <section className="panel pad stack">
            <div><h2>Sessions delivered in {fyLabel(y.fy_end)}</h2><p className="small muted" style={{ marginTop: 4 }}>Tick the past sessions this person delivered. Their hours back up the “Delivery” activity, so the figure you report matches the attendance records.</p></div>
            {!sessions.length ? <p className="small muted">No past sessions are recorded for this year. Record them under Past sessions.</p> : (
              <div className="stack" style={{ gap: 4 }}>{sessions.map((s) => (
                <label key={s.id} className="check" htmlFor={`ts-${s.id}`} style={{ minHeight: 36 }}>
                  <input id={`ts-${s.id}`} type="checkbox" disabled={ro} checked={w.session_ids.includes(s.id)} onChange={(e) => setW({ ...w, session_ids: e.target.checked ? [...w.session_ids, s.id] : w.session_ids.filter((x) => x !== s.id) })} />
                  <span>{fmt(s.held_on)} · <b>{s.title}</b> · {fmtH(s.hours)}{s.delivered_by ? <span className="muted"> · delivered by {s.delivered_by}</span> : null}</span>
                </label>
              ))}</div>
            )}
            {delivery > chosenHours + 0.001 && <p className="small" style={{ color: 'var(--warn-ink)' }}>Delivery is {r1(delivery)} h, but the ticked sessions add up to {r1(chosenHours)} h. Either record the missing sessions or reduce the delivery hours.</p>}
          </section>

          <div className="panel pad spread" style={{ alignItems: 'center' }}>
            <span>{r1(totalHours(w as SteTrainer))} h × RM{money(hourlyRate(w as SteTrainer))} = <b className="mono">RM{money(trainerAmount(w as SteTrainer))}</b> → recorded under <b>(b)(iv)</b></span>
            {!ro && <div className="row">{w.id && <button type="button" className="btn danger" disabled={busy} onClick={remove}>Remove worksheet</button>}<button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>}
          </div>
        </>
      )}
    </>
  );
}
