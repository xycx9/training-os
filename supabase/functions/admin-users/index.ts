// Admin-only account management: create staff, reset passwords, deactivate.
// Deployed as a Supabase Edge Function. Uses the service role key, which never reaches the browser.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

// Must match VITE_LOGIN_DOMAIN in the web app.
const LOGIN_DOMAIN = Deno.env.get('LOGIN_DOMAIN') ?? 'training-os.local';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function todayMY(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  // Who is calling?
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: who, error: whoErr } = await caller.auth.getUser();
  if (whoErr || !who.user) return json({ error: 'Please sign in again.' }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', who.user.id).single();
  if (!me || me.role !== 'admin' || !me.active) return json({ error: 'Only admins can manage accounts.' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const action = String(body.action ?? '');

  try {
    if (action === 'create') {
      const username = String(body.username ?? '').trim().toLowerCase();
      const fullName = String(body.full_name ?? '').trim();
      const password = String(body.password ?? '');
      const role = body.role === 'admin' ? 'admin' : 'staff';
      const jobRole = String(body.job_role ?? 'Counter staff').trim() || 'Counter staff';
      const joinedOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body.joined_on ?? '')) ? String(body.joined_on) : todayMY();
      const moduleIds = Array.isArray(body.module_ids) ? (body.module_ids as string[]) : [];
      const dueDays = Math.max(1, Math.min(365, Number(body.due_days) || 14));

      if (!/^[a-z0-9._-]{3,32}$/.test(username)) return json({ error: 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore.' }, 400);
      if (!fullName) return json({ error: 'Enter the full name.' }, 400);
      if (password.length < 8) return json({ error: 'The temporary password must be at least 8 characters.' }, 400);

      const { data: taken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
      if (taken) return json({ error: `The username "${username}" is already taken.` }, 409);

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: `${username}@${LOGIN_DOMAIN}`, password, email_confirm: true, user_metadata: { username },
      });
      if (cErr || !created.user) return json({ error: cErr?.message ?? 'Could not create the account.' }, 400);

      const { error: pErr } = await admin.from('profiles').insert({
        id: created.user.id, username, full_name: fullName, role, job_role: jobRole, joined_on: joinedOn, must_change_password: true,
      });
      if (pErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: pErr.message }, 400);
      }

      if (role === 'staff' && moduleIds.length) {
        const today = todayMY();
        const rows = moduleIds.map((m) => ({
          module_id: m, staff_id: created.user!.id, assigned_on: today, due_on: addDays(today, dueDays), kind: 'initial', created_by: who.user!.id,
        }));
        const { error: aErr } = await admin.from('assignments').insert(rows);
        if (aErr) return json({ id: created.user.id, warning: 'Account created, but assigning modules failed: ' + aErr.message });
      }
      return json({ id: created.user.id });
    }

    if (action === 'reset_password') {
      const id = String(body.user_id ?? '');
      const password = String(body.password ?? '');
      if (password.length < 8) return json({ error: 'The temporary password must be at least 8 characters.' }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return json({ error: error.message }, 400);
      await admin.from('profiles').update({ must_change_password: true }).eq('id', id);
      return json({ ok: true });
    }

    if (action === 'set_active') {
      const id = String(body.user_id ?? '');
      const active = Boolean(body.active);
      if (id === who.user.id && !active) return json({ error: 'You cannot deactivate your own account.' }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
      if (error) return json({ error: error.message }, 400);
      await admin.from('profiles').update({ active }).eq('id', id);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
