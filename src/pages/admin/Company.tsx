import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { refreshCompany, useCompany, type CompanyProfile } from '../../lib/company';
import { errText, supabase } from '../../lib/supabase';
import { useToast } from '../../components/Toast';
import { AddFiles } from '../../components/Files';
import { Letterhead } from '../staff/Official';

type Form = Omit<CompanyProfile, 'updated_at' | 'updated_by'>;
const keys: (keyof Form)[] = ['name', 'reg_no', 'address', 'phone', 'email', 'signatory_name', 'signatory_title'];

/** Letterhead details and signatory used on printed records. */
export default function Company() {
  const { company, logoUrl, loaded } = useCompany();
  const { profile } = useAuth();
  const toast = useToast();
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (loaded && !f) setF({ ...company }); }, [loaded, company, f]);
  if (!f) return <p className="muted">Loading…</p>;
  const v = (k: keyof Form) => (f[k] as string | null) ?? '';
  const set = (k: keyof Form, val: string) => setF({ ...f, [k]: val });
  const dirty = keys.some((k) => (v(k) || '') !== (((company[k] as string | null) ?? '')));

  const save = async () => {
    if (!v('name').trim()) { toast('Enter the company name', true); return; }
    setBusy(true);
    try {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: profile?.id };
      keys.forEach((k) => { const t = v(k).trim(); patch[k] = k === 'name' ? t : t || null; });
      const { error } = await supabase.from('company_profile').update(patch).eq('id', 1);
      if (error) throw new Error(error.message.includes('company_profile') ? 'This needs the latest database update (0004). See the README.' : error.message);
      await refreshCompany();
      toast('Company profile saved');
    } catch (e) { toast(errText(e), true); }
    finally { setBusy(false); }
  };

  const setLogo = async (file: File | null) => {
    setBusy(true);
    try {
      let path: string | null = null;
      if (file) {
        const ext = file.name.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
        path = `logo-${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from('branding').upload(path, file, { contentType: ext === 'png' ? 'image/png' : 'image/jpeg' });
        if (error) throw error;
      }
      const { error } = await supabase.from('company_profile').update({ logo_path: path, updated_at: new Date().toISOString(), updated_by: profile?.id }).eq('id', 1);
      if (error) throw error;
      if (company.logo_path) await supabase.storage.from('branding').remove([company.logo_path]);
      await refreshCompany();
      toast(file ? 'Logo updated' : 'Logo removed');
    } catch (e) { toast(errText(e), true); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div>
        <h1>Company profile</h1>
        <p className="muted small" style={{ marginTop: 4, maxWidth: 720 }}>These details appear on the letterhead of official training records that staff print, for example for CPD/CPE claims. The company name also appears at the top of every page and on printed training logs.</p>
      </div>

      <section className="panel pad stack">
        <h2>Letterhead</h2>
        <div className="grid-fields">
          <label className="field" htmlFor="co-name" style={{ gridColumn: '1 / -1' }}>Company name<input id="co-name" value={v('name')} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="field" htmlFor="co-reg">Company registration no.<input id="co-reg" value={v('reg_no')} onChange={(e) => set('reg_no', e.target.value)} placeholder="e.g. 201501012345 (1234567-X)" /></label>
          <label className="field" htmlFor="co-phone">Phone<input id="co-phone" value={v('phone')} onChange={(e) => set('phone', e.target.value)} /></label>
          <label className="field" htmlFor="co-email">Email<input id="co-email" type="email" value={v('email')} onChange={(e) => set('email', e.target.value)} /></label>
          <label className="field" htmlFor="co-addr" style={{ gridColumn: '1 / -1' }}>Business address<input id="co-addr" value={v('address')} onChange={(e) => set('address', e.target.value)} placeholder="Street, postcode, city, state" /></label>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 14 }}>
          {logoUrl ? <img src={logoUrl} alt="Company logo" style={{ height: 56, maxWidth: 160, objectFit: 'contain', border: '1px solid var(--line)', borderRadius: 8, padding: 4, background: '#fff' }} />
            : <span className="small muted">No logo yet.</span>}
          <AddFiles label={logoUrl ? 'Replace logo' : '+ Add logo'} exts={['png', 'jpg', 'jpeg']} maxMb={2} multiple={false} disabled={busy} onFiles={(fs) => setLogo(fs[0])} />
          {logoUrl && <button type="button" className="btn" disabled={busy} onClick={() => setLogo(null)}>Remove logo</button>}
          <span className="small muted">PNG or JPG, up to 2 MB. A PNG with a transparent background looks best.</span>
        </div>
      </section>

      <section className="panel pad stack">
        <div><h2>Authorised signatory</h2><p className="small muted" style={{ marginTop: 4 }}>Printed under the signature line on official records. Leave both empty to print a blank line for whoever signs. Records are signed and stamped by hand.</p></div>
        <div className="grid-fields">
          <label className="field" htmlFor="co-sig">Name<input id="co-sig" value={v('signatory_name')} onChange={(e) => set('signatory_name', e.target.value)} /></label>
          <label className="field" htmlFor="co-sigt">Designation<input id="co-sigt" value={v('signatory_title')} onChange={(e) => set('signatory_title', e.target.value)} /></label>
        </div>
      </section>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {dirty && <span className="small muted">Unsaved changes</span>}
        <button type="button" className="btn" disabled={busy || !dirty} onClick={() => setF({ ...company })}>Undo changes</button>
        <button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>

      <section className="stack" style={{ gap: 8 }}>
        <h2>Preview</h2>
        <div className="desk"><div className="sheet"><Letterhead company={{ ...company, ...f }} logoUrl={logoUrl} /><p className="small muted" style={{ marginTop: 18 }}>The rest of the official record follows here.</p></div></div>
      </section>
    </>
  );
}
