import { useEffect, useState } from 'react';
import { useAdmin } from '../../lib/data';
import { errText, rpc, supabase } from '../../lib/supabase';
import type { BnmLevel, JobRole } from '../../lib/types';
import { useToast } from '../../components/Toast';

export const BNM_LEVELS: [BnmLevel, string, string][] = [
  ['senior', 'Director and Senior Management', 'e.g. CEO'],
  ['middle', 'Middle Management', 'e.g. Manager, Compliance Officer'],
  ['support', 'Support staff', 'e.g. Front line officer'],
];

interface Row extends JobRole { orig: string | null }

/** The list of job roles, each mapped to a BNM level for the STE report. */
export default function JobRoles() {
  const { data, reload } = useAdmin();
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setRows(data.jobRoles.map((r) => ({ ...r, orig: r.name }))); }, [data]);
  if (!data || !rows) return null;
  const count = (name: string | null) => data.people.filter((p) => p.active && p.role === 'staff' && p.job_role === name).length;
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const dirty = JSON.stringify(rows.map(({ orig, ...r }) => ({ ...r, orig }))) !== JSON.stringify(data.jobRoles.map((r) => ({ ...r, orig: r.name })));

  const save = async () => {
    const names = rows.map((r) => r.name.trim());
    if (names.some((n) => !n)) { toast('Every job role needs a name', true); return; }
    const dup = names.find((n, i) => names.findIndex((x) => x.toLowerCase() === n.toLowerCase()) !== i);
    if (dup) { toast(`“${dup}” is listed twice`, true); return; }
    setBusy(true);
    try {
      for (const [i, r] of rows.entries()) {
        const name = r.name.trim();
        if (r.orig === null) {
          const { error } = await supabase.from('job_roles').insert({ name, bnm_level: r.bnm_level, active: r.active, sort: i + 1 });
          if (error) throw error;
          continue;
        }
        if (name !== r.orig) await rpc('rename_job_role', { p_old: r.orig, p_new: name });
        const { error } = await supabase.from('job_roles').update({ bnm_level: r.bnm_level, active: r.active, sort: i + 1 }).eq('name', name);
        if (error) throw error;
      }
      toast('Job roles saved');
      await reload();
    } catch (e) {
      const m = errText(e);
      toast(m.includes('job_roles') || m.includes('rename_job_role') ? 'This needs the latest database update (0005). See the README.' : m, true);
    } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <p className="small muted" style={{ maxWidth: 760 }}>The job roles you can give staff. Each has a BNM level, used to count staff by level in the Staff Training Expenditure report. Renaming a role updates everyone who has it. A retired role can’t be given to new staff, but people who already have it keep it.</p>
      <section className="panel">
        <div className="tablebox"><table>
          <thead><tr><th>Job role</th><th>BNM level (for the STE report)</th><th>Active staff</th><th /></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.orig ?? `new-${i}`} style={r.active ? undefined : { background: 'var(--surface-2)' }}>
              <td><input aria-label="Job role name" value={r.name} disabled={!r.active} onChange={(e) => set(i, { name: e.target.value })} style={{ minWidth: 180 }} />
                {!r.active && <span className="pill plain" style={{ marginLeft: 8 }}>Retired</span>}</td>
              <td><select aria-label="BNM level" value={r.bnm_level} onChange={(e) => set(i, { bnm_level: e.target.value as BnmLevel })}>
                {BNM_LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
              <td>{count(r.orig)}</td>
              <td>{r.orig === null
                ? <button type="button" className="link" onClick={() => setRows(rows.filter((_, k) => k !== i))}>Remove</button>
                : <button type="button" className="link" style={r.active ? { color: 'var(--muted)' } : undefined} onClick={() => set(i, { active: !r.active })}>{r.active ? 'Retire' : 'Restore'}</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="pad row">
          <button type="button" className="btn" onClick={() => setRows([...rows, { name: '', bnm_level: 'support', active: true, sort: rows.length + 1, orig: null }])}>+ Add job role</button>
          <span style={{ flex: 1 }} />
          {dirty && <button type="button" className="btn" disabled={busy} onClick={() => setRows(data.jobRoles.map((r) => ({ ...r, orig: r.name })))}>Undo changes</button>}
          <button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </section>
    </div>
  );
}
