-- Training OS: past training records
-- Run once in the Supabase SQL Editor, after 0001_training_os.sql.
-- Records training that took place before (or outside) the system, on its real date,
-- clearly marked as entered by an admin.

create table public.past_training (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  completed_on date not null,
  hours numeric(5,2) not null default 0 check (hours >= 0),
  result text not null default 'completed' check (result in ('completed','pass','fail')),
  score int check (score between 0 and 100),
  delivered_by text,
  notes text,
  evidence_path text,
  evidence_name text,
  entered_by uuid references public.profiles(id),
  entered_at timestamptz not null default now(),
  check (completed_on <= (now() at time zone 'Asia/Kuala_Lumpur')::date)
);
create index past_training_staff on public.past_training(staff_id, completed_on);

alter table public.past_training enable row level security;
create policy past_training_read on public.past_training for select to authenticated using (staff_id = auth.uid() or public.is_admin());
create policy past_training_admin_insert on public.past_training for insert to authenticated with check (public.is_admin() and entered_by = auth.uid());
create policy past_training_admin_delete on public.past_training for delete to authenticated using (public.is_admin());

grant select, insert, delete on public.past_training to authenticated;
revoke all on public.past_training from anon;

-- Private bucket for attendance sheets, certificates and similar evidence (admins only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

create policy evidence_admin_read on storage.objects for select to authenticated using (bucket_id = 'evidence' and public.is_admin());
create policy evidence_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'evidence' and public.is_admin());
create policy evidence_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'evidence' and public.is_admin());
