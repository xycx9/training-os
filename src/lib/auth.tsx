import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, usernameToEmail } from './supabase';
import type { Profile } from './types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  notice: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  reloadProfile: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); return; }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
    if (error || !data) {
      setNotice('Your account is not set up yet. Please ask your admin.');
      await supabase.auth.signOut(); setSession(null); setProfile(null); return;
    }
    if (!data.active) {
      setNotice('Your account has been deactivated. Please ask your admin.');
      await supabase.auth.signOut(); setSession(null); setProfile(null); return;
    }
    setProfile(data as Profile);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) setProfile(null);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const signIn = async (username: string, password: string) => {
    setNotice(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error || !data.session) throw new Error('Wrong username or password.');
    setSession(data.session);
    await loadProfile(data.session);
  };
  const signOut = async () => { await supabase.auth.signOut(); setSession(null); setProfile(null); };
  const reloadProfile = async () => { const { data } = await supabase.auth.getSession(); await loadProfile(data.session); };

  return <Ctx.Provider value={{ loading, session, profile, notice, signIn, signOut, reloadProfile }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
