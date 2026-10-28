-- Training OS: new job roles
-- Run once in the Supabase SQL Editor, after 0001 and 0002.
-- Job roles are now: Teller, Compliance officer, Management.

update public.profiles set job_role = 'Teller' where job_role in ('Counter staff', 'New joiner');
update public.profiles set job_role = 'Management' where job_role = 'Manager';
update public.profiles set job_role = 'Teller'
  where role = 'staff' and job_role not in ('Teller', 'Compliance officer', 'Management');
alter table public.profiles alter column job_role set default 'Teller';

-- Deleting a staff account (done by the admin-users function) removes their assignments and reading
-- progress automatically. It is refused if the person has any submitted attempt or recorded training,
-- so training evidence can never be deleted this way.
