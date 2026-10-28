// Admin-only account management: create staff, edit profiles, reset passwords, deactivate, delete.
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
  // Works with both the legacy service_role key and the newer secret keys.
  let serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey) {
    try { serviceKey = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string ?? ''; } catch { /* none */ }
  }
  if (!serviceKey) serviceKey = Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
  if (!url || !serviceKey) return json({ error: 'The function has no server key. In Supabase, add a secret named SUPABASE_SERVICE_ROLE_KEY.' }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Who is calling? The function checks the sign-in itself, so "Verify JWT" can stay off.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Please sign in again.' }, 401);
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who.user) return json({ error: 'Please sign in again.' }, 401);
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
      const jobRole = ['Teller', 'Compliance officer', 'Management'].includes(String(body.job_role)) ? String(body.job_role) : 'Teller';
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

    if (action === 'update_profile') {
      const id = String(body.user_id ?? '');
      const { data: cur } = await admin.from('profiles').select('id, username, role').eq('id', id).maybeSingle();
      if (!cur) return json({ error: 'Account not found.' }, 404);
      const username = String(body.username ?? '').trim().toLowerCase();
      const fullName = String(body.full_name ?? '').trim();
      const joinedOn = String(body.joined_on ?? '');
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) return json({ error: 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore.' }, 400);
      if (!fullName) return json({ error: 'Enter the full name.' }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedOn)) return json({ error: 'Enter the date joined.' }, 400);
      const patch: Record<string, unknown> = { full_name: fullName, joined_on: joinedOn };
      if (cur.role === 'staff') patch.job_role = ['Teller', 'Compliance officer', 'Management'].includes(String(body.job_role)) ? String(body.job_role) : 'Teller';
      if (username !== cur.username) {
        const { data: taken } = await admin.from('profiles').select('id').eq('username', username).neq('id', id).maybeSingle();
        if (taken) return json({ error: `The username "${username}" is already taken.` }, 409);
        // The sign-in address follows the username; the password stays the same.
        const { error: eErr } = await admin.auth.admin.updateUserById(id, { email: `${username}@${LOGIN_DOMAIN}`, email_confirm: true, user_metadata: { username } });
        if (eErr) return json({ error: eErr.message }, 400);
        patch.username = username;
      }
      const { error } = await admin.from('profiles').update(patch).eq('id', id);
      if (error) {
        if (patch.username) await admin.auth.admin.updateUserById(id, { email: `${cur.username}@${LOGIN_DOMAIN}`, email_confirm: true, user_metadata: { username: cur.username } });
        return json({ error: error.message }, 400);
      }
      return json({ ok: true });
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

    if (action === 'delete') {
      const id = String(body.user_id ?? '');
      if (!id) return json({ error: 'No account chosen.' }, 400);
      if (id === who.user.id) return json({ error: 'You cannot delete your own account.' }, 400);
      const { count: done } = await admin.from('attempts').select('id', { count: 'exact', head: true }).eq('staff_id', id).eq('status', 'submitted');
      const { count: past } = await admin.from('past_training').select('id', { count: 'exact', head: true }).eq('staff_id', id);
      const n = (done ?? 0) + (past ?? 0);
      if (n > 0) return json({ error: `This account has ${n} training record${n === 1 ? '' : 's'}, so it can't be deleted. Deactivate it instead.` }, 409);
      // Unfinished quiz attempts are not evidence; clear them so the account can go.
      await admin.from('attempts').delete().eq('staff_id', id).eq('status', 'in_progress');
      await admin.from('assignments').update({ created_by: null }).eq('created_by', id);
      await admin.from('version_log').update({ by_user: null }).eq('by_user', id);
      await admin.from('module_versions').update({ published_by: null }).eq('published_by', id);
      await admin.from('past_training').update({ entered_by: null }).eq('entered_by', id);
      const { error: pErr } = await admin.from('profiles').delete().eq('id', id);
      if (pErr) return json({ error: pErr.message }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
