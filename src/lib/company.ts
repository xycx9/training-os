import { useEffect, useState } from 'react';
import { ORG_NAME, supabase } from './supabase';

export interface CompanyProfile {
  name: string;
  reg_no: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_path: string | null;
  signatory_name: string | null;
  signatory_title: string | null;
  updated_at?: string;
  updated_by?: string | null;
}

const fallback: CompanyProfile = { name: ORG_NAME, reg_no: null, address: null, phone: null, email: null, logo_path: null, signatory_name: null, signatory_title: null };

let cache: { profile: CompanyProfile; logoUrl: string | null } | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

async function fetchCompany() {
  const { data } = await supabase.from('company_profile').select('*').eq('id', 1).maybeSingle();
  const profile = (data as CompanyProfile | null) ?? fallback;
  let logoUrl: string | null = null;
  if (profile.logo_path) {
    const { data: u } = await supabase.storage.from('branding').createSignedUrl(profile.logo_path, 60 * 60 * 12);
    logoUrl = u?.signedUrl ?? null;
  }
  cache = { profile, logoUrl };
  listeners.forEach((f) => f());
}

/** Reload after the admin saves the company profile, or after signing in (the logo needs a signed-in user). */
export function refreshCompany() { pending = fetchCompany().catch(() => { cache = cache ?? { profile: fallback, logoUrl: null }; }); return pending; }

/** The company's letterhead details. Falls back to the configured name until loaded. */
export function useCompany() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    if (!cache && !pending) refreshCompany();
    return () => { listeners.delete(f); };
  }, []);
  return { company: cache?.profile ?? fallback, logoUrl: cache?.logoUrl ?? null, loaded: !!cache };
}
