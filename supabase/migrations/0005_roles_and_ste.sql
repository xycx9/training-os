-- Training OS: editable job roles, and Staff Training Expenditure (STE)
-- Run once in the Supabase SQL Editor, after 0001–0004.

-------------------------------------------------------------------------------
-- Job roles: a list the admin controls, each mapped to a BNM level for the STE report
-------------------------------------------------------------------------------
create table public.job_roles (
  name text primary key check (length(trim(name)) between 1 and 60),
  bnm_level text not null default 'support' check (bnm_level in ('senior', 'middle', 'support')),
  active boolean not null default true,
  sort int not null default 0
);
insert into public.job_roles (name, bnm_level, sort) values
  ('Management', 'senior', 1), ('Compliance officer', 'middle', 2), ('Teller', 'support', 3)
on conflict (name) do nothing;
-- Any other role already in use is kept, as support staff.
insert into public.job_roles (name, bnm_level, sort)
select distinct job_role, 'support', 10 from public.profiles where job_role is not null and length(trim(job_role)) > 0
on conflict (name) do nothing;

alter table public.job_roles enable row level security;
create policy job_roles_read on public.job_roles for select to authenticated using (true);
create policy job_roles_admin_insert on public.job_roles for insert to authenticated with check (public.is_admin());
create policy job_roles_admin_update on public.job_roles for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.job_roles to authenticated;
revoke all on public.job_roles from anon;

-- Rename a role and everyone who has it, in one step.
create or replace function public.rename_job_role(p_old text, p_new text) returns void
language plpgsql security definer set search_path = public as $$
declare v_new text := trim(p_new);
begin
  if not public.is_admin() then raise exception 'Only admins can change job roles'; end if;
  if v_new = '' then raise exception 'Enter a name for the job role'; end if;
  if v_new = p_old then return; end if;
  if exists (select 1 from public.job_roles where lower(name) = lower(v_new) and name <> p_old) then raise exception 'There is already a job role called %', v_new; end if;
  insert into public.job_roles (name, bnm_level, active, sort) select v_new, bnm_level, active, sort from public.job_roles where name = p_old;
  update public.profiles set job_role = v_new where job_role = p_old;
  delete from public.job_roles where name = p_old;
end $$;
revoke execute on function public.rename_job_role(text, text) from public, anon;
grant execute on function public.rename_job_role(text, text) to authenticated;

-------------------------------------------------------------------------------
-- Staff Training Expenditure (BNM/RH/PD 031-6). Admins only.
-------------------------------------------------------------------------------
create table public.ste_years (
  id uuid primary key default gen_random_uuid(),
  fy_end date not null unique,
  gross_wages_prev numeric(14,2) not null default 0 check (gross_wages_prev >= 0),
  carry_forward numeric(14,2) not null default 0 check (carry_forward >= 0),
  carry_forward_ref text,
  historical boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_on date,
  fibox_ref text,
  prepared_name text,
  prepared_title text,
  prepared_contact text,
  report_date date,
  participation jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ste_trainers (
  id uuid primary key default gen_random_uuid(),
  year_id uuid not null references public.ste_years(id) on delete cascade,
  staff_id uuid references public.profiles(id) on delete set null,
  trainer_name text not null,
  trainer_role text,
  monthly_salary numeric(12,2) not null default 0,
  monthly_allowances numeric(12,2) not null default 0,
  monthly_epf numeric(12,2) not null default 0,
  hours_per_month numeric(6,2) not null default 176 check (hours_per_month > 0),
  activities jsonb not null default '[]'::jsonb,
  session_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.ste_expenses (
  id uuid primary key default gen_random_uuid(),
  year_id uuid not null references public.ste_years(id) on delete cascade,
  spent_on date not null,
  category text not null check (category in ('a', 'b_i', 'b_ii', 'b_iii', 'b_iv', 'b_v')),
  description text not null check (length(trim(description)) > 0),
  amount numeric(12,2) not null check (amount >= 0),
  payee text,
  payment_ref text,
  session_id uuid references public.training_sessions(id) on delete set null,
  module_id uuid references public.modules(id) on delete set null,
  trainer_id uuid unique references public.ste_trainers(id) on delete cascade,
  doc_path text,
  doc_name text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index ste_expenses_year on public.ste_expenses(year_id);

create table public.ste_log (
  id bigint generated always as identity primary key,
  year_id uuid not null references public.ste_years(id) on delete cascade,
  action text not null,
  note text,
  by_user uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);

-- A submitted year is locked: no changes to its figures, costs or worksheets until it is reopened.
create or replace function public.ste_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare y public.ste_years; v_year uuid;
begin
  if tg_table_name = 'ste_years' then
    if tg_op = 'DELETE' then
      if old.status = 'submitted' then raise exception 'A submitted year cannot be deleted'; end if;
      return old;
    end if;
    if old.status = 'submitted' and new.status = 'submitted' then
      raise exception 'This year has been submitted and is locked. Reopen it to make changes.';
    end if;
    if old.status = 'draft' and new.status = 'submitted' then
      insert into public.ste_log (year_id, action, note, by_user) values (new.id, 'submitted', coalesce('FIBox ref ' || new.fibox_ref, null), auth.uid());
    elsif old.status = 'submitted' and new.status = 'draft' then
      insert into public.ste_log (year_id, action, note, by_user) values (new.id, 'reopened', nullif(current_setting('ste.reason', true), ''), auth.uid());
    end if;
    new.updated_at := now();
    return new;
  end if;
  v_year := case when tg_op = 'DELETE' then old.year_id else new.year_id end;
  select * into y from public.ste_years where id = v_year;
  if y.status = 'submitted' then raise exception 'This year has been submitted and is locked. Reopen it to make changes.'; end if;
  if tg_table_name = 'ste_expenses' and tg_op <> 'DELETE'
     and (new.spent_on > y.fy_end or new.spent_on <= (y.fy_end - interval '1 year')::date) then
    raise exception 'The date must fall within the financial year (% to %)', to_char((y.fy_end - interval '1 year')::date + 1, 'DD Mon YYYY'), to_char(y.fy_end, 'DD Mon YYYY');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger ste_years_guard before update or delete on public.ste_years for each row execute function public.ste_guard();
create trigger ste_expenses_guard before insert or update or delete on public.ste_expenses for each row execute function public.ste_guard();
create trigger ste_trainers_guard before insert or update or delete on public.ste_trainers for each row execute function public.ste_guard();

alter table public.ste_years enable row level security;
alter table public.ste_trainers enable row level security;
alter table public.ste_expenses enable row level security;
alter table public.ste_log enable row level security;
create policy ste_years_admin on public.ste_years for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ste_trainers_admin on public.ste_trainers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ste_expenses_admin on public.ste_expenses for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ste_log_admin_read on public.ste_log for select to authenticated using (public.is_admin());
grant select, insert, update, delete on public.ste_years, public.ste_trainers, public.ste_expenses to authenticated;
grant select on public.ste_log to authenticated;
revoke all on public.ste_years, public.ste_trainers, public.ste_expenses, public.ste_log from anon;

-- Receipts, invoices and payment vouchers (S 8.3). Admins only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ste-docs', 'ste-docs', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
create policy ste_docs_admin_read on storage.objects for select to authenticated using (bucket_id = 'ste-docs' and public.is_admin());
create policy ste_docs_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'ste-docs' and public.is_admin());
create policy ste_docs_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'ste-docs' and public.is_admin());

-- Reopen a submitted year to correct it. The reason is kept in the year's history.
create or replace function public.reopen_ste_year(p_year uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can reopen a year'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for reopening'; end if;
  perform set_config('ste.reason', trim(p_reason), true);
  update public.ste_years set status = 'draft' where id = p_year and status = 'submitted';
  if not found then raise exception 'This year is not submitted'; end if;
end $$;
revoke execute on function public.reopen_ste_year(uuid, text) from public, anon;
grant execute on function public.reopen_ste_year(uuid, text) to authenticated;
