import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && anonKey);
export const supabase = createClient(url || 'http://localhost', anonKey || 'missing-key');

export const ORG_NAME = (import.meta.env.VITE_ORG_NAME as string | undefined) || 'Training OS';
export const LOGIN_DOMAIN = (import.meta.env.VITE_LOGIN_DOMAIN as string | undefined) || 'training-os.local';
export const usernameToEmail = (u: string) => `${u.trim().toLowerCase()}@${LOGIN_DOMAIN}`;

/** Turn a Supabase/Postgres error into a sentence for the user. */
export function errText(e: unknown): string {
  if (!e) return 'Something went wrong.';
  if (typeof e === 'string') return e;
  const err = e as { message?: string };
  return err.message || 'Something went wrong.';
}

/** Call an RPC and throw a readable error if it fails. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Call the admin-users edge function. */
export async function adminUsers(body: Record<string, unknown>): Promise<{ id?: string; warning?: string }> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      }
    } catch { /* keep the original message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data ?? {};
}

export async function signedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('materials').createSignedUrl(path, 60 * 60);
  if (error || !data) throw new Error(error?.message || 'Could not open the file');
  return data.signedUrl;
}
