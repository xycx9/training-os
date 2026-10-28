-- Training OS: reading materials, past sessions, company profile and official statements
-- Run once in the Supabase SQL Editor, after 0001, 0002 and 0003.

-------------------------------------------------------------------------------
-- Private bucket for downloadable reading materials (modules and past sessions)
-------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('readings', 'readings', false, 52428800, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;

create policy readings_read on storage.objects for select to authenticated using (bucket_id = 'readings');
create policy readings_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'readings' and public.is_admin());
create policy readings_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'readings' and public.is_admin());

-------------------------------------------------------------------------------
-- Reading materials attached to a module version
-------------------------------------------------------------------------------
create table public.module_files (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.module_versions(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index module_files_version on public.module_files(version_id);
alter table public.module_files enable row level security;
-- Staff see materials of current versions of published modules; admins see all.
create policy module_files_read on public.module_files for select to authenticated using (
  public.is_admin() or exists (
    select 1 from public.module_versions v join public.modules m on m.id = v.module_id
     where v.id = version_id and v.is_current and m.status = 'published'));
create policy module_files_admin_insert on public.module_files for insert to authenticated with check (public.is_admin());
create policy module_files_admin_delete on public.module_files for delete to authenticated using (public.is_admin());
grant select, insert, delete on public.module_files to authenticated;

-- When a new version is created, carry the previous version's reading materials over.
-- The admin can then remove or add files on the new version.
create or replace function public.carry_module_files() returns trigger
language plpgsql security definer set search_path = public as $$
declare prev uuid;
begin
  select id into prev from public.module_versions
   where module_id = new.module_id and id <> new.id
   order by created_at desc limit 1;
  if prev is not null then
    insert into public.module_files (version_id, file_path, file_name, size_bytes, uploaded_by, uploaded_at)
    select new.id, file_path, file_name, size_bytes, uploaded_by, uploaded_at from public.module_files where version_id = prev;
  end if;
  return new;
end $$;
create trigger module_versions_carry_files after insert on public.module_versions
  for each row execute function public.carry_module_files();

-------------------------------------------------------------------------------
-- Past training sessions (held before or outside the system)
-------------------------------------------------------------------------------
create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  held_on date not null check (held_on <= (now() at time zone 'Asia/Kuala_Lumpur')::date),
  hours numeric(5,2) not null default 0 check (hours >= 0),
  delivered_by text,
  assessed boolean not null default false,
  pass_mark int check (pass_mark between 0 and 100),
  notes text,
  entered_by uuid references public.profiles(id) on delete set null,
  entered_at timestamptz not null default now()
);

create table public.session_files (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  kind text not null check (kind in ('material', 'evidence')),
  file_path text not null,
  file_name text not null,
  size_bytes bigint,
  uploaded_at timestamptz not null default now()
);
create index session_files_session on public.session_files(session_id);

alter table public.past_training add column session_id uuid references public.training_sessions(id) on delete restrict;
create index past_training_session on public.past_training(session_id);

alter table public.training_sessions enable row level security;
alter table public.session_files enable row level security;
-- Staff see the sessions they attended and that session's materials (never the evidence).
create policy sessions_read on public.training_sessions for select to authenticated using (
  public.is_admin() or exists (select 1 from public.past_training t where t.session_id = training_sessions.id and t.staff_id = auth.uid()));
create policy session_files_read on public.session_files for select to authenticated using (
  public.is_admin() or (kind = 'material' and exists (
    select 1 from public.past_training t where t.session_id = session_files.session_id and t.staff_id = auth.uid())));
grant select on public.training_sessions, public.session_files to authenticated;
revoke all on public.training_sessions, public.session_files from anon;

-- Save a whole session in one go: details, files (already uploaded) and one record per attendee.
create or replace function public.save_session(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.training_sessions; a jsonb; f jsonb; v_res text; v_score int;
begin
  if not public.is_admin() then raise exception 'Only admins can record training'; end if;
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'Enter the name of the training'; end if;
  if (p->>'held_on') is null then raise exception 'Enter the date the session was held'; end if;
  if (p->>'held_on')::date > public.today_my() then raise exception 'The session date cannot be in the future'; end if;
  if jsonb_array_length(coalesce(p->'attendees', '[]'::jsonb)) = 0 then raise exception 'Add at least one attendee'; end if;

  insert into public.training_sessions (title, held_on, hours, delivered_by, assessed, pass_mark, notes, entered_by)
  values (trim(p->>'title'), (p->>'held_on')::date, coalesce((p->>'hours')::numeric, 0), nullif(trim(coalesce(p->>'delivered_by', '')), ''),
          coalesce((p->>'assessed')::boolean, false), (p->>'pass_mark')::int, nullif(trim(coalesce(p->>'notes', '')), ''), auth.uid())
  returning * into s;

  for f in select * from jsonb_array_elements(coalesce(p->'files', '[]'::jsonb)) loop
    insert into public.session_files (session_id, kind, file_path, file_name, size_bytes)
    values (s.id, f->>'kind', f->>'file_path', f->>'file_name', (f->>'size_bytes')::bigint);
  end loop;

  for a in select * from jsonb_array_elements(p->'attendees') loop
    v_res := coalesce(a->>'result', 'completed');
    if v_res not in ('completed', 'pass', 'fail') then raise exception 'Result must be attended, pass or fail'; end if;
    v_score := case when v_res = 'completed' or coalesce(a->>'score', '') = '' then null else least(100, greatest(0, (a->>'score')::int)) end;
    insert into public.past_training (staff_id, title, completed_on, hours, result, score, delivered_by, notes,
                                      evidence_path, evidence_name, entered_by, session_id)
    values ((a->>'staff_id')::uuid, s.title, s.held_on, s.hours, v_res, v_score,
            s.delivered_by, s.notes, nullif(a->>'paper_path', ''), nullif(a->>'paper_name', ''), auth.uid(), s.id);
  end loop;
  return s.id;
end $$;

-- Remove a session entered by mistake (it can then be entered again correctly).
-- Returns the storage paths so the app can delete the files.
create or replace function public.delete_session(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_files jsonb; v_papers jsonb;
begin
  if not public.is_admin() then raise exception 'Only admins can remove recorded training'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'path', file_path)), '[]'::jsonb) into v_files from public.session_files where session_id = p_session;
  select coalesce(jsonb_agg(evidence_path), '[]'::jsonb) into v_papers from public.past_training where session_id = p_session and evidence_path is not null;
  delete from public.past_training where session_id = p_session;
  delete from public.training_sessions where id = p_session;
  return jsonb_build_object('files', v_files, 'papers', v_papers);
end $$;

revoke execute on function public.save_session(jsonb), public.delete_session(uuid), public.carry_module_files() from public, anon;
grant execute on function public.save_session(jsonb), public.delete_session(uuid) to authenticated;

-------------------------------------------------------------------------------
-- Company profile: letterhead details and signatory for official records
-------------------------------------------------------------------------------
create table public.company_profile (
  id int primary key default 1 check (id = 1),
  name text not null check (length(trim(name)) > 0),
  reg_no text,
  address text,
  phone text,
  email text,
  logo_path text,
  signatory_name text,
  signatory_title text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.company_profile (id, name) values (1, 'Inco Licenced Money Changer Sdn Bhd') on conflict (id) do nothing;
alter table public.company_profile enable row level security;
-- The company name and letterhead details are not secret; the sign-in page shows the name too.
create policy company_read on public.company_profile for select to authenticated, anon using (true);
create policy company_admin_update on public.company_profile for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, update on public.company_profile to authenticated;
revoke all on public.company_profile from anon;
grant select on public.company_profile to anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;
create policy branding_read on storage.objects for select to authenticated using (bucket_id = 'branding');
create policy branding_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'branding' and public.is_admin());
create policy branding_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'branding' and public.is_admin());

-------------------------------------------------------------------------------
-- Official training statements: each one printed gets a reference number,
-- and the company keeps a list of what was issued, to whom and for which period.
-------------------------------------------------------------------------------
create table public.official_statements (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  period_from date,
  period_to date,
  records int not null default 0,
  hours numeric(7,2) not null default 0,
  issued_at timestamptz not null default now()
);
alter table public.official_statements enable row level security;
create policy statements_read on public.official_statements for select to authenticated using (staff_id = auth.uid() or public.is_admin());
grant select on public.official_statements to authenticated;
revoke all on public.official_statements from anon;

create or replace function public.issue_statement(p_from date, p_to date, p_records int, p_hours numeric) returns text
language plpgsql security definer set search_path = public as $$
declare v_year text := to_char(public.today_my(), 'YYYY'); v_n int; v_ref text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active) then raise exception 'Your account is not active'; end if;
  perform pg_advisory_xact_lock(hashtext('official_statements'));
  select count(*) + 1 into v_n from public.official_statements where ref like 'TR-' || v_year || '-%';
  v_ref := 'TR-' || v_year || '-' || lpad(v_n::text, 4, '0');
  insert into public.official_statements (ref, staff_id, period_from, period_to, records, hours)
  values (v_ref, auth.uid(), p_from, p_to, greatest(0, coalesce(p_records, 0)), greatest(0, coalesce(p_hours, 0)));
  return v_ref;
end $$;
revoke execute on function public.issue_statement(date, date, int, numeric) from public, anon;
grant execute on function public.issue_statement(date, date, int, numeric) to authenticated;
