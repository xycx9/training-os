-- Training OS database
-- Run this once in the Supabase SQL Editor of a NEW project.
-- It creates the tables, security rules, server functions and the private file bucket.

create extension if not exists pgcrypto;

-- "Today" in Malaysia, used for every due date and record date.
create or replace function public.today_my() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kuala_Lumpur')::date $$;

-------------------------------------------------------------------------------
-- People
-------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  full_name text not null check (length(trim(full_name)) > 0),
  role text not null default 'staff' check (role in ('admin','staff')),
  job_role text not null default 'Counter staff',
  joined_on date not null default public.today_my(),
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active)
$$;

-------------------------------------------------------------------------------
-- Modules, versions and question banks
-------------------------------------------------------------------------------
create table public.modules (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  status text not null default 'draft' check (status in ('draft','published')),
  cycle text not null default 'fixed' check (cycle in ('fixed','rolling','none')),
  refresher_months int not null default 12 check (refresher_months between 1 and 60),
  duration_hours numeric(5,2) not null default 0 check (duration_hours >= 0),
  due_days int not null default 14 check (due_days between 1 and 365),
  per_attempt int not null default 5 check (per_attempt between 1 and 100),
  pass_mark int not null default 80 check (pass_mark between 1 and 100),
  max_attempts int not null default 3 check (max_attempts between 1 and 20),
  require_read boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.module_versions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  label text not null,
  file_path text,
  file_name text,
  page_count int,
  is_current boolean not null default false,
  effective_on date,
  published_by uuid references public.profiles(id),
  published_on date,
  created_at timestamptz not null default now(),
  unique (module_id, label)
);
create unique index module_versions_one_current on public.module_versions(module_id) where is_current;

create table public.version_log (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.module_versions(id) on delete cascade,
  kind text not null check (kind in ('created','published','correction','archived')),
  note text,
  by_user uuid references public.profiles(id),
  at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.module_versions(id) on delete cascade,
  position int not null default 0,
  prompt text not null check (length(trim(prompt)) > 0),
  options text[] not null check (array_length(options, 1) = 4),
  correct smallint not null check (correct between 0 and 3),
  source_page int not null default 1 check (source_page >= 1),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index questions_version on public.questions(version_id);

-------------------------------------------------------------------------------
-- Assignments, reading progress and attempts
-------------------------------------------------------------------------------
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  assigned_on date not null default public.today_my(),
  due_on date not null,
  kind text not null default 'initial' check (kind in ('initial','refresher','retake')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (due_on >= assigned_on),
  unique (module_id, staff_id, assigned_on, kind)
);
create index assignments_staff on public.assignments(staff_id, module_id, assigned_on);

create table public.read_progress (
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  max_page int not null default 1,
  updated_at timestamptz not null default now()
);

-- Attempts are evidence: never updated after submission and never deleted.
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete restrict,
  module_id uuid not null references public.modules(id) on delete restrict,
  version_id uuid not null references public.module_versions(id) on delete restrict,
  module_title text not null,
  version_label text not null,
  assignment_id uuid references public.assignments(id) on delete set null,
  status text not null default 'in_progress' check (status in ('in_progress','submitted')),
  question_ids uuid[] not null,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  taken_on date,
  score int,
  passed boolean,
  correct_count int,
  total int,
  hours numeric(5,2) not null default 0,
  answers jsonb
);
create index attempts_staff on public.attempts(staff_id, module_id, taken_on);

-------------------------------------------------------------------------------
-- Row level security
-------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.modules enable row level security;
alter table public.module_versions enable row level security;
alter table public.version_log enable row level security;
alter table public.questions enable row level security;
alter table public.assignments enable row level security;
alter table public.read_progress enable row level security;
alter table public.attempts enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy modules_read on public.modules for select to authenticated using (public.is_admin() or status = 'published');
create policy modules_admin_update on public.modules for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy versions_read on public.module_versions for select to authenticated using (public.is_admin() or is_current);
create policy version_log_read on public.version_log for select to authenticated using (public.is_admin());

-- Staff never read the question bank directly: they get questions (without answers) from start_attempt().
create policy questions_admin_read on public.questions for select to authenticated using (public.is_admin());
create policy questions_admin_update on public.questions for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy questions_admin_delete on public.questions for delete to authenticated using (public.is_admin());

create policy assignments_read on public.assignments for select to authenticated using (staff_id = auth.uid() or public.is_admin());
create policy read_progress_read on public.read_progress for select to authenticated using (staff_id = auth.uid() or public.is_admin());
create policy attempts_read on public.attempts for select to authenticated using (staff_id = auth.uid() or public.is_admin());

-------------------------------------------------------------------------------
-- Server functions
-------------------------------------------------------------------------------
create or replace function public.next_label(p text) returns text
language sql immutable as $$
  select case
    when p ~ '^v?[0-9]+\.[0-9]+$' then 'v' || split_part(ltrim(p, 'v'), '.', 1) || '.' || (split_part(ltrim(p, 'v'), '.', 2)::int + 1)
    when p ~ '^v?[0-9]+$' then 'v' || ltrim(p, 'v') || '.1'
    else p || '-r2' end
$$;

-- Create a module, correct it, or publish a new version, all in one transaction.
create or replace function public.save_module(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_mod uuid := nullif(p->>'module_id', '')::uuid;
  v_change text := coalesce(p->>'change', 'correction');
  v_publish boolean := coalesce((p->>'publish')::boolean, false);
  mset jsonb := coalesce(p->'module', '{}'::jsonb);
  vset jsonb := coalesce(p->'version', '{}'::jsonb);
  qs jsonb := coalesce(p->'questions', '[]'::jsonb);
  m public.modules;
  cv public.module_versions;
  v_label text;
  n_appr int;
  n_pend int;
  v_note text := nullif(trim(coalesce(p->>'note', '')), '');
begin
  if not public.is_admin() then raise exception 'Only admins can change modules'; end if;
  if coalesce(trim(mset->>'title'), '') = '' then raise exception 'Add a module title'; end if;
  if coalesce(vset->>'file_path', '') = '' then raise exception 'Upload the training material (PDF)'; end if;

  select count(*) filter (where coalesce((q->>'approved')::boolean, false)),
         count(*) filter (where not coalesce((q->>'approved')::boolean, false))
    into n_appr, n_pend
    from jsonb_array_elements(qs) q;

  if v_mod is null then
    insert into public.modules (title, cycle, refresher_months, duration_hours, due_days, per_attempt, pass_mark, max_attempts, require_read)
    values (trim(mset->>'title'),
            coalesce(mset->>'cycle', 'fixed'),
            coalesce((mset->>'refresher_months')::int, 12),
            coalesce((mset->>'duration_hours')::numeric, 0),
            coalesce((mset->>'due_days')::int, 14),
            coalesce((mset->>'per_attempt')::int, 5),
            coalesce((mset->>'pass_mark')::int, 80),
            coalesce((mset->>'max_attempts')::int, 3),
            coalesce((mset->>'require_read')::boolean, true))
    returning * into m;
    insert into public.module_versions (module_id, label, file_path, file_name, page_count, is_current)
    values (m.id, coalesce(nullif(trim(vset->>'label'), ''), 'v1.0'), vset->>'file_path', vset->>'file_name', (vset->>'page_count')::int, true)
    returning * into cv;
    insert into public.version_log (version_id, kind, note, by_user) values (cv.id, 'created', 'Draft created', auth.uid());
  else
    select * into m from public.modules where id = v_mod for update;
    if not found then raise exception 'Module not found'; end if;
    update public.modules set
      title = trim(mset->>'title'),
      cycle = coalesce(mset->>'cycle', cycle),
      refresher_months = coalesce((mset->>'refresher_months')::int, refresher_months),
      duration_hours = coalesce((mset->>'duration_hours')::numeric, duration_hours),
      due_days = coalesce((mset->>'due_days')::int, due_days),
      per_attempt = coalesce((mset->>'per_attempt')::int, per_attempt),
      pass_mark = coalesce((mset->>'pass_mark')::int, pass_mark),
      max_attempts = coalesce((mset->>'max_attempts')::int, max_attempts),
      require_read = coalesce((mset->>'require_read')::boolean, require_read),
      updated_at = now()
    where id = m.id returning * into m;
    select * into cv from public.module_versions where module_id = m.id and is_current;

    if m.status = 'published' and v_change = 'version' then
      v_label := public.next_label(cv.label);
      update public.module_versions set is_current = false where id = cv.id;
      insert into public.version_log (version_id, kind, note, by_user) values (cv.id, 'archived', 'Replaced by ' || v_label, auth.uid());
      insert into public.module_versions (module_id, label, file_path, file_name, page_count, is_current, effective_on, published_by, published_on)
      values (m.id, v_label, vset->>'file_path', vset->>'file_name', (vset->>'page_count')::int, true, public.today_my(), auth.uid(), public.today_my())
      returning * into cv;
      insert into public.version_log (version_id, kind, note, by_user) values (cv.id, 'published', coalesce(v_note, 'New version published'), auth.uid());
      if coalesce((p->>'retake')::boolean, false) then
        insert into public.assignments (module_id, staff_id, assigned_on, due_on, kind, created_by)
        select distinct m.id, a.staff_id, public.today_my(), public.today_my() + m.due_days, 'retake', auth.uid()
          from public.assignments a join public.profiles pr on pr.id = a.staff_id
         where a.module_id = m.id and pr.active and a.assigned_on <= public.today_my()
        on conflict do nothing;
      end if;
    else
      update public.module_versions set file_path = vset->>'file_path', file_name = vset->>'file_name', page_count = (vset->>'page_count')::int
       where id = cv.id returning * into cv;
      delete from public.questions where version_id = cv.id;
      if m.status = 'published' then
        insert into public.version_log (version_id, kind, note, by_user) values (cv.id, 'correction', coalesce(v_note, 'Correction'), auth.uid());
      end if;
    end if;
  end if;

  if (m.status = 'published' or v_publish) and (n_pend > 0 or n_appr < m.per_attempt) then
    raise exception 'Approve every question first. At least % approved questions are needed (you have %).', m.per_attempt, n_appr;
  end if;

  insert into public.questions (version_id, position, prompt, options, correct, source_page, approved)
  select cv.id, (t.ord - 1)::int, trim(t.q->>'prompt'),
         array(select jsonb_array_elements_text(t.q->'options')),
         (t.q->>'correct')::smallint,
         greatest(1, coalesce((t.q->>'source_page')::int, 1)),
         coalesce((t.q->>'approved')::boolean, false)
    from jsonb_array_elements(qs) with ordinality as t(q, ord);

  if v_publish and m.status <> 'published' then
    update public.modules set status = 'published', updated_at = now() where id = m.id;
    update public.module_versions set effective_on = public.today_my(), published_by = auth.uid(), published_on = public.today_my() where id = cv.id;
    insert into public.version_log (version_id, kind, note, by_user) values (cv.id, 'published', 'Published', auth.uid());
    insert into public.assignments (module_id, staff_id, assigned_on, due_on, kind, created_by)
    select m.id, s::uuid, public.today_my(), public.today_my() + m.due_days, 'initial', auth.uid()
      from jsonb_array_elements_text(coalesce(p->'assign', '[]'::jsonb)) s
    on conflict do nothing;
  end if;

  return m.id;
end $$;

-- Publish a draft as it stands (from the module page).
create or replace function public.publish_module(p_module uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.modules; cv public.module_versions; n_appr int; n_pend int;
begin
  if not public.is_admin() then raise exception 'Only admins can publish'; end if;
  select * into m from public.modules where id = p_module for update;
  if not found then raise exception 'Module not found'; end if;
  if m.status = 'published' then return; end if;
  select * into cv from public.module_versions where module_id = m.id and is_current;
  select count(*) filter (where approved), count(*) filter (where not approved) into n_appr, n_pend from public.questions where version_id = cv.id;
  if n_pend > 0 or n_appr < m.per_attempt then
    raise exception 'Approve every question first. At least % approved questions are needed (you have %).', m.per_attempt, n_appr;
  end if;
  update public.modules set status = 'published', updated_at = now() where id = m.id;
  update public.module_versions set effective_on = public.today_my(), published_by = auth.uid(), published_on = public.today_my() where id = cv.id;
  insert into public.version_log (version_id, kind, note, by_user) values (cv.id, 'published', 'Published', auth.uid());
end $$;

-- Assign a module. kind 'initial' skips anyone already assigned; 'refresher' schedules a round.
create or replace function public.assign_staff(p_module uuid, p_staff uuid[], p_kind text default 'initial', p_open date default null, p_due date default null)
returns int language plpgsql security definer set search_path = public as $$
declare m public.modules; s uuid; n int := 0; v_open date; v_due date;
begin
  if not public.is_admin() then raise exception 'Only admins can assign training'; end if;
  if p_kind not in ('initial','refresher','retake') then raise exception 'Unknown assignment type'; end if;
  select * into m from public.modules where id = p_module;
  if not found then raise exception 'Module not found'; end if;
  v_open := coalesce(p_open, public.today_my());
  v_due := coalesce(p_due, v_open + m.due_days);
  if v_due < v_open then raise exception 'The due date must be on or after the opening date'; end if;
  foreach s in array coalesce(p_staff, '{}') loop
    if p_kind = 'initial' and exists (select 1 from public.assignments where staff_id = s and module_id = p_module and assigned_on <= public.today_my()) then
      continue;
    end if;
    insert into public.assignments (module_id, staff_id, assigned_on, due_on, kind, created_by)
    values (p_module, s, v_open, v_due, p_kind, auth.uid())
    on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Remove someone from a module. Their past attempts stay in the record.
create or replace function public.unassign_staff(p_module uuid, p_staff uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can change assignments'; end if;
  delete from public.assignments where module_id = p_module and staff_id = p_staff;
end $$;

-- Rolling refreshers: open 30 days before the anniversary of each person's last pass.
create or replace function public.sync_refreshers() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_due date; v_open date;
begin
  for r in
    select m.id as module_id, m.refresher_months, pr.id as staff_id, ca.assigned_on as cur_assigned,
           (select max(t.taken_on) from public.attempts t
             where t.staff_id = pr.id and t.module_id = m.id and t.status = 'submitted' and t.passed) as last_pass
      from public.modules m
      cross join public.profiles pr
      cross join lateral (
        select a.assigned_on from public.assignments a
         where a.staff_id = pr.id and a.module_id = m.id and a.assigned_on <= public.today_my()
         order by a.assigned_on desc, a.created_at desc limit 1) ca
     where m.status = 'published' and m.cycle = 'rolling' and pr.active and pr.role = 'staff'
  loop
    continue when r.last_pass is null or r.last_pass < r.cur_assigned;
    v_due := (r.last_pass + make_interval(months => r.refresher_months))::date;
    v_open := v_due - 30;
    if v_open <= public.today_my() then
      insert into public.assignments (module_id, staff_id, assigned_on, due_on, kind)
      values (r.module_id, r.staff_id, v_open, v_due, 'refresher')
      on conflict do nothing;
      if found then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;

-- Staff: remember the furthest page read for the current assignment.
create or replace function public.record_progress(p_module uuid, p_page int) returns int
language plpgsql security definer set search_path = public as $$
declare a public.assignments; v int;
begin
  select * into a from public.assignments
   where staff_id = auth.uid() and module_id = p_module and assigned_on <= public.today_my()
   order by assigned_on desc, created_at desc limit 1;
  if not found then return 0; end if;
  insert into public.read_progress (assignment_id, staff_id, max_page)
  values (a.id, auth.uid(), greatest(p_page, 1))
  on conflict (assignment_id) do update
    set max_page = greatest(public.read_progress.max_page, excluded.max_page), updated_at = now()
  returning max_page into v;
  return v;
end $$;

-- Staff: start (or resume) an attempt. Returns the questions without the answers.
create or replace function public.start_attempt(p_module uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.modules; a public.assignments; cv public.module_versions; t public.attempts;
  v_fails int; v_prog int; v_ids uuid[]; v_have int; v_resume boolean := false;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active) then raise exception 'Your account is not active'; end if;
  select * into m from public.modules where id = p_module and status = 'published';
  if not found then raise exception 'This module is not available'; end if;
  select * into a from public.assignments
   where staff_id = auth.uid() and module_id = p_module and assigned_on <= public.today_my()
   order by assigned_on desc, created_at desc limit 1;
  if not found then raise exception 'This module is not assigned to you'; end if;
  if exists (select 1 from public.attempts where staff_id = auth.uid() and module_id = p_module
              and status = 'submitted' and passed and taken_on >= a.assigned_on) then
    raise exception 'You have already passed this module';
  end if;
  select count(*) into v_fails from public.attempts
   where staff_id = auth.uid() and module_id = p_module and status = 'submitted' and not passed and taken_on >= a.assigned_on;
  if v_fails >= m.max_attempts then raise exception 'No attempts left. Please see the compliance officer.'; end if;
  select * into cv from public.module_versions where module_id = p_module and is_current;
  if m.require_read then
    select max_page into v_prog from public.read_progress where assignment_id = a.id;
    if coalesce(v_prog, 0) < coalesce(cv.page_count, 0) then raise exception 'Read to the last page before starting the assessment'; end if;
  end if;

  select * into t from public.attempts
   where staff_id = auth.uid() and assignment_id = a.id and version_id = cv.id and status = 'in_progress'
   order by started_at desc limit 1;
  if found then
    select count(*) into v_have from public.questions where id = any(t.question_ids);
    if v_have = array_length(t.question_ids, 1) then v_resume := true;
    else delete from public.attempts where id = t.id; end if;
  end if;

  if not v_resume then
    select array_agg(id) into v_ids from (
      select id from public.questions where version_id = cv.id and approved order by random() limit m.per_attempt) x;
    if v_ids is null then raise exception 'This module has no questions yet'; end if;
    insert into public.attempts (staff_id, module_id, version_id, module_title, version_label, assignment_id, question_ids)
    values (auth.uid(), m.id, cv.id, m.title, cv.label, a.id, v_ids)
    returning * into t;
  end if;

  return jsonb_build_object(
    'attempt_id', t.id,
    'attempt_no', v_fails + 1,
    'max_attempts', m.max_attempts,
    'pass_mark', m.pass_mark,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'options', to_jsonb(q.options))
                                   order by array_position(t.question_ids, q.id))
                    from public.questions q where q.id = any(t.question_ids)));
end $$;

-- Staff: submit answers. Scoring happens here, on the server.
create or replace function public.submit_attempt(p_attempt uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.attempts; m public.modules;
  v_snap jsonb; v_correct int; v_total int; v_answered int; v_score int; v_pass boolean; v_hours numeric;
begin
  select * into t from public.attempts where id = p_attempt and staff_id = auth.uid() for update;
  if not found then raise exception 'Attempt not found'; end if;
  if t.status <> 'in_progress' then raise exception 'This attempt was already submitted'; end if;
  select * into m from public.modules where id = t.module_id;

  select jsonb_agg(jsonb_build_object(
           'question_id', q.id, 'prompt', q.prompt, 'options', to_jsonb(q.options), 'correct', q.correct,
           'chosen', (p_answers->>(q.id::text))::int, 'source_page', q.source_page)
           order by array_position(t.question_ids, q.id)),
         count(*) filter (where (p_answers->>(q.id::text))::int = q.correct),
         count(*),
         count(*) filter (where p_answers ? (q.id::text))
    into v_snap, v_correct, v_total, v_answered
    from public.questions q where q.id = any(t.question_ids);

  if v_total = 0 or v_total < array_length(t.question_ids, 1) then
    delete from public.attempts where id = t.id;
    return jsonb_build_object('error', 'The questions were updated while you were answering. Please start the assessment again.');
  end if;
  if v_answered < v_total then raise exception 'Answer every question before submitting'; end if;

  v_score := round(100.0 * v_correct / v_total);
  v_pass := v_score >= m.pass_mark;
  v_hours := case when v_pass then m.duration_hours else 0 end;
  update public.attempts set status = 'submitted', submitted_at = now(), taken_on = public.today_my(),
         score = v_score, passed = v_pass, correct_count = v_correct, total = v_total, hours = v_hours, answers = v_snap
   where id = t.id;

  return jsonb_build_object('score', v_score, 'passed', v_pass, 'correct', v_correct, 'total', v_total,
    'pass_mark', m.pass_mark, 'hours', v_hours,
    'review', coalesce((select jsonb_agg(x) from jsonb_array_elements(v_snap) x
                         where (x->>'chosen')::int is distinct from (x->>'correct')::int), '[]'::jsonb));
end $$;

-- Staff: after changing the temporary password.
create or replace function public.clear_password_flag() returns void
language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid()
$$;

-- Table access for signed-in users. Row level security above still decides which rows each person sees.
-- (Explicit, so the app works even if "Automatically expose new tables" was switched off.)
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- Only signed-in users may call the functions.
do $$
declare f text;
begin
  foreach f in array array[
    'save_module(jsonb)', 'publish_module(uuid)', 'assign_staff(uuid, uuid[], text, date, date)', 'unassign_staff(uuid, uuid)',
    'sync_refreshers()', 'record_progress(uuid, int)', 'start_attempt(uuid)', 'submit_attempt(uuid, jsonb)', 'clear_password_flag()', 'is_admin()']
  loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('revoke execute on function public.%s from anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-------------------------------------------------------------------------------
-- Private storage for PDFs
-------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materials', 'materials', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy materials_read on storage.objects for select to authenticated using (bucket_id = 'materials');
create policy materials_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'materials' and public.is_admin());
create policy materials_admin_update on storage.objects for update to authenticated using (bucket_id = 'materials' and public.is_admin());
create policy materials_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'materials' and public.is_admin());
