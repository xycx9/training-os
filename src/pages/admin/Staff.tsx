import { useState } from 'react';
import { useAdmin } from '../../lib/data';
import { fmt, fmtH, tempPassword, todayMY } from '../../lib/logic';
import { adminUsers, APP_NAME, errText, rpc } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import type { Profile } from '../../lib/types';
import { useToast } from '../../components/Toast';


interface NewStaff { full_name: string; username: string; role: 'staff' | 'admin'; job_role: string; joined_on: string; password: string; mods: string[]; due_days: number }

function Credentials({ name, username, password, onClose }: { name: string; username: string; password: string; onClose: () => void }) {
  const toast = useToast();
  const text = `${APP_NAME} sign-in for ${name}\nWebsite: ${window.location.origin}\nUsername: ${username}\nTemporary password: ${password}\nYou will be asked to choose your own password.`;
  return (
    <section className="panel pad stack" style={{ borderColor: 'var(--accent)' }} aria-live="polite">
      <h2>Give these details to {name}</h2>
      <div className="note mono" style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{`Username: ${username}\nTemporary password: ${password}`}</div>
      <p className="small muted">They choose their own password the first time they sign in. This temporary password is not shown again.</p>
      <div className="row">
        <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Select the text and copy it', true))}>Copy</button>
        <button type="button" className="btn primary" onClick={onClose}>Done</button>
      </div>
    </section>
  );
}

export default function Staff() {
  const { data, ledger, reload } = useAdmin();
  const { profile: me } = useAuth();
  const toast = useToast();
  const [n, setN] = useState<NewStaff | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ name: string; username: string; password: string } | null>(null);
  const [resetFor, setResetFor] = useState<Profile | null>(null);
  const [editFor, setEditFor] = useState<Profile | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [delFor, setDelFor] = useState<Profile | null>(null);
  const [typed, setTyped] = useState('');
  if (!data || !ledger) return null;
  const published = ledger.published();
  const recordCount = (id: string) => data.attempts.filter((a) => a.staff_id === id).length + data.past.filter((p) => p.staff_id === id).length;
  const setActive = async (s: Profile, active: boolean) => {
    setBusy(true);
    try { await adminUsers({ action: 'set_active', user_id: s.id, active }); toast(active ? `${s.full_name} reactivated` : `${s.full_name} deactivated; records kept`); setDelFor(null); await reload(); }
    catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  const doDelete = async (s: Profile) => {
    setBusy(true);
    try { await adminUsers({ action: 'delete', user_id: s.id }); toast(`${s.full_name} deleted`); setDelFor(null); setTyped(''); await reload(); }
    catch (e) { toast(errText(e), true); } finally { setBusy(false); }
  };
  const delCount = delFor ? recordCount(delFor.id) : 0;

  const startAdd = () => { setErr(null); setCreds(null); setN({ full_name: '', username: '', role: 'staff', job_role: data.jobRoles.find((r) => r.active && r.bnm_level === 'support')?.name ?? data.jobRoles.find((r) => r.active)?.name ?? 'Teller', joined_on: todayMY(), password: tempPassword(), mods: published.map((m) => m.id), due_days: 14 }); };
  const suggestUser = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 32);

  const create = async () => {
    if (!n) return;
    setBusy(true); setErr(null);
    try {
      const res = await adminUsers({ action: 'create', ...n, module_ids: n.role === 'staff' ? n.mods : [] });
      if (res.warning) toast(res.warning, true);
      setCreds({ name: n.full_name, username: n.username, password: n.password });
      setN(null);
      await reload();
    } catch (e) { setErr(errText(e)); }
    finally { setBusy(false); }
  };

  const people = data.people.filter((p) => showInactive || p.active);
  const inactiveCount = data.people.filter((p) => !p.active).length;

  return (
    <>
      <div className="spread">
        <div><h1>Staff</h1><p className="muted small" style={{ marginTop: 4 }}>Create sign-ins, add new joiners, remove dummy accounts and make sure everyone has every module they need.</p></div>
        {!n && <button type="button" className="btn primary" onClick={startAdd}>+ Add staff</button>}
      </div>

      {creds && <Credentials {...creds} onClose={() => setCreds(null)} />}

      {n && (
        <section className="panel pad stack" aria-label="Add staff">
          <h2>Add staff</h2>
          <div className="grid-fields">
            <label className="field" htmlFor="ns-name">Full name
              <input id="ns-name" value={n.full_name} onChange={(e) => setN({ ...n, full_name: e.target.value, username: n.username && n.username !== suggestUser(n.full_name) ? n.username : suggestUser(e.target.value) })} /></label>
            <label className="field" htmlFor="ns-user">Username
              <input id="ns-user" autoCapitalize="none" spellCheck={false} value={n.username} onChange={(e) => setN({ ...n, username: e.target.value.toLowerCase().replace(/\s+/g, '') })} /></label>
            <label className="field" htmlFor="ns-type">Account type
              <select id="ns-type" value={n.role} onChange={(e) => setN({ ...n, role: e.target.value as 'staff' | 'admin' })}><option value="staff">Staff (takes training)</option><option value="admin">Admin (manages training)</option></select></label>
            {n.role === 'staff' && <label className="field" htmlFor="ns-role">Job role
              <select id="ns-role" value={n.job_role} onChange={(e) => setN({ ...n, job_role: e.target.value })}>{data.jobRoles.filter((r) => r.active).map((r) => <option key={r.name}>{r.name}</option>)}</select></label>}
            <label className="field" htmlFor="ns-joined">Joined on<input id="ns-joined" type="date" value={n.joined_on} onChange={(e) => setN({ ...n, joined_on: e.target.value })} /></label>
            <label className="field" htmlFor="ns-pass">Temporary password
              <span className="row" style={{ flexWrap: 'nowrap' }}><input id="ns-pass" className="mono" style={{ flex: 1 }} value={n.password} onChange={(e) => setN({ ...n, password: e.target.value })} />
                <button type="button" className="btn slim" onClick={() => setN({ ...n, password: tempPassword() })}>New</button></span></label>
          </div>
          <p className="small muted">Usernames use lowercase letters, numbers, dots or dashes. Nobody needs an email address.</p>
          {n.role === 'staff' && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="spread" style={{ alignItems: 'center' }}><h3>Training to assign</h3>
                <div className="row"><button type="button" className="btn slim" onClick={() => setN({ ...n, mods: published.map((m) => m.id) })}>Select all</button><button type="button" className="btn slim" onClick={() => setN({ ...n, mods: [] })}>Clear</button></div></div>
              <p className="small muted">Every published module is selected, so a new joiner catches up on training the rest of the team has already completed.</p>
              {published.length === 0 && <p className="small muted">No published modules yet.</p>}
              <div className="stack" style={{ gap: 0 }}>
                {published.map((m) => (
                  <label key={m.id} className="check" htmlFor={`ns-${m.id}`}>
                    <input type="checkbox" id={`ns-${m.id}`} checked={n.mods.includes(m.id)} onChange={(e) => setN({ ...n, mods: e.target.checked ? n.mods.concat(m.id) : n.mods.filter((x) => x !== m.id) })} />
                    <span>{m.title} <span className="small muted">· {fmtH(m.duration_hours)}</span></span>
                  </label>
                ))}
              </div>
              <label className="field" htmlFor="ns-due" style={{ width: 200 }}>Complete within (days)<input id="ns-due" type="number" min={1} max={365} value={n.due_days} onChange={(e) => setN({ ...n, due_days: Math.max(1, Math.min(365, Number(e.target.value) || 14)) })} /></label>
            </div>
          )}
          {err && <div className="err" role="alert">{err}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setN(null)}>Cancel</button>
            <button type="button" className="btn primary" disabled={busy || !n.full_name.trim() || !n.username || n.password.length < 8} onClick={create}>
              {busy ? 'Creating…' : n.role === 'staff' ? `Create account and assign ${n.mods.length} module${n.mods.length === 1 ? '' : 's'}` : 'Create admin account'}
            </button>
          </div>
        </section>
      )}

      {delFor && (delCount === 0 ? (
        <section className="panel pad stack" style={{ border: '2px solid var(--bad-ink)' }} aria-live="polite">
          <h2>Delete {delFor.full_name}?</h2>
          <p className="small">This permanently removes the account <b className="mono">{delFor.username}</b> and its sign-in. It has <b>no training records</b>, so nothing is lost from your evidence. This cannot be undone.</p>
          <label className="field" htmlFor="del-type"><span>Type <span className="mono">DELETE</span> to confirm</span>
            <input id="del-type" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => { setDelFor(null); setTyped(''); }}>Cancel</button>
            <button type="button" className="btn" style={{ background: 'var(--bad-ink)', borderColor: 'var(--bad-ink)', color: '#fff' }} disabled={busy || typed !== 'DELETE'} onClick={() => doDelete(delFor)}>{busy ? 'Deleting…' : 'Delete permanently'}</button>
          </div>
        </section>
      ) : (
        <section className="panel pad stack" style={{ border: '2px solid var(--warn-ink)' }} aria-live="polite">
          <h2>{delFor.full_name} has training records</h2>
          <p className="small">This account has <b>{delCount} training record{delCount === 1 ? '' : 's'}</b>. Deleting it would erase that evidence, so it can't be deleted. {delFor.active ? <><b>Deactivate</b> it instead: they can no longer sign in, they disappear from lists and assignments, and their records stay available for examiners.</> : 'It is already deactivated, so their records are kept and they cannot sign in.'}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setDelFor(null)}>Close</button>
            {delFor.active && <button type="button" className="btn primary" disabled={busy} onClick={() => setActive(delFor, false)}>Deactivate instead</button>}
          </div>
        </section>
      ))}

      {editFor && <EditProfile key={editFor.id} p={editFor} self={editFor.id === me?.id} onDone={() => setEditFor(null)} />}

      {resetFor && <ResetPassword p={resetFor} onDone={(pw) => { setCreds({ name: resetFor.full_name, username: resetFor.username, password: pw }); setResetFor(null); }} onCancel={() => setResetFor(null)} />}

      <div className="panel tablebox">
        <table>
          <thead><tr><th>Name</th><th>Username</th><th>Joined</th><th>Done / assigned</th><th>Records</th><th>Missing modules</th><th>Status</th><th>Account</th></tr></thead>
          <tbody>
            {people.map((s) => {
              const isStaff = s.role === 'staff';
              const am = isStaff ? ledger.assignedMods(s.id) : [];
              const missing = isStaff ? published.filter((m) => !ledger.asg(s.id, m.id)) : [];
              const st = ledger.staffStatus(s.id);
              return (
                <tr key={s.id}>
                  <td><b>{s.full_name}</b><div className="small muted">{isStaff ? s.job_role : 'Admin'}</div></td>
                  <td className="mono">{s.username}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmt(s.joined_on)}</td>
                  <td>{isStaff ? `${am.filter((m) => ledger.done(s.id, m)).length} / ${am.length}` : '—'}</td>
                  <td>{isStaff ? recordCount(s.id) : '—'}</td>
                  <td>{!isStaff || !s.active ? '—' : missing.length ? (
                    <div className="stack" style={{ gap: 6, alignItems: 'flex-start' }}>
                      <span className="small" style={{ color: 'var(--warn-ink)' }}>{missing.length} not assigned: {missing.map((m) => m.title).join(', ')}</span>
                      <button type="button" className="btn slim" disabled={busy} onClick={async () => {
                        setBusy(true);
                        try { for (const m of missing) await rpc('assign_staff', { p_module: m.id, p_staff: [s.id] }); toast(`Assigned ${missing.length} module${missing.length === 1 ? '' : 's'} to ${s.full_name}`); await reload(); }
                        catch (e) { toast(errText(e), true); } finally { setBusy(false); }
                      }}>Assign {missing.length === 1 ? 'it' : `all ${missing.length}`}</button>
                    </div>) : <span className="small muted">All assigned</span>}</td>
                  <td>{isStaff ? <span className={`pill ${st.cls}`}>{st.label}</span> : s.active ? <span className="pill plain">Admin</span> : <span className="pill plain">Deactivated</span>}</td>
                  <td>
                    <div className="row small" style={{ gap: '4px 14px', minWidth: 150 }}>
                      <button type="button" className="link" disabled={busy} onClick={() => { setResetFor(null); setDelFor(null); setEditFor(s); window.scrollTo({ top: 0 }); }}>Edit</button>
                      <button type="button" className="link" disabled={busy || !s.active} onClick={() => setResetFor(s)}>Reset password</button>
                      {s.id !== me?.id && <>
                        <button type="button" className="link" disabled={busy} onClick={() => {
                          if (s.active && !window.confirm(`Deactivate ${s.full_name}? They can no longer sign in. Their training record is kept.`)) return;
                          setActive(s, !s.active);
                        }}>{s.active ? 'Deactivate' : 'Reactivate'}</button>
                        <button type="button" className="link" style={{ color: 'var(--bad-ink)' }} disabled={busy} onClick={() => { setTyped(''); setDelFor(s); window.scrollTo({ top: 0 }); }}>Delete</button>
                      </>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {inactiveCount > 0 && <button type="button" className="link small" onClick={() => setShowInactive(!showInactive)}>{showInactive ? 'Hide' : 'Show'} {inactiveCount} deactivated account{inactiveCount === 1 ? '' : 's'}</button>}
      <div className="note"><b>Deleting accounts.</b> Delete is for accounts with no training records, such as dummy or test accounts, and removes them completely. Anyone with records can only be deactivated, so training evidence is never lost.</div>
    </>
  );
}

function ResetPassword({ p, onDone, onCancel }: { p: Profile; onDone: (pw: string) => void; onCancel: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState(tempPassword());
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel pad stack">
      <h2>Reset password for {p.full_name}</h2>
      <label className="field" htmlFor="rp-pass">New temporary password
        <span className="row" style={{ flexWrap: 'nowrap' }}><input id="rp-pass" className="mono" style={{ flex: 1 }} value={pw} onChange={(e) => setPw(e.target.value)} />
          <button type="button" className="btn slim" onClick={() => setPw(tempPassword())}>New</button></span></label>
      <p className="small muted">They will be asked to choose their own password when they next sign in.</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn primary" disabled={busy || pw.length < 8} onClick={async () => {
          setBusy(true);
          try { await adminUsers({ action: 'reset_password', user_id: p.id, password: pw }); onDone(pw); }
          catch (e) { toast(errText(e), true); } finally { setBusy(false); }
        }}>{busy ? 'Saving…' : 'Reset password'}</button>
      </div>
    </section>
  );
}

/** Change a person's name, username, job role or date joined. Their records stay attached to them. */
function EditProfile({ p, self, onDone }: { p: Profile; self: boolean; onDone: () => void }) {
  const { data, reload } = useAdmin();
  const roles = data?.jobRoles ?? [];
  const { reloadProfile } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ full_name: p.full_name, username: p.username, job_role: p.job_role, joined_on: p.joined_on });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const userChanged = f.username.trim().toLowerCase() !== p.username;
  const changed = userChanged || f.full_name.trim() !== p.full_name || f.job_role !== p.job_role || f.joined_on !== p.joined_on;
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await adminUsers({ action: 'update_profile', user_id: p.id, full_name: f.full_name.trim(), username: f.username.trim().toLowerCase(), job_role: f.job_role, joined_on: f.joined_on });
      toast(userChanged ? `Saved. ${f.full_name.trim()} now signs in as ${f.username.trim().toLowerCase()}.` : 'Profile saved');
      await reload();
      if (self) await reloadProfile();
      onDone();
    } catch (e) {
      const m = errText(e);
      setErr(m === 'Unknown action' ? 'This needs the updated admin-users function. See the update steps.' : m);
    } finally { setBusy(false); }
  };
  return (
    <section className="panel pad stack" style={{ borderColor: 'var(--accent)' }} aria-label={`Edit profile of ${p.full_name}`}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div><h2>Edit profile: {p.full_name}</h2><p className="small muted" style={{ marginTop: 4 }}>{p.role === 'admin' ? 'Admin' : 'Staff'}{p.active ? '' : ' · deactivated'}</p></div>
        <button type="button" className="btn slim" onClick={onDone}>Close</button>
      </div>
      <div className="grid-fields">
        <label className="field" htmlFor="ep-name" style={{ gridColumn: 'span 2' }}>Full name (as it should appear on official records)
          <input id="ep-name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
        <label className="field" htmlFor="ep-user">Username
          <input id="ep-user" className="mono" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></label>
        {p.role === 'staff' && <label className="field" htmlFor="ep-role">Job role
          <select id="ep-role" value={f.job_role} onChange={(e) => setF({ ...f, job_role: e.target.value })}>
            {roles.filter((r) => r.active || r.name === p.job_role).map((r) => <option key={r.name} value={r.name}>{r.name}{r.active ? '' : ' (retired)'}</option>)}
            {!roles.some((r) => r.name === p.job_role) && <option value={p.job_role}>{p.job_role}</option>}
          </select></label>}
        <label className="field" htmlFor="ep-joined">Date joined<input id="ep-joined" type="date" value={f.joined_on} onChange={(e) => setF({ ...f, joined_on: e.target.value })} /></label>
      </div>
      {userChanged && <div className="note">{self ? 'You' : p.full_name.split(' ')[0]} will sign in with <b className="mono">{f.username.trim().toLowerCase() || '…'}</b> from now on. The password stays the same.{self ? '' : ' Let them know before they next sign in.'}</div>}
      {err && <div className="err">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="button" className="btn primary" disabled={busy || !changed || !f.full_name.trim() || !f.joined_on} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </section>
  );
}
